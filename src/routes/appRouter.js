const express = require('express');
const mongoose = require('mongoose');
const AppRelease = require('../models/AppRelease');
const appRouter = express.Router();

appRouter.get('/app/latest', async (req, res) => {
    try {
        // Find the most recent active release
        const latestRelease = await AppRelease.findOne({ isActive: true }).sort({ createdAt: -1 });

        if (!latestRelease) {
            return res.status(404).json({ success: false, message: "No app release found." });
        }

        res.status(200).json({ success: true, release: latestRelease });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error fetching latest app version." });
    }
});

module.exports = appRouter