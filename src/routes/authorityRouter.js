const express = require('express');
const authorityRouter = express.Router();
const User = require('../models/User');
const Issue = require('../models/Issue');
const userAuth = require('../middlewares/userAuth');
const authorityAuth = require('../middlewares/authorityAuth');
const ExcelJS = require('exceljs');
const triggerNotification = require('../utils/notificationService');
const { calculateCsiReward } = require('../utils/csiCalculator');

// Helper function to build queries
const buildAuthorityQuery = (req, authority) => {
    const { status, category, state, city, search, highImpact, metricType } = req.query;
    const assignedDistrict = authority.authorityProfile?.assignedDistrict || authority.contact?.city;
    const assignedState = authority.authorityProfile?.assignedState || authority.contact?.state;

    // 1. IF CLICKED ON A STAT BOX (Metric Modal Query)
    if (metricType) {
        const authId = authority._id;
        switch (metricType) {
            case 'COMPLETED': return { 'bidding.winningBid.authorityId': authId, status: 'RESOLVED', isDeleted: false };
            case 'FAILED': return {
                'auditLog': {
                    $elemMatch: {
                        performedBy: authId,
                        action: { $in: ['HANDOVER_SUBMITTED', 'GHOST_ABANDONMENT'] }
                    }
                },
                isDeleted: false
            };
            case 'RELEASED': return { 'bidding.winningBid.authorityId': authId, status: 'RELEASED', isDeleted: false };
            case 'PENDING': return {
                'bidding.winningBid.authorityId': authId,
                status: { $in: ['LOCKED', 'PENDING_EXTENSION', 'AWAITING_HANDOVER'] },
                isDeleted: false
            };
            case 'OPEN_LOCAL': return {
                'location.state': { $regex: `^${assignedState}$`, $options: 'i' },
                'location.district': { $regex: `^${assignedDistrict}$`, $options: 'i' },
                status: 'OPEN',
                isDeleted: false,
                auditLog: {
                    $not: {
                        $elemMatch: {
                            action: { $in: ['RADAR_REJECT', 'GHOST_ABANDONMENT', 'HANDOVER_SUBMITTED', 'JOB_RELEASED'] },
                            performedBy: authId
                        }
                    }
                }
            }; default: return { isDeleted: false };
        }
    }

    // 2. STANDARD TABLE FILTERS (Smart Role-Based Filtering)
    let query = { isDeleted: false };

    query.auditLog = {
        $not: {
            $elemMatch: {
                action: { $in: ['RADAR_REJECT', 'GHOST_ABANDONMENT', 'HANDOVER_SUBMITTED', 'JOB_RELEASED'] },
                performedBy: authority._id
            }
        }
    };

    if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
    if (city) query['location.district'] = { $regex: `^${city}$`, $options: 'i' };
    if (!state && !city) {
        query['location.district'] = { $regex: `^${assignedDistrict}$`, $options: 'i' };
    }

    if (status) {
        const upperStatus = status.toUpperCase();
        if (upperStatus === 'PENDING') {
            query.status = { $in: ['LOCKED', 'IN_REVIEW'] };
            query['bidding.winningBid.authorityId'] = authority._id;
        } else if (upperStatus === 'REJECTED' || upperStatus === 'FAILED') {
            query.status = { $in: ['REJECTED', 'FAILED'] };
            query['bidding.winningBid.authorityId'] = authority._id;
        } else if (upperStatus === 'RELEASED') {
            query.status = 'RELEASED';
            query['bidding.winningBid.authorityId'] = authority._id;
        } else {
            query.status = upperStatus;
        }
    }

    if (category) query.category = category.toUpperCase();

    if (highImpact === 'true') {
        query.impactScore = { $gte: 50 };
    }

    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { 'location.pinCode': { $regex: search, $options: 'i' } }
        ];
    }

    return query;
};

// 📊 GET: Authority Analytics Summary
authorityRouter.get('/authority/analytics/summary', userAuth, authorityAuth, async (req, res) => {
    try {
        const authority = req.authorityUser;
        const assignedDistrict = authority.authorityProfile?.assignedDistrict || authority.contact?.city;
        const assignedState = authority.authorityProfile?.assignedState || authority.contact?.state;

        const [openLocalIssues, jobsPending] = await Promise.all([
            Issue.countDocuments({
                'location.state': { $regex: `^${assignedState}$`, $options: 'i' },
                'location.district': { $regex: `^${assignedDistrict}$`, $options: 'i' },
                status: 'OPEN',
                isDeleted: false,
                auditLog: {
                    $not: {
                        $elemMatch: {
                            action: { $in: ['RADAR_REJECT', 'GHOST_ABANDONMENT', 'HANDOVER_SUBMITTED', 'JOB_RELEASED'] },
                            performedBy: authority._id
                        }
                    }
                }
            }),
            Issue.countDocuments({
                'bidding.winningBid.authorityId': authority._id,
                status: { $in: ['LOCKED', 'PENDING_EXTENSION', 'AWAITING_HANDOVER'] },
                isDeleted: false
            })
        ]);

        return res.status(200).json({
            success: true,
            data: {
                csiScore: authority.authorityProfile?.csiScore || 0,
                jobsCompleted: authority.authorityProfile?.jobsCompleted || 0,
                jobsFailed: authority.authorityProfile?.jobsFailed || 0,
                jobsReleased: authority.authorityProfile?.jobsReleased || 0,
                jobsPending,
                openLocalIssues
            }
        });
    } catch (err) {
        console.error("Authority Analytics Error:", err);
        return res.status(500).json({ success: false, message: "Server error fetching analytics." });
    }
});

// 🔍 GET: Fetch Single Issue Details for Authority Modal
authorityRouter.get('/authority/issue/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { issueId } = req.params;

        // Fetch and populate the reporter and the assigned official
        const issue = await Issue.findById(issueId)
            .populate('reportedBy', 'name role')
            .populate('bidding.winningBid.authorityId', 'name authorityProfile');

        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        return res.status(200).json({
            success: true,
            data: issue
        });

    } catch (err) {
        console.error("Fetch Single Issue Error:", err);
        return res.status(500).json({ success: false, message: "Server error fetching issue details." });
    }
});

// 📋 GET: Localized Issues Feed
authorityRouter.get('/authority/issues', userAuth, authorityAuth, async (req, res) => {
    try {
        const { page = 1, limit = 15 } = req.query;
        const query = buildAuthorityQuery(req, req.authorityUser);
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [issues, total] = await Promise.all([
            Issue.find(query)
                .sort({ impactScore: -1, createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('title category priority status location impactScore createdAt bidding workCycle media disputeEvidence reportedBy')
                .populate('reportedBy', 'name role'),
            Issue.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                issues,
                pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), totalIssues: total }
            }
        });
    } catch (err) {
        console.error("Authority Issues Error:", err);
        return res.status(500).json({ success: false, message: "Server error fetching local issues." });
    }
});

// 📥 EXPORT: Download Filtered Issues as Excel
authorityRouter.get('/authority/export', userAuth, authorityAuth, async (req, res) => {
    try {
        const query = buildAuthorityQuery(req, req.authorityUser);

        const issues = await Issue.find(query)
            .sort({ impactScore: -1, createdAt: -1 })
            .populate('reportedBy', 'name email role');

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Authority Export');

        worksheet.columns = [
            { header: 'ID', key: '_id', width: 25 },
            { header: 'Title', key: 'title', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Impact Score', key: 'impactScore', width: 15 },
            { header: 'District', key: 'district', width: 20 },
            { header: 'State', key: 'state', width: 20 },
            { header: 'Reported By', key: 'reporter', width: 25 },
            { header: 'Created At', key: 'createdAt', width: 20 }
        ];

        issues.forEach(i => {
            worksheet.addRow({
                _id: i._id.toString(),
                title: i.title,
                category: i.category || 'N/A',
                status: i.status,
                impactScore: i.impactScore || 0,
                district: i.location?.district || i.location?.city || 'N/A',
                state: i.location?.state || 'N/A',
                reporter: i.isAnonymous ? 'Anonymous' : (i.reportedBy?.name || 'Unknown'),
                createdAt: new Date(i.createdAt).toLocaleString()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Authority_Issues_Export.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export issues error:", err);
        res.status(500).send('Error generating Excel file');
    }
});

// =========================================================================
// 🚀 THE BIDDING ENGINE (LOCAL RADAR)
// =========================================================================

authorityRouter.get('/authority/radar/open', userAuth, authorityAuth, async (req, res) => {
    try {
        const authority = req.authorityUser;
        const assignedDistrict = authority.authorityProfile?.assignedDistrict || authority.contact?.city;
        const assignedState = authority.authorityProfile?.assignedState || authority.contact?.state;

        const issues = await Issue.find({
            status: 'OPEN',
            'location.state': { $regex: `^${assignedState}$`, $options: 'i' },
            'location.district': { $regex: `^${assignedDistrict}$`, $options: 'i' },
            isDeleted: false,
            auditLog: {
                $not: {
                    $elemMatch: {
                        action: { $in: ['RADAR_REJECT', 'GHOST_ABANDONMENT', 'HANDOVER_SUBMITTED', 'JOB_RELEASED'] },
                        performedBy: authority._id
                    }
                }
            }
        })
            .sort({ 'bidding.auctionEndsAt': 1, impactScore: -1 })
            .populate('reportedBy', 'name role')
            .select('-statusHistory -confirmations');

        return res.status(200).json({ success: true, data: issues });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to load radar." });
    }
});

authorityRouter.get('/authority/radar/rejected', userAuth, authorityAuth, async (req, res) => {
    try {
        const authority = req.authorityUser;

        const issues = await Issue.find({
            status: 'OPEN',
            auditLog: {
                $elemMatch: { action: 'RADAR_REJECT', performedBy: authority._id }
            }
        })
            .sort({ updatedAt: -1 })
            .populate('reportedBy', 'name role')
            .select('-statusHistory -confirmations');

        return res.status(200).json({ success: true, data: issues });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to load rejected issues." });
    }
});

authorityRouter.post('/authority/radar/bid/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { proposedTimeValue, proposedTimeUnit } = req.body;
        const authority = req.authorityUser;
        const issueId = req.params.issueId;

        if (authority.authorityProfile.activeJobsCount >= 5) {
            return res.status(403).json({
                success: false,
                message: "Active Job Cap Reached. You cannot hold more than 5 active jobs at once."
            });
        }

        const issue = await Issue.findById(issueId);
        if (!issue || issue.status !== 'OPEN') {
            return res.status(400).json({ success: false, message: "Issue is no longer available." });
        }

        let proposedTimeInHours = Number(proposedTimeValue);
        if (proposedTimeUnit === 'DAYS') proposedTimeInHours *= 24;
        if (proposedTimeUnit === 'WEEKS') proposedTimeInHours *= 168;
        if (proposedTimeUnit === 'MONTHS') proposedTimeInHours *= 730;

        const now = new Date();
        const hasBids = issue.bidding.bids.length > 0;

        if (hasBids) {
            if (now > issue.bidding.auctionEndsAt) {
                return res.status(400).json({ success: false, message: "Auction has already closed for this issue." });
            }

            const alreadyBidded = issue.bidding.bids.some(b => b.authorityId.toString() === authority._id.toString());
            if (alreadyBidded) {
                return res.status(400).json({ success: false, message: "You have already placed a bid on this issue." });
            }

            const currentLowest = issue.bidding.winningBid.commitmentTimeHours;
            if (proposedTimeInHours >= currentLowest) {
                return res.status(400).json({
                    success: false,
                    message: `Bid rejected. You must submit a time faster than the current lowest bid (${currentLowest} hours).`
                });
            }
        } else {
            issue.bidding.auctionStartsAt = now;
            issue.bidding.auctionEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }

        const newBid = {
            authorityId: authority._id,
            proposedTimeValue,
            proposedTimeUnit,
            proposedTimeInHours,
            timestamp: now
        };
        issue.bidding.bids.push(newBid);

        issue.bidding.winningBid = {
            authorityId: authority._id,
            commitmentTimeHours: proposedTimeInHours,
            acceptedAt: now
        };

        issue.auditLog.push({
            action: 'BID_PLACED',
            performedBy: authority._id,
            details: `Placed a bid of ${proposedTimeValue} ${proposedTimeUnit} (${proposedTimeInHours}h)`
        });

        await issue.save();

        // Grab the previous winner before we overwrite it
        const previousWinningBidAuthId = issue.bidding.winningBid ? issue.bidding.winningBid.authorityId : null;

        // Temporarily assign them as the winning bid
        issue.bidding.winningBid = {
            authorityId: authority._id,
            commitmentTimeHours: proposedTimeInHours,
            acceptedAt: now
        };

        issue.auditLog.push({
            action: 'BID_PLACED',
            performedBy: authority._id,
            details: `Placed a bid of ${proposedTimeValue} ${proposedTimeUnit} (${proposedTimeInHours}h)`
        });

        await issue.save();
        const populatedIssue = await Issue.findById(issue._id)
            .populate('reportedBy', 'name role')
            .populate('bidding.winningBid.authorityId', 'name');

        const io = req.app.get('io');

        if (io) {
            if (!hasBids) {
                // SCENARIO A: First Bid! Notify the reporter AND anyone who confirmed the issue.
                const notifyUsers = [issue.reportedBy, ...issue.confirmations.map(c => c.user)];
                const uniqueUsers = [...new Set(notifyUsers.map(id => id.toString()))]; // Remove duplicates

                for (const uid of uniqueUsers) {
                    triggerNotification({
                        recipientId: uid,
                        senderId: authority._id,
                        issueId: issue._id,
                        type: 'UPDATE',
                        message: `Great news! An official just placed the first bid on "${issue.title}". The 24-hour countdown has begun!`,
                        io
                    });
                }
            } else if (hasBids && previousWinningBidAuthId && previousWinningBidAuthId.toString() !== authority._id.toString()) {
                // SCENARIO B: Outbidding! Notify the official who just lost the lead.
                triggerNotification({
                    recipientId: previousWinningBidAuthId,
                    senderId: authority._id,
                    issueId: issue._id,
                    type: 'URGENT',
                    message: `You have been OUTBID on "${issue.title}". Another official committed to fixing it faster!`,
                    io
                });
            }
            io.emit('issue_status_updated', {
                issueId: issue._id,
                newStatus: 'LOCKED'
            });
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue
            });
        }

        return res.status(200).json({
            success: true,
            message: hasBids ? "You are now the lowest bidder!" : "Bid placed. 24-Hour auction has started.",
            issue
        });

    } catch (err) {
        console.error("Bidding Error:", err);
        return res.status(500).json({ success: false, message: "Server error during bidding." });
    }
});

authorityRouter.post('/authority/radar/reject/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { reason } = req.body;
        const authority = req.authorityUser;
        const issueId = req.params.issueId;

        const issue = await Issue.findById(issueId);
        if (!issue) return res.status(404).json({ success: false, message: "Issue not found" });

        issue.auditLog.push({
            action: 'RADAR_REJECT',
            performedBy: authority._id,
            details: reason || "Dismissed from radar without reason"
        });

        await issue.save();

        return res.status(200).json({
            success: true,
            message: "Issue removed from your radar."
        });
    } catch (err) {
        console.error("Reject Error:", err);
        return res.status(500).json({ success: false, message: "Failed to dismiss issue." });
    }
});

authorityRouter.get('/authority/my-jobs', userAuth, authorityAuth, async (req, res) => {
    try {
        const authorityId = req.authorityUser._id;
        const myJobs = await Issue.find({
            'bidding.winningBid.authorityId': authorityId,
            status: { $in: ['LOCKED', 'PENDING_EXTENSION', 'AWAITING_HANDOVER'] }
        }).sort({ 'workCycle.commitmentDeadline': 1 });

        return res.status(200).json({ success: true, data: myJobs });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error fetching your jobs." });
    }
});

// =========================================================================
// 🛠️ ACTIVE JOB MANAGEMENT (RESOLVE, HANDOVER, EXTEND)
// =========================================================================

authorityRouter.post('/authority/issues/:issueId/resolve', userAuth, authorityAuth, async (req, res) => {
    try {
        const { mediaUrls, remarks } = req.body;
        const authorityId = req.authorityUser._id;
        const issueId = req.params.issueId;

        const issue = await Issue.findById(issueId);
        if (!issue || issue.status !== 'LOCKED') {
            return res.status(400).json({ success: false, message: "Issue is not in a valid state to be resolved." });
        }

        if (issue.bidding.winningBid.authorityId.toString() !== authorityId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized. You do not own this job." });
        }

        if (!mediaUrls || mediaUrls.length === 0) {
            return res.status(400).json({ success: false, message: "Resolution evidence is required." });
        }

        // 🟢 FIXED: Using the central calculateCsiReward function!
        const escrowPoints = calculateCsiReward(issue.impactScore);

        issue.status = 'RESOLVED';
        issue.workCycle.escrow = {
            isEscrowActive: true,
            pointsHolding: escrowPoints,
            citizenVerdict: 'PENDING',
            autoReleaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
        };
        issue.workCycle.isClockPaused = true;

        mediaUrls.forEach(url => issue.media.push({ url, uploadedAt: new Date() }));

        issue.statusHistory.push({ status: 'RESOLVED', changedBy: authorityId, remark: remarks || 'Resolved by official. Awaiting citizen verification.' });
        issue.auditLog.push({ action: 'RESOLVED_AWAITING_ESCROW', performedBy: authorityId, details: `Job marked complete. ${escrowPoints} points locked in Escrow.` });

        await issue.save();

        const io = req.app.get('io');
        if (io) {
            const notifyUsers = [issue.reportedBy, ...issue.confirmations.map(c => c.user)];
            const uniqueUsers = [...new Set(notifyUsers.map(id => id.toString()))];

            for (const uid of uniqueUsers) {
                triggerNotification({
                    recipientId: uid,
                    senderId: authorityId,
                    issueId: issue._id,
                    type: 'ACTION_REQUIRED',
                    message: `An official marked "${issue.title}" as RESOLVED! Please review the evidence and verify within 72 hours.`,
                    io
                });
            }
            io.emit('issue_status_updated', {
                issueId: issue._id,
                newStatus: 'RESOLVED'
            });
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue
            });
        }

        await User.findByIdAndUpdate(authorityId, {
            $inc: {
                'authorityProfile.csiInEscrow': escrowPoints,
                'authorityProfile.activeJobsCount': -1,
                'authorityProfile.jobsCompleted': 1
            }
        });

        return res.status(200).json({ success: true, message: "Resolution submitted to Escrow successfully." });

    } catch (err) {
        console.error("Resolve Issue Error:", err);
        return res.status(500).json({ success: false, message: "Server error during resolution." });
    }
});

authorityRouter.post('/authority/issues/:issueId/handover', userAuth, authorityAuth, async (req, res) => {
    try {
        const { mediaUrls, reasonForFailure } = req.body;
        const authorityId = req.authorityUser._id;
        const issueId = req.params.issueId;

        const issue = await Issue.findById(issueId);
        if (!issue || issue.status !== 'AWAITING_HANDOVER') {
            return res.status(400).json({ success: false, message: "Issue is not awaiting a handover." });
        }

        if (issue.bidding.winningBid.authorityId.toString() !== authorityId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized." });
        }

        if (!reasonForFailure) {
            return res.status(400).json({ success: false, message: "A reason for abandonment is required." });
        }

        issue.workCycle.handoverReports.push({
            authorityId: authorityId,
            completionPercentage: 0,
            photoUrl: mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : 'No Media',
            reasonForFailure: reasonForFailure
        });

        if (mediaUrls && mediaUrls.length > 0) {
            mediaUrls.forEach(url => issue.media.push({ url, uploadedAt: new Date() }));
        }

        issue.status = 'OPEN';
        issue.bidding = { auctionStartsAt: null, auctionEndsAt: null, bids: [], winningBid: null };
        issue.workCycle.commitmentDeadline = null;
        issue.workCycle.ghostTimerExpiresAt = null;

        issue.statusHistory.push({ status: 'OPEN', changedBy: authorityId, remark: 'Previous official abandoned job with handover. Returned to auction.' });
        issue.auditLog.push({ action: 'HANDOVER_SUBMITTED', performedBy: authorityId, details: reasonForFailure });

        await issue.save();

        const io = req.app.get('io');
        if (io) {
            triggerNotification({
                recipientId: issue.reportedBy,
                senderId: authorityId,
                issueId: issue._id,
                type: 'UPDATE',
                message: `The official assigned to "${issue.title}" has stepped down. The issue is back on the open market for new bids.`,
                io
            });
            io.emit('issue_status_updated', {
                issueId: issue._id,
                newStatus: 'OPEN'
            });
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue
            });
        }

        await User.findByIdAndUpdate(authorityId, {
            $inc: { 'authorityProfile.activeJobsCount': -1 }
        });

        return res.status(200).json({ success: true, message: "Handover report accepted. Account unlocked." });

    } catch (err) {
        console.error("Handover Error:", err);
        return res.status(500).json({ success: false, message: "Server error during handover." });
    }
});

authorityRouter.post('/authority/issues/:issueId/extend', userAuth, authorityAuth, async (req, res) => {
    try {
        // 🟢 FIX: Accept the raw inputs from the authority's UI
        const { requestedTimeValue, requestedTimeUnit, reason } = req.body;
        const authorityId = req.authorityUser._id;
        const issueId = req.params.issueId;

        const issue = await Issue.findById(issueId);
        if (!issue || issue.status !== 'LOCKED') {
            return res.status(400).json({ success: false, message: "Can only extend active jobs." });
        }

        if (issue.bidding.winningBid.authorityId.toString() !== authorityId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized." });
        }

        if (!requestedTimeValue || !requestedTimeUnit || !reason) {
            return res.status(400).json({ success: false, message: "Time value, unit, and reason are required." });
        }

        // 🟢 Calculate normalized hours for the system deadline
        let hoursRequested = Number(requestedTimeValue);
        const multipliers = { 'HOURS': 1, 'DAYS': 24, 'WEEKS': 168, 'MONTHS': 720 };
        hoursRequested *= (multipliers[requestedTimeUnit.toUpperCase()] || 1);

        issue.status = 'PENDING_EXTENSION';
        issue.workCycle.isClockPaused = true;
        issue.workCycle.pausedAt = new Date();

        // 🟢 FIX: Save the raw values so the Admin UI can display them correctly later
        issue.workCycle.extensionRequests.push({
            requestedTimeValue: Number(requestedTimeValue),
            requestedTimeUnit: requestedTimeUnit.toUpperCase(),
            hoursRequested: hoursRequested,
            reason: reason,
            status: 'PENDING'
        });

        issue.statusHistory.push({ status: 'PENDING_EXTENSION', changedBy: authorityId, remark: `Requested ${requestedTimeValue} ${requestedTimeUnit} extension.` });
        issue.auditLog.push({ action: 'EXTENSION_REQUESTED', performedBy: authorityId, details: `Reason: ${reason}` });

        await issue.save();

        const io = req.app.get('io');
        if (io) {
            triggerNotification({
                recipientId: issue.reportedBy,
                senderId: authorityId,
                issueId: issue._id,
                type: 'UPDATE',
                message: `The official assigned to "${issue.title}" requested a deadline extension. Reason: ${reason}`,
                io
            });
            io.emit('issue_status_updated', {
                issueId: issue._id,
                newStatus: 'PENDING_EXTENSION'
            });
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue
            });
        }

        return res.status(200).json({ success: true, message: "Extension requested. System clock is paused." });

    } catch (err) {
        console.error("Extension Error:", err);
        return res.status(500).json({ success: false, message: "Server error during extension request." });
    }
});

authorityRouter.post('/authority/radar/revert/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const authorityId = req.authorityUser._id;
        const issueId = req.params.issueId;

        await Issue.findByIdAndUpdate(issueId, {
            $pull: {
                auditLog: { action: 'RADAR_REJECT', performedBy: authorityId }
            }
        });

        return res.status(200).json({ success: true, message: "Issue is back on your radar!" });
    } catch (err) {
        console.error("Revert Reject Error:", err);
        return res.status(500).json({ success: false, message: "Failed to revert decision." });
    }
});

module.exports = authorityRouter;