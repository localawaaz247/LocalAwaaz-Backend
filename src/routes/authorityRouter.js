const express = require('express');
const Issue = require('../models/Issue');
const User = require('../models/User'); // Required for deducting points
const userAuth = require('../middlewares/userAuth');
const authorityAuth = require('../middlewares/authorityAuth');

const authorityRouter = express.Router();

/**
 * ==========================================
 * AUTHORITY ACTIONS (The Marketplace)
 * ==========================================
 */

// Place a time bid on an OPEN issue
authorityRouter.post('/market/bid/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { proposedTimeHours } = req.body;
        const issueId = req.params.issueId;

        if (!proposedTimeHours) return res.status(400).json({ success: false, message: "Time commitment is required" });

        const issue = await Issue.findById(issueId);

        if (!issue) return res.status(404).json({ success: false, message: "Issue not found" });
        if (issue.status !== 'OPEN') return res.status(400).json({ success: false, message: "Issue is no longer open for bidding" });

        // Check if 24h window has expired
        if (Date.now() > new Date(issue.bidding.windowEndsAt).getTime()) {
            return res.status(400).json({ success: false, message: "Bidding window has closed" });
        }

        // Add the bid
        issue.bidding.bids.push({
            authorityId: req.userId,
            proposedTimeHours: proposedTimeHours
        });

        // Lock-in logic (First come, first serve)
        issue.bidding.winningBid = {
            authorityId: req.userId,
            commitmentTimeHours: proposedTimeHours,
            acceptedAt: Date.now()
        };

        // Calculate the hard deadline
        const deadline = new Date(Date.now() + (proposedTimeHours * 60 * 60 * 1000));
        issue.workCycle.commitmentDeadline = deadline;
        issue.status = 'LOCKED';

        // Log the action
        issue.auditLog.push({
            action: "BID_ACCEPTED",
            performedBy: req.userId,
            details: `Job locked with a commitment of ${proposedTimeHours} hours.`
        });

        await issue.save();

        return res.status(200).json({ success: true, message: "Bid accepted. Job locked.", deadline });
    } catch (err) {
        console.error("Bidding Error:", err);
        return res.status(500).json({ success: false, message: "Server error during bidding" });
    }
});

// Request an extension (1-24 hours max)
authorityRouter.post('/market/extension/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { hoursRequested, reason } = req.body;
        const issueId = req.params.issueId;

        if (!hoursRequested || hoursRequested < 1 || hoursRequested > 24) {
            return res.status(400).json({ success: false, message: "Extension must be between 1 and 24 hours" });
        }
        if (!reason) return res.status(400).json({ success: false, message: "A reason is required" });

        const issue = await Issue.findById(issueId);

        // Security: Ensure only the winning authority can request an extension
        if (issue.bidding.winningBid.authorityId.toString() !== req.userId) {
            return res.status(403).json({ success: false, message: "You do not own this job" });
        }

        if (issue.status !== 'LOCKED' && issue.status !== 'IN_PROGRESS') {
            return res.status(400).json({ success: false, message: "Cannot extend time for this issue status" });
        }

        // Add extension and update deadline
        issue.workCycle.extensionRequests.push({ hoursRequested, reason });

        const currentDeadline = new Date(issue.workCycle.commitmentDeadline).getTime();
        issue.workCycle.commitmentDeadline = new Date(currentDeadline + (hoursRequested * 60 * 60 * 1000));

        issue.auditLog.push({
            action: "EXTENSION_REQUESTED",
            performedBy: req.userId,
            details: `Extended by ${hoursRequested} hours. Reason: ${reason}`
        });

        await issue.save();

        return res.status(200).json({ success: true, message: "Extension granted", newDeadline: issue.workCycle.commitmentDeadline });
    } catch (err) {
        console.error("Extension Error:", err);
        return res.status(500).json({ success: false, message: "Server error during extension request" });
    }
});

// Release / Abandon a Job
authorityRouter.post('/market/release/:issueId', userAuth, authorityAuth, async (req, res) => {
    try {
        const { releaseApology } = req.body;
        const issueId = req.params.issueId;

        if (!releaseApology) return res.status(400).json({ success: false, message: "A public apology/reason is required to release a job" });

        const issue = await Issue.findById(issueId);

        if (issue.bidding.winningBid.authorityId.toString() !== req.userId) {
            return res.status(403).json({ success: false, message: "You do not own this job" });
        }

        issue.workCycle.releaseApology = releaseApology;
        issue.status = 'OPEN'; // Throw back to the pool

        // Clear winning bid so it can be re-bid
        issue.bidding.winningBid = null;
        issue.workCycle.commitmentDeadline = null;

        issue.auditLog.push({
            action: "JOB_RELEASED",
            performedBy: req.userId,
            details: `Job abandoned. Reason: ${releaseApology}`
        });

        await issue.save();

        // Deduct points from the Authority's CSI score here
        await User.findByIdAndUpdate(req.userId, {
            $inc: { 'authorityProfile.jobsReleased': 1, 'authorityProfile.csiScore': -50 }
        });

        return res.status(200).json({ success: true, message: "Job released back to the marketplace. Penalties applied." });
    } catch (err) {
        console.error("Release Error:", err);
        return res.status(500).json({ success: false, message: "Server error releasing job" });
    }
});

module.exports = authorityRouter;