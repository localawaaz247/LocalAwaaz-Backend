const express = require('express');
const mongoose = require('mongoose');
const AppRelease = require('../models/AppRelease');
const appRouter = express.Router();
const OtaUpdate = require('../models/otaUpdate');

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


appRouter.get('/check-update', async (req, res) => {
    try {
        // Fetch the most recently created update
        const latestUpdate = await OtaUpdate.findOne().sort({ createdAt: -1 });

        if (!latestUpdate) {
            return res.status(200).json({ available: false });
        }

        res.status(200).json({
            available: true,
            version: latestUpdate.version,
            url: latestUpdate.url,
            isMandatory: latestUpdate.isMandatory,
            releaseNotes: latestUpdate.releaseNotes
        });
    } catch (error) {
        console.error("Error checking for updates:", error);
        res.status(500).json({ error: "Server error checking updates" });
    }
});

module.exports = appRouter