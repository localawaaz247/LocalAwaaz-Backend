const express = require('express');
const adminRouter = express.Router();
const User = require('../models/User');
const Issue = require('../models/Issue');
const userAuth = require('../middlewares/userAuth');
const adminAuth = require('../middlewares/adminAuth');
const triggerNotification = require('../utils/notificationService');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Inquiry = require('../models/Inquiry');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs')
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require('../config/s3Client');
const LeaderBoard = require('../models/LeaderBoard');
const { calculateCsiReward } = require('../utils/csiCalculator');

const uploadEvidence = multer({
    dest: 'temp_uploads/',
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("FILE_TYPE_NOT_SUPPORTED"), false);
        }
    }
});

// Issue Controlling Routes
// Get all the issues 
adminRouter.get('/admin/issues', userAuth, adminAuth, async (req, res) => {
    try {
        const { status, state, city, pinCode, reporterRole, search, page = 1, limit = 20 } = req.query;

        const query = {};

        // 1. Status Filter
        if (status && typeof status === 'string') query.status = status.toUpperCase();

        // 2. Geographic Filters (Strict regex for exact matches from cscApi)
        if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
        if (city) query['location.city'] = { $regex: `^${city}$`, $options: 'i' };
        if (pinCode) query['location.pinCode'] = pinCode;

        // 3. Reporter Role Filter (Two-step query to avoid complex aggregation)
        if (reporterRole) {
            let mappedRole = reporterRole.toLowerCase();
            // Map the frontend 'citizen' label to the database 'user' enum
            if (mappedRole === 'citizen') mappedRole = 'user';

            const usersWithRole = await User.find({ role: mappedRole }).select('_id');
            const userIds = usersWithRole.map(u => u._id);
            query.reportedBy = { $in: userIds };
        }

        // 4. Global Search (Title, Pincode, or exact Issue ID)
        if (search) {
            const searchConditions = [
                { title: { $regex: search, $options: 'i' } },
                { 'location.pinCode': { $regex: search, $options: 'i' } }
            ];

            // If the search string is a valid MongoDB ObjectId, allow exact ID matching
            if (mongoose.Types.ObjectId.isValid(search.trim())) {
                searchConditions.push({ _id: search.trim() });
            }

            // Safely merge with existing query logic
            query.$or = searchConditions;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [issues, total] = await Promise.all([
            Issue.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                // 1. Populate the original reporter
                .populate('reportedBy', 'name userName email civilScore role')
                // 2. THIS IS NEW: Populate the winning authority so we can display their name in the UI!
                .populate('bidding.winningBid.authorityId', 'name userName role authorityProfile'),
            Issue.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            message: 'Got all the issues',
            data: {
                issues,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalIssues: total,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Server Error : error in getting all the issues', err);
        return res.status(500).json({ success: false, message: "Server Error : Can't get all the issues" });
    }
});

adminRouter.patch('/admin/issue/:id', userAuth, adminAuth, uploadEvidence.single('media'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const io = req.app.get('io');
        const file = req.file;

        const updateData = { ...req.body };

        if (!mongoose.Types.ObjectId.isValid(id)) {
            if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            return res.status(400).json({ success: false, message: "Invalid Issue ID" });
        }

        const currentIssue = await Issue.findById(id);
        if (!currentIssue) {
            if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        delete updateData._id;
        delete updateData.reportedBy;

        let isStatusUpdated = false;
        let newStatus = null;
        let officialRemark = updateData.adminRemark || "";
        let pushQuery = {};
        const auditLogsToPush = [];
        let r2PublicUrl = null;

        if (file) {
            try {
                const fileStream = fs.createReadStream(file.path);
                const uniqueFileName = `evidence-${crypto.randomUUID()}-${file.originalname.replace(/\s+/g, '-')}`;

                const command = new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: uniqueFileName,
                    Body: fileStream,
                    ContentType: file.mimetype,
                });

                await s3.send(command);
                r2PublicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`;

                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            } catch (uploadError) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                return res.status(500).json({ success: false, message: "Failed to upload evidence to cloud storage." });
            }
        }

        if (updateData.status) {
            newStatus = updateData.status.toUpperCase();
            const validStatus = ["OPEN", "LOCKED", "PENDING_EXTENSION", "AWAITING_HANDOVER", "RESOLVED", "FAILED", "DISPUTED", "RELEASED", "ORPHANED"];

            if (!validStatus.includes(newStatus)) {
                return res.status(400).json({ success: false, message: `Invalid status.` });
            }

            updateData.status = newStatus;
            isStatusUpdated = true;

            pushQuery.statusHistory = {
                status: newStatus,
                changedBy: userId,
                changedAt: Date.now(),
                remark: officialRemark || 'Status updated by Admin'
            };
        }

        const mongooseUpdate = { $set: updateData };
        let pendingEscrowReward = null;

        if (updateData.resolvedByAuthority) {
            const targetAuthId = updateData.resolvedByAuthority;
            const existingTime = currentIssue.bidding?.winningBid?.commitmentTimeHours || 24;
            const existingAcceptedAt = currentIssue.bidding?.winningBid?.acceptedAt || Date.now();

            mongooseUpdate.$set['bidding.winningBid'] = {
                authorityId: targetAuthId,
                commitmentTimeHours: existingTime,
                acceptedAt: existingAcceptedAt
            };

            if (!currentIssue.workCycle?.commitmentDeadline) {
                mongooseUpdate.$set['workCycle.commitmentDeadline'] = new Date(Date.now() + (24 * 60 * 60 * 1000));
            }

            let actionLabel = 'ADMIN_ATTRIBUTED_ACTION';
            if (newStatus === 'FAILED') actionLabel = 'FORCE_UNASSIGNED';
            if (newStatus === 'RELEASED') actionLabel = 'JOB_RELEASED';

            auditLogsToPush.push({
                action: actionLabel,
                performedBy: targetAuthId,
                details: `Admin explicitly attributed the ${newStatus || currentIssue.status} status to this official.`
            });
        }

        if (isStatusUpdated) {
            if (newStatus === 'DISPUTED') {
                mongooseUpdate.$set.disputeEvidence = {
                    mediaUrl: r2PublicUrl || null,
                    adminRemark: officialRemark,
                    disputedAt: Date.now()
                };
            }

            if (newStatus === 'RESOLVED') {
                const targetAuthorityId = updateData.resolvedByAuthority || currentIssue.bidding?.winningBid?.authorityId;

                mongooseUpdate.$set.resolutionEvidence = {
                    mediaUrl: r2PublicUrl,
                    adminRemark: officialRemark,
                    resolvedAt: Date.now(),
                    resolvedByAuthority: targetAuthorityId || null
                };

                if (targetAuthorityId) {
                    const escrowPoints = calculateCsiReward(currentIssue.impactScore);

                    mongooseUpdate.$set['workCycle.escrow'] = {
                        isEscrowActive: true,
                        pointsHolding: escrowPoints,
                        citizenVerdict: 'PENDING',
                        autoReleaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
                    };
                    mongooseUpdate.$set['workCycle.isClockPaused'] = true;

                    pendingEscrowReward = { authorityId: targetAuthorityId, points: escrowPoints };

                    auditLogsToPush.push({
                        action: 'RESOLVED_AWAITING_ESCROW',
                        performedBy: userId,
                        details: `Admin forced resolution. ${escrowPoints} points locked in Escrow for Official.`
                    });
                }

                if (r2PublicUrl) {
                    if (!mongooseUpdate.$push) mongooseUpdate.$push = {};
                    mongooseUpdate.$push.media = {
                        url: r2PublicUrl,
                        type: file ? (file.mimetype.startsWith('video') ? 'video' : 'image') : 'image'
                    };
                }

                if (updateData.resolvedByAuthority) {
                    mongooseUpdate.$set.resolvedByAuthority = updateData.resolvedByAuthority;
                }
            }

            if (newStatus === 'ORPHANED') {
                mongooseUpdate.$set['bidding.winningBid'] = null;
                mongooseUpdate.$set['workCycle.commitmentDeadline'] = null;
            }
        }

        if (auditLogsToPush.length > 0) {
            pushQuery.auditLog = { $each: auditLogsToPush };
        }

        if (Object.keys(pushQuery).length > 0) {
            if (!mongooseUpdate.$push) mongooseUpdate.$push = {};
            Object.assign(mongooseUpdate.$push, pushQuery);
        }

        const updatedIssue = await Issue.findByIdAndUpdate(
            id,
            mongooseUpdate,
            { new: true, runValidators: true }
        );

        if (!updatedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        if (pendingEscrowReward) {
            await User.findByIdAndUpdate(pendingEscrowReward.authorityId, {
                $inc: {
                    'authorityProfile.csiInEscrow': pendingEscrowReward.points,
                    'authorityProfile.activeJobsCount': -1,
                    'authorityProfile.jobsCompleted': 1
                }
            });
        }

        if (isStatusUpdated) {
            try {
                let notificationType = null;
                if (newStatus === 'RESOLVED') notificationType = 'ISSUE_RESOLVED';
                if (['IN_REVIEW', 'PENDING_EXTENSION'].includes(newStatus)) notificationType = 'ISSUE_IN_REVIEW';
                if (['REJECTED', 'FAILED'].includes(newStatus)) notificationType = 'ISSUE_REJECTED';
                if (newStatus === 'LOCKED') notificationType = 'ISSUE_LOCKED';
                if (newStatus === 'DISPUTED') notificationType = 'ISSUE_DISPUTED';
                if (['ORPHANED', 'RELEASED'].includes(newStatus)) notificationType = 'ISSUE_ORPHANED';

                if (notificationType) {
                    const recipients = new Set();
                    if (updatedIssue.reportedBy) recipients.add(updatedIssue.reportedBy.toString());
                    if (updatedIssue.confirmations && updatedIssue.confirmations.length > 0) {
                        updatedIssue.confirmations.forEach(c => recipients.add(c.user.toString()));
                    }
                    if (updatedIssue.bidding && updatedIssue.bidding.bids && updatedIssue.bidding.bids.length > 0) {
                        updatedIssue.bidding.bids.forEach(b => recipients.add(b.authorityId.toString()));
                    }
                    if (updateData.resolvedByAuthority) {
                        recipients.add(updateData.resolvedByAuthority);
                    }

                    const message = officialRemark
                        ? `Admin Update (${newStatus}): "${officialRemark}" on an issue you interact with.`
                        : `The status of an issue you interact with has been updated to ${newStatus}.`;

                    Array.from(recipients).forEach(targetUserId => {
                        triggerNotification({
                            recipientId: targetUserId,
                            senderId: userId,
                            issueId: updatedIssue._id,
                            type: notificationType,
                            message: message,
                            io: io
                        }).catch(err => console.error("Background notification error:", err));
                    });
                }
            } catch (notificationError) {
                console.error("Non-fatal error checking admin notification triggers:", notificationError);
            }
        }

        // 🟢 FIXED: Clean, single real-time emission block
        if (io) {
            if (isStatusUpdated) {
                io.emit('issue_status_updated', {
                    issueId: updatedIssue._id,
                    newStatus: newStatus
                });
            }
            io.emit('issue_updated', {
                issueId: updatedIssue._id,
                updatedData: updatedIssue
            });
        }

        return res.status(200).json({
            success: true,
            message: isStatusUpdated ? `Issue status updated to ${newStatus}` : "Issue updated successfully",
            data: updatedIssue
        });

    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("Server Error in updating issue:", err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Could not update the issue",
            error: err.message
        });
    }
});

// Get a particular issue
adminRouter.get('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue id" });
        }

        // 🟢 FIX: Ensure BOTH fields are populated correctly
        const issue = await Issue.findById(id)
            .populate('reportedBy', 'name userName email')
            .populate('bidding.winningBid.authorityId', 'name userName role authorityProfile');

        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }
        return res.status(200).json({
            success: true,
            message: "Issue found for admin",
            data: issue
        });
    }
    catch (err) {
        console.log('Server Error: Cannot get the issue for admin', err);
        return res.status(500).json({ success: false, message: "Server Error: Cannot get the issue for admin" });
    }
});

// Delete an issue
adminRouter.delete('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue id" });
        }

        const deletedIssue = await Issue.findByIdAndDelete(id);

        if (!deletedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        await User.updateMany(
            { savedIssues: id },
            { $pull: { savedIssues: id } }
        );

        const io = req.app.get('io');
        if (io) {
            io.emit('global_feed_refresh');
        }

        return res.status(200).json({
            success: true,
            message: "Issue successfully deleted"
        });

    } catch (err) {
        console.log('Server Error: Cannot delete the issue', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot delete the issue"
        });
    }
});


// User Controlling Routes

// Get all the users 
adminRouter.get('/admin/users', userAuth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, search, role, state, district } = req.query;

        // 1. Build a master array of strict conditions
        const andConditions = [];

        // Rule A: Exclude the currently logged-in admin
        andConditions.push({ _id: { $ne: req.userId } });

        // Rule B: The Gatekeeper Rule
        // Only allow standard users/admins OR Officials/NGOs that are APPROVED
        andConditions.push({
            $or: [
                { role: { $nin: ['official', 'ngo'] } },
                { role: { $in: ['official', 'ngo'] }, 'authorityProfile.verificationStatus': 'APPROVED' }
            ]
        });

        // Rule C: Dropdown Role Filter
        if (role) {
            andConditions.push({ role: role.toLowerCase() });
        }

        // Rule D: Search Filter
        if (search) {
            andConditions.push({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { 'contact.email': { $regex: search, $options: 'i' } },
                    { userName: { $regex: search, $options: 'i' } }
                ]
            });
        }

        // Rule E: State Filter (Matches either standard user state OR authority assigned state)
        if (state) {
            andConditions.push({
                $or: [
                    { 'contact.state': { $regex: `^${state}$`, $options: 'i' } },
                    { 'authorityProfile.assignedState': { $regex: `^${state}$`, $options: 'i' } }
                ]
            });
        }

        // Rule F: District Filter (Matches either standard user city OR authority assigned district)
        if (district) {
            andConditions.push({
                $or: [
                    { 'contact.city': { $regex: `^${district}$`, $options: 'i' } },
                    { 'authorityProfile.assignedDistrict': { $regex: `^${district}$`, $options: 'i' } }
                ]
            });
        }

        // 2. Assemble the final query using the master array
        const finalQuery = { $and: andConditions };

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [users, total] = await Promise.all([
            User.find(finalQuery)
                .select('-password')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(finalQuery)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                users,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalUsers: total,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Server Error : Cannot get users', err);
        return res.status(500).json({ success: false, message: "Server Error : Cannot get users" });
    }
});

// Get everything about a specific user and their history
adminRouter.get('/admin/user/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User Id" });
        }

        const user = await User.findById(id).select("-password");
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Fetch detailed categorized history for the frontend tabs
        const history = {};

        // Note: Added 'category' to the select queries so the UI looks complete
        history.REPORTED = await Issue.find({ reportedBy: id, isDeleted: false }).select('title location category status createdAt');
        history.CONFIRMED = await Issue.find({ 'confirmations.user': id, isDeleted: false }).select('title location category status createdAt');
        history.FLAGGED = await Issue.find({ 'flags.flaggedBy': id, isDeleted: false }).select('title location category status createdAt');

        if (['official', 'ngo'].includes(user.role)) {
            // If they are an authority, fetch their professional metrics
            history.ASSIGNED = await Issue.find({ 'bidding.winningBid.authorityId': id, status: { $in: ['LOCKED', 'IN_REVIEW', 'PENDING_EXTENSION', 'AWAITING_HANDOVER'] }, isDeleted: false }).select('title location category status createdAt');
            history.COMPLETED = await Issue.find({ 'bidding.winningBid.authorityId': id, status: 'RESOLVED', isDeleted: false }).select('title location category status createdAt');
            history.BIDS = await Issue.find({ 'bidding.bids.authorityId': id, isDeleted: false }).select('title location category status createdAt');
            history.RELEASED = await Issue.find({ 'auditLog': { $elemMatch: { action: 'JOB_RELEASED', performedBy: id } }, isDeleted: false }).select('title location category status createdAt');

            // 🟢 NEW: Fetch FAILED Jobs (Handover Submitted, Ghost Abandonment, or Force Unassigned)
            history.FAILED = await Issue.find({
                'auditLog': {
                    $elemMatch: {
                        action: { $in: ['HANDOVER_SUBMITTED', 'GHOST_ABANDONMENT', 'FORCE_UNASSIGNED'] },
                        performedBy: id
                    }
                },
                isDeleted: false
            }).select('title location category status createdAt');
        }

        // 🟢 NEW: Fetch Leaderboard Rankings History
        // Find any leaderboard where this user appears in either array
        const leaderboards = await LeaderBoard.find({
            $or: [{ 'citizens.userId': id }, { 'authorities.userId': id }]
        }).sort({ createdAt: -1 }); // Sort by newest first

        const rankings = [];
        leaderboards.forEach(board => {
            // Determine which list to look in based on the user's role
            const targetList = ['official', 'ngo'].includes(user.role) ? board.authorities : board.citizens;

            // Find their specific entry
            const userEntry = targetList.find(entry => entry.userId.toString() === id.toString());

            if (userEntry) {
                rankings.push({
                    rank: userEntry.rank,
                    type: board.type || 'WEEKLY',
                    date: board.createdAt
                });
            }
        });
        history.RANKINGS = rankings;

        return res.status(200).json({
            success: true,
            message: "User details and history fetched successfully",
            data: { user, history } // Send back the grouped history object
        });

    } catch (err) {
        console.error("Server Error in getting user profile for admin", err);
        return res.status(500).json({ success: false, message: "Server Error in getting profile of user for admin" });
    }
});

// Update user account status (Suspend, Ban, Reactivate)
adminRouter.patch('/admin/user/:id/status', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { accountStatus } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User Id" });
        }

        const validStatus = ['ACTIVE', 'SUSPENDED', 'BANNED'];
        if (!validStatus.includes(accountStatus?.toUpperCase())) {
            return res.status(400).json({ success: false, message: 'Invalid account status.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            id,
            { $set: { accountStatus: accountStatus.toUpperCase() } },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 👇 TRIGGER NOTIFICATION BLOCK ADDED HERE
        try {
            const io = req.app.get('io');
            let notificationType = null;
            let message = "";

            if (accountStatus === 'SUSPENDED') {
                notificationType = 'ACCOUNT_SUSPENDED';
                message = "Your account has been temporarily suspended due to a policy violation.";
            } else if (accountStatus === 'BANNED') {
                notificationType = 'ACCOUNT_BANNED';
                message = "Your account has been permanently banned due to severe policy violations.";
            } else if (accountStatus === 'ACTIVE') {
                notificationType = 'ACCOUNT_RESTORED';
                message = "Your account status has been restored to Active. Welcome back!";
            }

            if (notificationType) {
                triggerNotification({
                    recipientId: updatedUser._id,
                    senderId: req.userId, // Admin ID
                    issueId: null, // Global notification
                    type: notificationType,
                    message: message,
                    io: io
                }).catch(err => console.error("Status notification error:", err));
            }
        } catch (notificationError) {
            console.error("Non-fatal error triggering account notification:", notificationError);
        }

        return res.status(200).json({
            success: true,
            message: `User status updated to ${accountStatus}`,
            data: updatedUser
        });
    }
    catch (err) {
        console.log('Server Error : Cannot update the user status', err);
        return res.status(500).json({ success: false, message: "Server Error : Could not update the user status" });
    }
});

// Permanently delete a user and their associated data
adminRouter.delete('/admin/user/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User id" });
        }

        // Find a user
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json(
                {
                    success: false,
                    message: "User not found"
                }
            )
        }

        // Prevent admin from deleting themselves accidentally
        if (id === req.userId) {
            return res.json(
                {
                    success: false,
                    message: "You cannot delete your own admin account"
                }
            )
        }

        // Delete all issues reported by this user
        await Issue.deleteMany({ reportedBy: id });

        // Remove user's confirmations from other issues
        await Issue.updateMany(
            { 'confirmations.user': id },
            { $pull: { confirmations: { user: id } } }
        );

        // Delete the user
        await User.findByIdAndDelete(id);
        const io = req.app.get('io');
        if (io) {
            io.emit('global_feed_refresh');
        }

        return res.status(200).json(
            {
                success: true,
                message: "User and their associated data have been permanently deleted"
            }
        )

    }
    catch (err) {
        console.log("Server Error: Cannot delete user", err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error: Could not delete user"
            }
        )
    }
})

// Updates any field in the user's profile
adminRouter.patch('/admin/user/:userId', userAuth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const updateData = req.body; // The fields the admin wants to change

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid User ID" });
        }

        // Prevent admin from accidentally changing the _id
        delete updateData._id;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
            success: true,
            message: "User profile updated successfully",
            data: updatedUser
        });

    } catch (err) {
        console.error('Server Error: Cannot update user profile', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot update user profile",
            error: err.message
        });
    }
});

// Fetches high-level stats for the admin dashboard
adminRouter.get('/admin/analytics/summary', userAuth, adminAuth, async (req, res) => {
    try {
        const [totalUsers, pendingRequests, totalOfficials, totalNGOs, totalIssues, statusCounts] = await Promise.all([

            User.countDocuments({ role: { $nin: ['official', 'ngo', 'other', 'admin'] } }),

            User.countDocuments({ role: { $in: ['official', 'ngo', 'other'] }, 'authorityProfile.verificationStatus': 'PENDING' }),

            User.countDocuments({ role: 'official', 'authorityProfile.verificationStatus': 'APPROVED' }),

            User.countDocuments({ role: { $in: ['ngo', 'other'] }, 'authorityProfile.verificationStatus': 'APPROVED' }),

            Issue.countDocuments(),
            Issue.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        ]);

        const issueStats = { OPEN: 0, IN_REVIEW: 0, RESOLVED: 0, REJECTED: 0 };
        statusCounts.forEach(stat => { issueStats[stat._id] = stat.count; });

        return res.status(200).json({
            success: true,
            message: "Analytics summary fetched successfully",
            data: {
                totalUsers,
                pendingRequests,
                totalOfficials,
                totalNGOs,
                totalIssues,
                issueStats
            }
        });
    } catch (err) {
        console.error('Server Error: Cannot fetch analytics summary', err);
        return res.status(500).json({ success: false, message: "Server Error: Analytics summary failed" });
    }
});

// Gets Data grouped by city to see where the most issues are
adminRouter.get('/admin/analytics/location', userAuth, adminAuth, async (req, res) => {
    try {
        const locationStats = await Issue.aggregate([
            {
                // Group by city
                $group: {
                    _id: "$location.city",
                    totalIssues: { $sum: 1 },
                    // Count only the open issues in this city
                    openIssues: {
                        $sum: { $cond: [{ $eq: ["$status", "OPEN"] }, 1, 0] }
                    },
                    // Count high priority issues
                    criticalIssues: {
                        $sum: { $cond: [{ $eq: ["$priority", "CRITICAL"] }, 1, 0] }
                    }
                }
            },
            { $sort: { totalIssues: -1 } } // Sort by most issues first
        ]);

        return res.status(200).json({
            success: true,
            message: "Location analytics fetched successfully",
            data: locationStats
        });

    } catch (err) {
        console.error('Server Error: Cannot fetch location analytics', err);
        return res.status(500).json({ success: false, message: "Server Error: Location analytics failed" });
    }
});


// OTHERS
// Sends a system-wide or location-specific notification via In-App and Email
adminRouter.post('/admin/broadcast', userAuth, adminAuth, async (req, res) => {
    try {
        const { title, message, targetState, targetCity, targetRole } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: "Broadcast message is required" });
        }

        // 1. Build a robust query filter (Removed the globalNotifications check)
        const andConditions = [];

        if (targetRole) {
            andConditions.push({ role: targetRole.toLowerCase() });
        }

        if (targetState) {
            andConditions.push({
                $or: [
                    { 'contact.state': { $regex: `^${targetState}$`, $options: 'i' } },
                    { 'authorityProfile.assignedState': { $regex: `^${targetState}$`, $options: 'i' } }
                ]
            });
        }

        if (targetCity) {
            andConditions.push({
                $or: [
                    { 'contact.city': { $regex: `^${targetCity}$`, $options: 'i' } },
                    { 'authorityProfile.assignedDistrict': { $regex: `^${targetCity}$`, $options: 'i' } }
                ]
            });
        }

        // If no filters are provided, userQuery is empty (targets everyone)
        const userQuery = andConditions.length > 0 ? { $and: andConditions } : {};

        // 2. Execute Query
        const targetUsers = await User.find(userQuery).select('_id');

        if (targetUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No users found matching your selected filters."
            });
        }

        const finalMessage = title ? `**${title}**\n${message}` : message;
        const io = req.app.get('io');
        const adminId = req.userId;

        // 3. Define the Background Batch Worker
        const processBroadcastInBackground = async (users) => {
            const BATCH_SIZE = 500;
            console.log(`[BROADCAST] Starting background processing for ${users.length} users in batches of ${BATCH_SIZE}.`);

            for (let i = 0; i < users.length; i += BATCH_SIZE) {
                const batch = users.slice(i, i + BATCH_SIZE);
                const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(users.length / BATCH_SIZE);

                console.log(`[BROADCAST] Processing batch ${currentBatchNum} of ${totalBatches}...`);

                // Process the current batch concurrently using your engine
                await Promise.all(
                    batch.map(user =>
                        triggerNotification({
                            recipientId: user._id,
                            senderId: adminId,
                            issueId: null, // Broadcasts aren't tied to a specific issue
                            type: 'SYSTEM_BROADCAST',
                            message: finalMessage,
                            io: io
                        }).catch(err => console.error(`[BROADCAST ERROR] Failed for user ${user._id}:`, err))
                    )
                );

                // Add a tiny breather between batches to respect rate limits
                if (i + BATCH_SIZE < users.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`[BROADCAST] Successfully completed for all ${users.length} users.`);
        };

        // 4. Fire the worker WITHOUT 'await' so it runs independently
        processBroadcastInBackground(targetUsers).catch(err =>
            console.error('[BROADCAST FATAL ERROR] Background worker crashed:', err)
        );

        // 5. Immediately release the client
        return res.status(200).json({
            success: true,
            message: `Broadcast is processing for ${targetUsers.length} users in the background.`,
        });

    } catch (err) {
        console.error('Server Error: Cannot send broadcast', err);
        return res.status(500).json({ success: false, message: "Server Error: Cannot send broadcast" });
    }
});

// Fetch all inquiries from the landing page, sorted by newest first
adminRouter.get('/admin/inquiries', userAuth, adminAuth, async (req, res) => {
    try {
        // 1. Grab optional query parameters for filtering and pagination
        // Example URL: /admin/inquiries?status=unread&page=1&limit=20
        const { status, page = 1, limit = 20 } = req.query;

        // 2. Build the database query
        const query = {};
        if (status) {
            // Ensure the admin passed a valid enum status before querying
            if (['unread', 'read', 'resolved'].includes(status)) {
                query.status = status;
            } else {
                return res.status(400).json({ success: false, message: "Invalid status filter" });
            }
        }

        // 3. Calculate how many documents to skip for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // 4. Run the queries in parallel (Fetch data + Count total for frontend math)
        const [inquiries, total] = await Promise.all([
            Inquiry.find(query)
                .sort({ createdAt: -1 }) // -1 puts the newest messages at the top
                .skip(skip)
                .limit(parseInt(limit)),
            Inquiry.countDocuments(query)
        ]);

        // 5. Send it all back
        return res.status(200).json({
            success: true,
            message: "Inquiries fetched successfully",
            data: {
                inquiries,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalInquiries: total,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (err) {
        console.error('Server Error: Cannot fetch inquiries', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot fetch inquiries"
        });
    }
});

// Update Inquiry Status
adminRouter.patch('/admin/inquiry/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Inquiry ID" });
        }

        const validStatuses = ['unread', 'read', 'resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status provided" });
        }

        const updatedInquiry = await Inquiry.findByIdAndUpdate(
            id,
            { $set: { status } },
            { new: true }
        );

        if (!updatedInquiry) {
            return res.status(404).json({ success: false, message: "Inquiry not found" });
        }

        return res.status(200).json({
            success: true,
            message: `Inquiry marked as ${status}`,
            data: updatedInquiry
        });

    } catch (err) {
        console.error('Server Error: Cannot update inquiry', err);
        return res.status(500).json({ success: false, message: "Server Error: Cannot update inquiry" });
    }
});

// ==========================================
// AUTHORITY REGISTRATION & GATEKEEPING
// ==========================================

// Fetch all pending NGO/Official registrations
adminRouter.get('/admin/pending-authorities', userAuth, adminAuth, async (req, res) => {
    try {
        const pendingUsers = await User.find({
            role: { $in: ['official', 'ngo', 'other'] },
            'authorityProfile.verificationStatus': 'PENDING'
        }).select('name userName contact role authorityProfile createdAt');
        return res.status(200).json({
            success: true,
            message: "Pending authorities fetched",
            count: pendingUsers.length,
            data: pendingUsers
        });
    } catch (err) {
        console.error('Server Error: Cannot fetch pending authorities', err);
        return res.status(500).json({ success: false, message: "Error fetching pending authorities" });
    }
});

// Approve an authority
adminRouter.patch('/admin/approve-authority/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;

        // 1. Auto-Generate a secure 8-character temporary password
        const tempPassword = crypto.randomBytes(4).toString('hex');

        // 2. Hash the new password before storing it
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // 3. Update User: Flip isVerified AND overwrite the dummy password
        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    'authorityProfile.verificationStatus': 'APPROVED',
                    password: hashedPassword
                }
            },
            { new: true }
        );

        if (!user) return res.status(404).json({ success: false, message: "Authority not found" });

        // 4. Trigger the Welcome Email & In-App Notification with Credentials
        try {
            const io = req.app.get('io');

            // Craft the message to include the logical username and the raw temporary password
            const credentialMessage = `Your authority account has been verified by the Admin. You can now log in and bid on local issues. Temporary Credentials — Username: ${user.userName} | Password: ${tempPassword} (Please update your password from your profile settings after logging in.)`;

            triggerNotification({
                recipientId: user._id,
                senderId: req.userId,
                issueId: null,
                type: 'AUTHORITY_APPROVED',
                message: credentialMessage,
                io: io
            }).catch(err => console.error("Approval notification error:", err));
        } catch (notificationError) {
            console.error("Non-fatal error triggering approval notification:", notificationError);
        }

        // 🟢 INJECT THE REAL-TIME EMIT RIGHT HERE
        const io = req.app.get('io');
        if (io) {
            io.emit('authority_status_updated', {
                authorityId: user._id,
                newStatus: 'APPROVED' // Hardcoded since this route is explicitly for approvals
            });
        }

        return res.status(200).json({
            success: true,
            message: "Authority approved and credentials dispatched successfully",
            data: user
        });
    } catch (err) {
        console.error('Server Error: Cannot approve authority', err);
        return res.status(500).json({ success: false, message: "Error approving authority" });
    }
});

adminRouter.get('/admin/authorities', userAuth, adminAuth, async (req, res) => {
    try {
        const { status } = req.query; // PENDING, APPROVED, or REJECTED

        const query = { role: { $in: ['official', 'ngo', 'other'] } };
        if (status) {
            query['authorityProfile.verificationStatus'] = status.toUpperCase();
        }

        const authorities = await User.find(query)
            .select('name userName contact role authorityProfile createdAt')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: `Fetched ${status || 'all'} authorities`,
            count: authorities.length,
            data: authorities
        });
    } catch (err) {
        console.error('Server Error: Cannot fetch authorities', err);
        return res.status(500).json({ success: false, message: "Error fetching authorities" });
    }
});

adminRouter.patch('/admin/authority/:id/status', userAuth, adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const { status, rejectionReason } = req.body; // 'PENDING', 'APPROVED', 'REJECTED'

        const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
        if (!validStatuses.includes(status?.toUpperCase())) {
            return res.status(400).json({ success: false, message: "Invalid status provided" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "Authority not found" });

        let updateData = { 'authorityProfile.verificationStatus': status.toUpperCase() };
        let notificationType = null;
        let notificationMessage = "";

        // Logic based on the new status
        if (status.toUpperCase() === 'APPROVED') {
            // Only generate password if they don't have one or if they are moving from Pending -> Approved for the first time
            const tempPassword = crypto.randomBytes(4).toString('hex');
            const hashedPassword = await bcrypt.hash(tempPassword, 10);

            updateData.password = hashedPassword;
            notificationType = 'AUTHORITY_APPROVED';
            notificationMessage = `Your authority account has been verified by the Admin. You can now log in and bid on local issues. Temporary Credentials — Username: ${user.userName} | Password: ${tempPassword} (Please update your password from your profile settings after logging in.)`;
        }
        else if (status.toUpperCase() === 'REJECTED') {
            notificationType = 'AUTHORITY_REJECTED';
            notificationMessage = `Unfortunately, your application to join LocalAwaaz as an Authority has been rejected. Reason: ${rejectionReason || 'Does not meet platform guidelines.'}`;
        }
        else if (status.toUpperCase() === 'PENDING') {
            notificationType = 'AUTHORITY_REVERTED';
            notificationMessage = `Your authority account status has been reverted to Pending for further administrative review. Your marketplace access is temporarily paused.`;
        }

        // Execute Update
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true }
        );

        // Trigger Notification
        if (notificationType) {
            try {
                triggerNotification({
                    recipientId: updatedUser._id,
                    senderId: req.userId,
                    issueId: null,
                    type: notificationType,
                    message: notificationMessage,
                    io: req.app.get('io')
                }).catch(err => console.error("Authority status notification error:", err));
            } catch (notificationError) {
                console.error("Non-fatal error triggering authority notification:", notificationError);
            }
        }

        // 🟢 INJECT THE REAL-TIME EMIT RIGHT HERE
        const io = req.app.get('io');
        if (io) {
            io.emit('authority_status_updated', {
                authorityId: updatedUser._id,
                newStatus: status.toUpperCase()
            });
        }

        return res.status(200).json({
            success: true,
            message: `Authority status updated to ${status.toUpperCase()}`,
            data: updatedUser
        });
    } catch (err) {
        console.error('Server Error: Cannot update authority status', err);
        return res.status(500).json({ success: false, message: "Error updating authority status" });
    }
});


// ==========================================
// GOD-MODE ADMINISTRATIVE CONTROLS & EXPORTS
// ==========================================

// 1. Manual Point Adjustment
adminRouter.patch('/admin/user/:id/points', userAuth, adminAuth, async (req, res) => {
    try {
        const { points, reason } = req.body;
        const userId = req.params.id;

        if (!reason || typeof points !== 'number') {
            return res.status(400).json({ success: false, message: "Points (number) and reason are required" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isAuthority = ['official', 'ngo'].includes(user.role);
        const pointField = isAuthority ? 'authorityProfile.csiScore' : 'civilScore';

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $inc: { [pointField]: points } },
            { new: true }
        );

        // Notify User
        triggerNotification({
            recipientId: user._id,
            senderId: req.userId,
            issueId: null,
            type: 'SYSTEM_BROADCAST',
            message: `Admin Adjustment: Your ${isAuthority ? 'CSI' : 'Civil'} Score has been modified by ${points > 0 ? '+' : ''}${points} points. Reason: ${reason}`,
            io: req.app.get('io')
        }).catch(err => console.log(err));

        return res.status(200).json({ success: true, message: "Points adjusted successfully", data: updatedUser });
    } catch (err) {
        console.error("Error adjusting points:", err);
        return res.status(500).json({ success: false, message: "Server error adjusting points" });
    }
});

// 2. Full Profile Override (Edit anything)
adminRouter.patch('/admin/user/:id/edit', userAuth, adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const updates = req.body;

        // Handle password change explicitly if provided
        if (updates.password && updates.password.trim() !== '') {
            updates.password = await bcrypt.hash(updates.password, 10);
        } else {
            delete updates.password; // Don't accidentally overwrite with empty string
        }

        // Structure nested updates properly for Mongoose
        const flattenedUpdates = {};
        for (const key in updates) {
            if (key === 'email' || key === 'city' || key === 'state') {
                flattenedUpdates[`contact.${key}`] = updates[key];
            } else if (key === 'departmentName' || key === 'assignedDistrict' || key === 'assignedState') {
                flattenedUpdates[`authorityProfile.${key}`] = updates[key];
            } else {
                flattenedUpdates[key] = updates[key];
            }
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: flattenedUpdates },
            { new: true }
        ).select('-password');

        return res.status(200).json({ success: true, message: "Profile heavily updated", data: updatedUser });
    } catch (err) {
        console.error("Error overriding profile:", err);
        return res.status(500).json({ success: false, message: "Server error overriding profile" });
    }
});

// 3. Fetch OPEN issues for a specific district     (For Force Assign dropdown)
adminRouter.get('/admin/issues/assignable', userAuth, adminAuth, async (req, res) => {
    try {
        // Find ANY issue globally that is NOT resolved or rejected.
        const issues = await Issue.find({
            status: { $nin: ['RESOLVED', 'REJECTED'] },
            isDeleted: false
        }).select('title category createdAt location status');

        return res.status(200).json({ success: true, data: issues });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to fetch assignable issues" });
    }
});

// 4. Force Assign Issue (Bypass bidding)
adminRouter.patch('/admin/issue/:id/force-assign', userAuth, adminAuth, async (req, res) => {
    try {
        const issueId = req.params.id;
        const { authorityId, commitmentTimeHours } = req.body;

        if (!commitmentTimeHours || isNaN(commitmentTimeHours) || commitmentTimeHours <= 0) {
            return res.status(400).json({ success: false, message: "Valid commitment hours are required" });
        }

        const hours = Number(commitmentTimeHours);

        const updateData = {
            status: 'LOCKED', // Instantly lock it from the marketplace
            'bidding.winningBid': {
                authorityId: authorityId,
                commitmentTimeHours: hours,
                acceptedAt: Date.now()
            },
            'workCycle.commitmentDeadline': new Date(Date.now() + (hours * 60 * 60 * 1000))
        };

        const pushData = {
            auditLog: { action: 'FORCE_ASSIGNED', performedBy: req.userId, details: `Admin force assigned with a ${hours} hour deadline.` },
            statusHistory: { status: 'LOCKED', changedBy: req.userId, remark: `Force Assigned by Admin. Time allotted: ${hours} hours.` }
        };

        const issue = await Issue.findByIdAndUpdate(
            issueId,
            { $set: updateData, $push: pushData },
            { new: true }
        );

        // Notify the assigned authority
        const io = req.app.get('io');
        triggerNotification({
            recipientId: authorityId,
            senderId: req.userId,
            issueId: issue._id,
            type: 'SYSTEM_BROADCAST',
            message: `URGENT: You have been forcefully assigned to issue "${issue.title}" by the Admin. You have ${hours} hours to resolve it.`,
            io: io
        }).catch(e => console.log(e));

        if (io) {
            io.emit('issue_status_updated', {
                issueId: issue._id, // or updatedIssue._id depending on the route
                newStatus: 'LOCKED' // or 'OPEN' for unassign
            });
            // 🟢 ADD THIS: Broadcast the full issue so the Official Name and Deadline update!
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue // Make sure to pass the updated document here!
            });
        }
        return res.status(200).json({ success: true, message: "Issue forcefully assigned and locked" });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to force assign" });
    }
});

// 5. Force Unassign Issue (Kick authority off job)
adminRouter.patch('/admin/issue/:id/force-unassign', userAuth, adminAuth, async (req, res) => {
    try {
        const issueId = req.params.id;
        const { reason, penaltyPoints } = req.body;

        const issue = await Issue.findById(issueId);
        if (!issue || !issue.bidding?.winningBid?.authorityId) return res.status(400).json({ success: false, message: "Issue is not currently assigned" });

        const authorityId = issue.bidding.winningBid.authorityId;

        await Issue.findByIdAndUpdate(issueId, {
            $set: { status: 'OPEN', 'bidding.winningBid': null, 'workCycle.commitmentDeadline': null },
            $push: {
                auditLog: { action: 'FORCE_UNASSIGNED', performedBy: req.userId, details: reason },
                statusHistory: { status: 'OPEN', changedBy: req.userId, remark: `Unassigned by Admin: ${reason}` }
            }
        });

        if (penaltyPoints && penaltyPoints > 0) {
            await User.findByIdAndUpdate(authorityId, {
                $inc: { 'authorityProfile.csiScore': -Math.abs(penaltyPoints), 'authorityProfile.jobsFailed': 1 }
            });
        }

        triggerNotification({
            recipientId: authorityId, senderId: req.userId, issueId: issue._id, type: 'SYSTEM_BROADCAST',
            message: `Admin has forcefully removed you from the issue "${issue.title}". Penalty: -${penaltyPoints || 0} CSI. Reason: ${reason}`,
            io: req.app.get('io')
        }).catch(e => console.log(e));

        // 🟢 FIXED: Broadcast OPEN status and refresh feed
        const io = req.app.get('io');
        if (io) {
            io.emit('issue_status_updated', {
                issueId: issueId,
                newStatus: 'OPEN'
            });
            io.emit('global_feed_refresh');
        }

        return res.status(200).json({ success: true, message: "Authority stripped from issue" });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to force unassign" });
    }
});

// 6. Global Excel Export (All filtered users)
adminRouter.get('/admin/export/users', userAuth, adminAuth, async (req, res) => {
    try {
        const { search, role, state, district } = req.query;

        // Build exact same filter as GET /users
        const andConditions = [{ _id: { $ne: req.userId } }];
        andConditions.push({
            $or: [
                { role: { $nin: ['official', 'ngo'] } },
                { role: { $in: ['official', 'ngo'] }, 'authorityProfile.verificationStatus': 'APPROVED' }
            ]
        });
        if (role) andConditions.push({ role: role.toLowerCase() });
        if (search) andConditions.push({ $or: [{ name: { $regex: search, $options: 'i' } }, { 'contact.email': { $regex: search, $options: 'i' } }] });
        if (state) andConditions.push({ $or: [{ 'contact.state': { $regex: `^${state}$`, $options: 'i' } }, { 'authorityProfile.assignedState': { $regex: `^${state}$`, $options: 'i' } }] });
        if (district) andConditions.push({ $or: [{ 'contact.city': { $regex: `^${district}$`, $options: 'i' } }, { 'authorityProfile.assignedDistrict': { $regex: `^${district}$`, $options: 'i' } }] });

        const users = await User.find({ $and: andConditions }).sort({ createdAt: -1 });

        // Initialize Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Users Export');

        worksheet.columns = [
            { header: 'ID', key: '_id', width: 25 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Role', key: 'role', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'City/District', key: 'location', width: 20 },
            { header: 'Joined Date', key: 'joined', width: 20 },
            { header: 'Last Login', key: 'lastLogin', width: 20 },
            { header: 'Civil Score', key: 'civilScore', width: 15 },
            { header: 'CSI Score', key: 'csiScore', width: 15 }
        ];

        users.forEach(u => {
            worksheet.addRow({
                _id: u._id.toString(),
                name: u.name,
                email: u.contact?.email || 'N/A',
                role: u.role.toUpperCase(),
                status: u.accountStatus || 'ACTIVE',
                location: u.authorityProfile?.assignedDistrict || u.contact?.city || 'N/A',
                joined: new Date(u.createdAt).toLocaleString(),
                lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'N/A',
                civilScore: u.civilScore || 0,
                csiScore: u.authorityProfile?.csiScore || 0
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=LocalAwaaz_Users.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating Excel file');
    }
});

// 7. Individual Forensic Excel Export (Multi-Tabbed)
adminRouter.get('/admin/export/user/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);
        if (!user) return res.status(404).send('User not found');

        const workbook = new ExcelJS.Workbook();

        // Tab 1: Profile Info
        const profileSheet = workbook.addWorksheet('Profile Summary');
        profileSheet.addRow(['Field', 'Data']);
        profileSheet.addRow(['Name', user.name]);
        profileSheet.addRow(['Role', user.role.toUpperCase()]);
        profileSheet.addRow(['Email', user.contact?.email]);
        profileSheet.addRow(['Joined', new Date(user.createdAt).toLocaleString()]);
        profileSheet.addRow(['Last Login', user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'N/A']);
        if (['official', 'ngo'].includes(user.role)) {
            profileSheet.addRow(['CSI Score', user.authorityProfile?.csiScore]);
            profileSheet.addRow(['Jobs Completed', user.authorityProfile?.jobsCompleted]);
            profileSheet.addRow(['Jobs Failed', user.authorityProfile?.jobsFailed]);
            profileSheet.addRow(['Jobs Released', user.authorityProfile?.jobsReleased]);
        }

        // Tab 2: Reported Issues
        const reportedIssues = await Issue.find({ reportedBy: userId });
        const repSheet = workbook.addWorksheet('Reported Issues');
        repSheet.columns = [{ header: 'Title', key: 'title', width: 30 }, { header: 'Status', key: 'status', width: 15 }, { header: 'Date', key: 'date', width: 20 }];
        reportedIssues.forEach(i => repSheet.addRow({ title: i.title, status: i.status, date: new Date(i.createdAt).toLocaleString() }));

        // Tab 3: Authority Jobs (If Official/NGO)
        if (['official', 'ngo'].includes(user.role)) {
            const assignedJobs = await Issue.find({ 'bidding.winningBid.authorityId': userId });
            const jobSheet = workbook.addWorksheet('Assigned Jobs History');
            jobSheet.columns = [
                { header: 'Issue Title', key: 'title', width: 30 },
                { header: 'Current Status', key: 'status', width: 15 },
                { header: 'Bid Won At', key: 'wonAt', width: 20 },
                { header: 'Proposed Time (Hrs)', key: 'time', width: 15 }
            ];
            assignedJobs.forEach(i => {
                jobSheet.addRow({
                    title: i.title,
                    status: i.status,
                    wonAt: i.bidding?.winningBid?.acceptedAt ? new Date(i.bidding.winningBid.acceptedAt).toLocaleString() : 'N/A',
                    time: i.bidding?.winningBid?.proposedTimeHours || 'N/A'
                });
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Audit_${user.name.replace(/\s+/g, '_')}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating Excel file');
    }
});

adminRouter.get('/admin/export/issues', userAuth, adminAuth, async (req, res) => {
    try {
        const { status, state, city, pinCode, reporterRole, search } = req.query;
        const query = {};

        // 1. Status Filter
        if (status && typeof status === 'string') query.status = status.toUpperCase();

        // 2. Geographic Filters
        if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
        if (city) query['location.city'] = { $regex: `^${city}$`, $options: 'i' };
        if (pinCode) query['location.pinCode'] = pinCode;

        // 3. Reporter Role Filter
        if (reporterRole) {
            let mappedRole = reporterRole.toLowerCase();
            if (mappedRole === 'citizen') mappedRole = 'user';
            const usersWithRole = await User.find({ role: mappedRole }).select('_id');
            query.reportedBy = { $in: usersWithRole.map(u => u._id) };
        }

        // 4. Global Search
        if (search) {
            const searchConditions = [
                { title: { $regex: search, $options: 'i' } },
                { 'location.pinCode': { $regex: search, $options: 'i' } }
            ];
            if (mongoose.Types.ObjectId.isValid(search.trim())) {
                searchConditions.push({ _id: search.trim() });
            }
            query.$or = searchConditions;
        }

        // Fetch all matching issues (No pagination limit for exports)
        const issues = await Issue.find(query)
            .sort({ createdAt: -1 })
            .populate('reportedBy', 'name email role');

        // Initialize Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Issues Export');

        worksheet.columns = [
            { header: 'Issue ID', key: '_id', width: 25 },
            { header: 'Title', key: 'title', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Priority', key: 'priority', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'City', key: 'city', width: 20 },
            { header: 'State', key: 'state', width: 20 },
            { header: 'Reported By', key: 'reporterName', width: 25 },
            { header: 'Reporter Role', key: 'reporterRole', width: 15 },
            { header: 'Created At', key: 'createdAt', width: 20 }
        ];

        issues.forEach(i => {
            const reporterName = i.isAnonymous ? 'Anonymous' : (i.reportedBy?.name || 'Unknown');
            const role = i.isAnonymous ? 'N/A' : (i.reportedBy?.role || 'Citizen').toUpperCase();

            worksheet.addRow({
                _id: i._id.toString(),
                title: i.title,
                category: i.category || 'N/A',
                priority: i.priority || 'LOW',
                status: i.status,
                city: i.location?.city || 'N/A',
                state: i.location?.state || 'N/A',
                reporterName: reporterName,
                reporterRole: role,
                createdAt: new Date(i.createdAt).toLocaleString()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=LocalAwaaz_Issues.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Export issues error:", err);
        res.status(500).send('Error generating Excel file');
    }
});

// Delete an issue (Nuclear Delete)
adminRouter.delete('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue id" });
        }

        const deletedIssue = await Issue.findByIdAndDelete(id);

        if (!deletedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        // Scrub from all users' saved lists
        await User.updateMany(
            { savedIssues: id },
            { $pull: { savedIssues: id } }
        );

        // Scrub all ghost notifications tied to this deleted issue
        await Notification.deleteMany({ issue: id });
        const io = req.app.get('io');
        if (io) {
            io.emit('issue_deleted', { issueId: id }); // Changed from global_feed_refresh
        }

        return res.status(200).json({
            success: true,
            message: "Issue and related data successfully wiped"
        });

    } catch (err) {
        console.error('Server Error: Cannot delete the issue', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot delete the issue"
        });
    }
});

// ==========================================
// ORPHANED / STAGNANT ISSUES (TRIAGE CENTER)
// ==========================================

// 1. Fetch Orphaned Issues (> 7 Days Old, Still OPEN)
adminRouter.get('/admin/orphaned', userAuth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, state, city } = req.query;

        // Calculate the exact timestamp for 7 days ago
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const query = {
            $or: [
                { status: 'ORPHANED' },
                { status: 'OPEN', createdAt: { $lte: sevenDaysAgo } }
            ],
            isDeleted: false
        };

        if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
        if (city) query['location.city'] = { $regex: `^${city}$`, $options: 'i' };

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [issues, total] = await Promise.all([
            // Sort by oldest first so the most ignored issues are at the very top
            Issue.find(query).sort({ createdAt: 1 }).skip(skip).limit(parseInt(limit)).populate('reportedBy', 'name role'),
            Issue.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                issues,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalIssues: total
                }
            }
        });
    } catch (err) {
        console.error("Error fetching orphaned issues:", err);
        return res.status(500).json({ success: false, message: "Server Error fetching orphaned issues" });
    }
});

// 2. Artificial Score Boost (Bounty System)
adminRouter.patch('/admin/issue/:id/boost', userAuth, adminAuth, async (req, res) => {
    try {
        const { bonusPoints } = req.body;
        if (!bonusPoints || isNaN(bonusPoints)) return res.status(400).json({ success: false, message: "Valid bonus points required" });

        const issue = await Issue.findByIdAndUpdate(
            req.params.id,
            {
                $inc: { impactScore: Number(bonusPoints) },
                $push: { auditLog: { action: 'SCORE_BOOSTED', performedBy: req.userId, details: `Admin artificially boosted the impact score by ${bonusPoints} to attract bidders.` } }
            },
            { new: true }
        );
        const io = req.app.get('io');
        if (io) {
            io.emit('issue_stats_updated', {
                issueId: issue._id,
                impactScore: issue.impactScore
            });
        }

        return res.status(200).json({ success: true, message: `Score boosted by ${bonusPoints}`, data: issue });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to boost score" });
    }
});

// 3. Re-Categorize & Prioritize
adminRouter.patch('/admin/issue/:id/recategorize', userAuth, adminAuth, async (req, res) => {
    try {
        const { category, priority } = req.body;

        const issue = await Issue.findByIdAndUpdate(
            req.params.id,
            {
                $set: { category, priority },
                $push: { auditLog: { action: 'RECATEGORIZED', performedBy: req.userId, details: `Admin re-categorized to ${category} and set priority to ${priority}.` } }
            },
            { new: true }
        );
        const io = req.app.get('io');
        if (io) {
            io.emit('issue_updated', {
                issueId: issue._id,
                updatedData: issue
            });
        }

        return res.status(200).json({ success: true, message: "Issue re-categorized successfully", data: issue });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to recategorize issue" });
    }
});

// 4. Localized SOS Broadcast
adminRouter.post('/admin/issue/:id/sos', userAuth, adminAuth, async (req, res) => {
    try {
        const issue = await Issue.findById(req.params.id);
        if (!issue) return res.status(404).json({ success: false, message: 'Issue not found' });

        const district = issue.location?.city || issue.location?.district;
        if (!district) return res.status(400).json({ success: false, message: 'Issue has no valid district for SOS routing' });

        // Find all approved officials/NGOs assigned to or living in this district
        const localAuthorities = await User.find({
            role: { $in: ['official', 'ngo'] },
            'authorityProfile.verificationStatus': 'APPROVED',
            $or: [
                { 'authorityProfile.assignedDistrict': { $regex: `^${district}$`, $options: 'i' } },
                { 'contact.city': { $regex: `^${district}$`, $options: 'i' } }
            ]
        }).select('_id');

        if (localAuthorities.length === 0) {
            return res.status(404).json({ success: false, message: `No verified authorities found in ${district} to receive the SOS.` });
        }

        const io = req.app.get('io');
        const sosMessage = `🚨 URGENT: A critical issue in ${district} has been ignored for over 7 days. High CSI reward available for immediate resolution!`;

        // Blast the notification
        localAuthorities.forEach(auth => {
            triggerNotification({
                recipientId: auth._id,
                senderId: req.userId,
                issueId: issue._id,
                type: 'SYSTEM_BROADCAST',
                message: sosMessage,
                io: io
            }).catch(e => console.log("SOS send error:", e));
        });

        // Log the blast
        await Issue.findByIdAndUpdate(issue._id, {
            $push: { auditLog: { action: 'SOS_BROADCAST_SENT', performedBy: req.userId, details: `SOS broadcast fired to ${localAuthorities.length} authorities in ${district}.` } }
        });

        return res.status(200).json({ success: true, message: `SOS blasted to ${localAuthorities.length} local authorities!` });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to send SOS broadcast" });
    }
});

// ==========================================
// ESCALATION & TRIAGE CENTER (Orphaned + Disputed)
// ==========================================

adminRouter.get('/admin/triage', userAuth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, state, city, status } = req.query;

        // Calculate the exact timestamp for 7 days ago (for auto-orphaned detection)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const orConditions = [];

        // If no status filter is applied, or if 'ORPHANED' is explicitly selected
        if (!status || status === 'ORPHANED') {
            orConditions.push({ status: 'ORPHANED' });
            orConditions.push({ status: 'OPEN', createdAt: { $lte: sevenDaysAgo } });
        }

        // If no status filter is applied, or if 'DISPUTED' is explicitly selected
        if (!status || status === 'DISPUTED') {
            orConditions.push({ status: 'DISPUTED' });
        }

        const query = {
            $or: orConditions,
            isDeleted: false
        };

        if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
        if (city) query['location.city'] = { $regex: `^${city}$`, $options: 'i' };

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [issues, total] = await Promise.all([
            // Sort by oldest first so the most ignored/stalled issues are at the very top
            Issue.find(query).sort({ createdAt: 1 }).skip(skip).limit(parseInt(limit)).populate('reportedBy', 'name role'),
            Issue.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                issues,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalIssues: total
                }
            }
        });
    } catch (err) {
        console.error("Error fetching triage issues:", err);
        return res.status(500).json({ success: false, message: "Server Error fetching triage issues" });
    }
});

// Export Triage Issues to Excel
adminRouter.get('/admin/export/triage', userAuth, adminAuth, async (req, res) => {
    try {
        const { state, city, status } = req.query;
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const orConditions = [];

        if (!status || status === 'ORPHANED') {
            orConditions.push({ status: 'ORPHANED' });
            orConditions.push({ status: 'OPEN', createdAt: { $lte: sevenDaysAgo } });
        }
        if (!status || status === 'DISPUTED') {
            orConditions.push({ status: 'DISPUTED' });
        }

        const query = { $or: orConditions, isDeleted: false };
        if (state) query['location.state'] = { $regex: `^${state}$`, $options: 'i' };
        if (city) query['location.city'] = { $regex: `^${city}$`, $options: 'i' };

        const issues = await Issue.find(query).sort({ createdAt: 1 }).populate('reportedBy', 'name email role');

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Triage Export');

        worksheet.columns = [
            { header: 'Issue ID', key: '_id', width: 25 },
            { header: 'Title', key: 'title', width: 35 },
            { header: 'Escalation Type', key: 'escalationType', width: 20 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Impact Score', key: 'impactScore', width: 15 },
            { header: 'City', key: 'city', width: 20 },
            { header: 'State', key: 'state', width: 20 },
            { header: 'Reported By', key: 'reporterName', width: 25 },
            { header: 'Days Stagnant', key: 'stagnant', width: 15 },
            { header: 'Created At', key: 'createdAt', width: 20 }
        ];

        issues.forEach(i => {
            const isDisputed = i.status === 'DISPUTED';
            const stagnantDays = Math.floor((new Date() - new Date(i.createdAt)) / (1000 * 60 * 60 * 24));

            worksheet.addRow({
                _id: i._id.toString(),
                title: i.title,
                escalationType: isDisputed ? 'DISPUTED' : 'ORPHANED',
                category: i.category || 'N/A',
                impactScore: i.impactScore || 0,
                city: i.location?.city || 'N/A',
                state: i.location?.state || 'N/A',
                reporterName: i.isAnonymous ? 'Anonymous' : (i.reportedBy?.name || 'Unknown'),
                stagnant: stagnantDays,
                createdAt: new Date(i.createdAt).toLocaleString()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Triage_Escalations.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error("Export triage error:", err);
        res.status(500).send('Error generating Excel file');
    }
});

// 🟢 NEW: Dedicated Extension Handler Route
adminRouter.patch('/admin/issue/:id/extension', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { action, adminRemark, timeValue, timeUnit } = req.body;

        const issue = await Issue.findById(id);
        if (!issue || issue.status !== 'PENDING_EXTENSION') {
            return res.status(400).json({ success: false, message: "Issue is not pending an extension" });
        }

        const requestIndex = issue.workCycle.extensionRequests.findIndex(r => r.status === 'PENDING');
        if (requestIndex === -1) {
            return res.status(400).json({ success: false, message: "No pending extension request found" });
        }

        const finalTimeValue = timeValue || issue.workCycle.extensionRequests[requestIndex].requestedTimeValue;
        const finalTimeUnit = timeUnit || issue.workCycle.extensionRequests[requestIndex].requestedTimeUnit;

        const multipliers = { 'HOURS': 1, 'DAYS': 24, 'WEEKS': 168, 'MONTHS': 720 };
        const totalHours = finalTimeValue * (multipliers[finalTimeUnit] || 1);

        const now = new Date();
        const pausedDurationMs = issue.workCycle.pausedAt ? (now.getTime() - issue.workCycle.pausedAt.getTime()) : 0;

        const update = {
            $set: {
                status: 'LOCKED',
                'workCycle.isClockPaused': false,
                'workCycle.pausedAt': null,
                [`workCycle.extensionRequests.${requestIndex}.status`]: action,
                [`workCycle.extensionRequests.${requestIndex}.adminRemark`]: adminRemark || '',
                [`workCycle.extensionRequests.${requestIndex}.requestedTimeValue`]: Number(finalTimeValue),
                [`workCycle.extensionRequests.${requestIndex}.requestedTimeUnit`]: finalTimeUnit,
                [`workCycle.extensionRequests.${requestIndex}.hoursRequested`]: totalHours
            },
            $push: {
                statusHistory: {
                    status: 'LOCKED',
                    changedBy: req.userId,
                    remark: `Extension ${action}: ${finalTimeValue} ${finalTimeUnit}. ${adminRemark || ''}`
                },
                auditLog: {
                    action: action === 'APPROVED' ? 'EXTENSION_APPROVED' : 'EXTENSION_REJECTED',
                    performedBy: req.userId,
                    details: `Admin ${action.toLowerCase()} extension of ${totalHours} hours.`
                }
            }
        };

        if (action === 'APPROVED') {
            const extraTimeMs = totalHours * 60 * 60 * 1000;
            update.$set['workCycle.commitmentDeadline'] = new Date(issue.workCycle.commitmentDeadline.getTime() + extraTimeMs + pausedDurationMs);
        } else {
            update.$set['workCycle.commitmentDeadline'] = new Date(issue.workCycle.commitmentDeadline.getTime() + pausedDurationMs);
        }

        const updatedIssue = await Issue.findByIdAndUpdate(id, update, { new: true });

        if (updatedIssue.bidding?.winningBid?.authorityId) {
            triggerNotification({
                recipientId: updatedIssue.bidding.winningBid.authorityId,
                senderId: req.userId,
                issueId: updatedIssue._id,
                type: 'URGENT',
                message: `Your extension request for "${updatedIssue.title}" was ${action}.`,
                io: req.app.get('io')
            }).catch(e => console.error(e));
        }

        // 🟢 FIXED: Broadcasting using 'updatedIssue' so the correct data goes out
        const io = req.app.get('io');
        if (io) {
            io.emit('issue_status_updated', {
                issueId: updatedIssue._id,
                newStatus: 'LOCKED'
            });
            io.emit('issue_updated', {
                issueId: updatedIssue._id,
                updatedData: updatedIssue
            });
        }

        return res.status(200).json({ success: true, message: `Extension ${action.toLowerCase()} successfully`, data: updatedIssue });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to process extension" });
    }
});

module.exports = adminRouter