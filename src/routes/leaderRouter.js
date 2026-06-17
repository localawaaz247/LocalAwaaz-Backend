const express = require('express');
const leaderRouter = express.Router();
const LeaderBoard = require('../models/LeaderBoard');
const { default: axios } = require('axios');

// GET: Fetch the current active weekly leaderboard
leaderRouter.get('/current', async (req, res) => {
    try {
        const currentBoard = await LeaderBoard.findOne({ type: 'WEEKLY' })
            .sort({ createdAt: -1 })
            // Added issuesReported, issuesResolved, and issuesConfirmed (contribution)
            .populate('citizens.userId', 'name profilePic rank badges issuesReported issuesResolved issuesConfirmed')
            .populate('authorities.userId', 'name profilePic authorityProfile.designation authorityProfile.departmentName authorityProfile.org');

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

module.exports = leaderRouter;