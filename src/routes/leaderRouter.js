const express = require('express');
const leaderRouter = express.Router();
const LeaderBoard = require('../models/LeaderBoard');
const { default: axios } = require('axios');
const User = require('../models/User');
const userAuth = require('../middlewares/userAuth');
const Issue = require('../models/Issue');

// GET: Fetch the current active weekly leaderboard
leaderRouter.get('/current', async (req, res) => {
    try {
        const currentBoard = await LeaderBoard.findOne({ type: 'WEEKLY' })
            .sort({ createdAt: -1 })
            // 🟢 FIXED: Changed issuesConfirmed to issuesFlagged to match the User schema
            .populate(
                'citizens.userId',
                'name profilePic rank badges issuesReported issuesResolved issuesFlagged civilScore accountStatus'
            )
            .populate(
                'authorities.userId',
                'name profilePic accountStatus badges authorityProfile.designation authorityProfile.departmentName authorityProfile.org authorityProfile.verificationStatus authorityProfile.activeJobsCount authorityProfile.jobsCompleted authorityProfile.jobsFailed authorityProfile.jobsReleased'
            );

        if (!currentBoard) {
            return res.status(404).json({ success: false, message: "No leaderboard active yet." });
        }

        res.status(200).json({
            success: true,
            data: currentBoard
        });

    } catch (error) {
        console.error("Leaderboard Fetch Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

leaderRouter.get('/proxy-image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('URL required');

        const response = await axios.get(imageUrl, { responseType: 'stream' });
        res.set('Content-Type', response.headers['content-type']);
        res.set('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Failed to fetch image');
    }
});

leaderRouter.get('/leaderboard/user/:id', userAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Exclude sensitive data
        const user = await User.findById(id).select('-password -fcmToken -savedIssues');
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const history = {};

        history.REPORTED = await Issue.find({ reportedBy: id, isDeleted: false }).select('title location category status createdAt');
        history.CONFIRMED = await Issue.find({ 'confirmations.user': id, isDeleted: false }).select('title location category status createdAt');
        history.FLAGGED = await Issue.find({ 'flags.flaggedBy': id, isDeleted: false }).select('title location category status createdAt');

        if (['official', 'ngo'].includes(user.role)) {
            history.ASSIGNED = await Issue.find({ 'bidding.winningBid.authorityId': id, status: { $in: ['LOCKED', 'IN_REVIEW', 'PENDING_EXTENSION', 'AWAITING_HANDOVER'] }, isDeleted: false }).select('title location category status createdAt');
            history.COMPLETED = await Issue.find({ 'bidding.winningBid.authorityId': id, status: 'RESOLVED', isDeleted: false }).select('title location category status createdAt');
            history.BIDS = await Issue.find({ 'bidding.bids.authorityId': id, isDeleted: false }).select('title location category status createdAt');
            history.RELEASED = await Issue.find({ 'auditLog': { $elemMatch: { action: 'JOB_RELEASED', performedBy: id } }, isDeleted: false }).select('title location category status createdAt');
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

        const leaderboards = await LeaderBoard.find({
            $or: [{ 'citizens.userId': id }, { 'authorities.userId': id }]
        }).sort({ createdAt: -1 });

        const rankings = [];
        leaderboards.forEach(board => {
            const targetList = ['official', 'ngo'].includes(user.role) ? board.authorities : board.citizens;
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
            data: { user, history }
        });

    } catch (err) {
        console.error("Server Error in getting leaderboard profile", err);
        return res.status(500).json({ success: false, message: "Server Error fetching profile" });
    }
});

module.exports = leaderRouter;