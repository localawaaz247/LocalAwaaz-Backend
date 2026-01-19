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
issueRouter.post('/issue', userAuth, profileAuth, async (req, res) => {
    try {
        const userId = req.userId;

        // 1. VALIDATION (Strict)
        // Ensures title, category, etc. exist. If not, throws error.
        checkIssueCreation(req);

        // Destructure safely after validation
        const { title, category, description, location, media } = req.body;

        const user = await User.findById(userId)
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not Found' });
        }
        if (!user.isVerified) {
            return res.status(400).json({ success: false, message: "Verify email before Posting" });
        }
        //PRIORITY logic
        let priority;
        switch (category) {
            case 'SAFETY':
                priority = 'CRITICAL'
                break;
            case 'WATER':
            case 'ELECTRICITY':
                priority = 'HIGH'
                break;
            case 'ROAD':
            case 'GARBAGE':
                priority = 'MEDIUM'
                break;
            case 'OTHER':
                priority = 'LOW'
                break;
            default:
                priority = 'LOW'
                break;
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
            priority,
            media: media || [],
            status: "OPEN",
            statusHistory: [{
                status: "OPEN",
                changedBy: userId,
                note: "Issue reported by user"
            }]
        });
        return res.status(201).json({ success: true, message: "Your Issue has been recorded" })
    }
    catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// ---------------------------------------------------------
// PATCH: Update Issue
// ---------------------------------------------------------
issueRouter.patch('/issue/:id', userAuth, profileAuth, async (req, res) => {
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
        const { status } = issue;
        if (status !== "OPEN") {
            return res.status(400).json({ success: false, message: "Issues with status 'OPEN' can be updated" })
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
        //PRIORITY logic
        // 3. PRIORITY LOGIC (Fixed Scope)
        // Only recalculate if category is part of the request body
        if (req.body.category) {
            let newPriority;
            switch (req.body.category) {
                case 'SAFETY':
                    newPriority = 'CRITICAL';
                    break;
                case 'WATER':
                case 'ELECTRICITY':
                    newPriority = 'HIGH';
                    break;
                case 'ROAD':
                case 'GARBAGE':
                    newPriority = 'MEDIUM';
                    break;
                default:
                    newPriority = 'LOW';
            }
            issue.priority = newPriority;
        }
        // 4. Update Loop
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

// DELETE: Soft delete an issue (only creator, only when OPEN)
issueRouter.delete('/issue/:id', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;

        // 1. Validate MongoDB ObjectId to prevent DB errors
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid issue id"
            });
        }

        // 2. Fetch issue from DB (single source of truth)
        const issue = await Issue.findById(id);
        if (!issue) {
            return res.status(404).json({
                success: false,
                message: "Issue not found"
            });
        }

        // 3. Ensure only the creator can delete the issue
        if (issue.createdBy.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized deletion"
            });
        }

        // 4. Prevent repeated deletion attempts
        if (issue.isDeleted) {
            return res.status(400).json({
                success: false,
                message: "Issue already deleted"
            });
        }

        // 5. Allow deletion only when issue is still OPEN
        // This prevents tampering after authority action
        if (issue.status !== "OPEN") {
            return res.status(400).json({
                success: false,
                message: "Only issues with status 'OPEN' can be deleted"
            });
        }

        // 6. Soft delete:
        // - Keep record for audit/history
        // - Remove issue from public visibility
        await Issue.findByIdAndUpdate(id, {
            isDeleted: true,
            isPublic: false
        });

        return res.status(200).json({
            success: true,
            message: "Issue deleted successfully"
        });

    } catch (err) {
        // Log error for debugging, do not expose internal details to client
        console.log(err.message);
        return res.status(500).json({
            success: false,
            message: "Error occurred in deletion"
        });
    }
});

issueRouter.post('/issue/:id/confirm', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;
        const { userLng, userLat } = req.body;

        if (!userLng || !userLat) {
            return res.status(400).json({ success: false, message: "Your Location is required to confirm" });
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid issue ID" });
        }

        const issue = await Issue.findOne({
            _id: id,
            "location.geoData": {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(userLng), parseFloat(userLat)]
                    },
                    $maxDistance: 1000
                }
            }
        });
        if (!issue) {
            return res.status(400).json({ success: false, message: "You are too far away! You must be within 1km to confirm this issue" });
        }
        const alreadyConfirmed = issue.confirmations.some((conf) => {
            return conf.user.toString() === userId.toString()
        });
        if (alreadyConfirmed) {
            return res.status(400).json({ success: false, message: "You have already Confirmed the issue" });
        }
        issue.confirmations.push({ user: userId });
        issue.confirmationCount = (issue.confirmationCount || 0) + 1;

        await issue.save();
        return res.status(200).json({ success: true, message: "Issue confirmed successfully", newCount: issue.confirmationCount });
    }
    catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Server Error : Can't confirm" });
    }
})

module.exports = issueRouter;