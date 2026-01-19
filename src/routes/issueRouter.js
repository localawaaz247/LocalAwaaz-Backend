const express = require('express');
const mongoose = require('mongoose'); // Ensure this is imported
const issueRouter = express.Router();

// Middlewares
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');

// Models
const Issue = require('../models/Issue');
const User = require('../models/User');

// Validators (FIXED IMPORTS)
// strict validator for POST
const checkIssueCreation = require('../utils/checkIssueCreation');
// partial validator for PATCH
const checkIssueUpdates = require('../utils/checkIssueUpdates');

// ---------------------------------------------------------
// POST: Create Issue
// ---------------------------------------------------------
issueRouter.post('/create/issue', userAuth, profileAuth, async (req, res) => {
    try {
        const userId = req.userId;

        // 1. VALIDATION (Strict)
        // Ensures title, category, etc. exist. If not, throws error.
        checkIssueCreation(req);

        // Destructure safely after validation
        const { title, category, description, location, media } = req.body;

        const user = await User.findOne({ _id: userId })
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not Found' });
        }
        if (!user.isVerified) {
            return res.status(400).json({ success: false, message: "Verify email before Posting" });
        }

        const newIssue = await Issue.create({
            createdBy: userId,
            title: title.trim(),
            // Validator already uppercased it in req.body, but being explicit is fine
            category: req.body.category,
            description: description.trim(),
            location: {
                country: location.country || "India",
                state: location.state,
                city: location.city,
                pincode: location.pincode,
                geoData: {
                    type: "Point",
                    coordinates: location.geoData.coordinates
                }
            },
            media: media || [],
            status: "OPEN",
            statusHistory: [{
                status: "OPEN",
                changedBy: userId,
                note: "Issue reported by user"
            }]
        });
        return res.status(200).json({ success: true, message: "Your Issue has been recorded" })
    }
    catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// ---------------------------------------------------------
// PATCH: Update Issue
// ---------------------------------------------------------
issueRouter.patch('/update/issue/:id', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;
        const allowedUpdates = ['title', 'category', 'description', 'location', 'media'];

        // 1. Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue Id format" });
        }

        // 2. Validate Body (Partial)
        // Handles "undefined" fields gracefully
        checkIssueUpdates(req);

        const issue = await Issue.findById(id);

        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }
        if (issue.isDeleted) {
            return res.status(400).json({ success: false, message: "The issue has been deleted" });
        }

        const { createdBy } = issue;
        if (userId.toString() !== createdBy.toString()) {
            return res.status(403).json({ success: false, message: 'You are not authorized to update' });
        }

        const updates = Object.keys(req.body);
        const isValidUpdate = updates.every((field) => {
            return allowedUpdates.includes(field);
        });

        if (!isValidUpdate) {
            return res.status(400).json({ success: false, message: "Invalid field in update request" });
        }

        // 3. Update Loop
        updates.forEach((field) => {
            if (field === 'title' || field === 'description') {
                issue[field] = req.body[field].trim();
            }
            // Note: 'category' is handled by the default 'else' block 
            // because the validator already uppercased it in req.body
            else {
                issue[field] = req.body[field];
            }
        });

        await issue.save();
        return res.status(200).json({ success: true, message: "Issue updated successfully" });
    }
    catch (err) {
        console.error("Update issue error", err);
        return res.status(500).json({ success: false, message: err.message })
    }
});

module.exports = issueRouter;