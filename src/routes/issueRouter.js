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
const locationAuth = require('../middlewares/locationAuth');
const checkIssueFlags = require('../utils/checkIssueFlags');
const Share = require('../models/Share');
const calculateImpactScore = require('../utils/impactScore');

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
        const { title, category, description, location, media, isAnonymous } = req.body;

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
            isAnonymous,
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

// CONFIRM: Confirm an issue if present within some range
issueRouter.post('/issue/:id/confirm', userAuth, profileAuth, locationAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;
        const confirmedIssue = await Issue.findOneAndUpdate(
            {
                _id: id,
                "isDeleted": false,
                "confirmations.user": { $ne: userId }
            },
            {
                $push: {
                    confirmations: { user: userId }
                },
                $inc: { confirmationCount: 1 }
            },
            { new: true }
        );
        if (confirmedIssue) {
            return res.status(200).json(
                {
                    success: true,
                    message: "Issue confirmed successfully",
                    newConfirmedCount: confirmedIssue.confirmationCount

                })
        }
        const issue = await Issue.exists({ _id: id, isDeleted: false });
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }
        else {
            return res.status(400).json({ success: false, message: "You have already confirmed this Issue" })
        }
    }
    catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Server Error : Can't confirm" });
    }
});

// POST endpoint to flag an issue for a specific reason
issueRouter.post('/issue/:id/:flag', userAuth, profileAuth, locationAuth, async (req, res) => {
    try {
        const { userId } = req;          // Authenticated user's ID
        const { id } = req.params;       // Issue ID from URL
        const flag = checkIssueFlags(req); // Validate/check the flag reason from request
        if (!flag) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid Flag reason" // Reject invalid or unrecognized flags
            });
        }

        // Attempt to flag the issue only if:
        // 1) User hasn't flagged it before
        // 2) Issue exists and is not deleted
        const updatedIssue = await Issue.findOneAndUpdate(
            {
                _id: id,
                "flags.flaggedBy": { $ne: userId }, // Prevent duplicate flags by same user
                isDeleted: false
            },
            {
                $push: {
                    flags: {
                        flagReason: flag,  // Add the flag reason
                        flaggedBy: userId  // Record who flagged it
                    }
                },
                $inc: {
                    flagCount: 1          // Increment the total flag count
                }
            },
            {
                new: true // Return the updated document
            }
        );

        // If flagging was successful, return success with new flag count
        if (updatedIssue) {
            return res.status(200).json({
                success: true,
                message: "Issue flagged successfully",
                newFlagCount: updatedIssue.flagCount
            });
        }

        // If update failed, check if issue exists at all
        const issueExists = await Issue.exists({ _id: id, isDeleted: false });
        if (!issueExists) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        // Otherwise, user has already flagged this issue
        return res.status(400).json({ 
            success: false, 
            message: "You have already flagged this Issue" 
        });

    } catch (err) {
        // Log any errors and return 500 server error
        console.log(err);
        return res.status(500).json({ success: false, message: err.message });
    }
});


// GET /issue/:id/share
// Handles sharing an issue using a manual cooldown-based approach
// issueRouter.put('/issue/:id/share', userAuth, profileAuth, async (req, res) => {
//     try {
//         // Extract authenticated user id
//         const { userId } = req;

//         // Extract issue id from route params
//         const { id } = req.params;

//         // Validate issue ObjectId early
//         if (!mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Issue Invalid"
//             });
//         }

//         // Cooldown window (in minutes) during which a user
//         // cannot re-share the same issue
//         const COOL_DOWN_MIN = 5;

//         /**
//          * Find existing share log for this user–issue pair
//          * This log is used to:
//          * - Track last share time
//          * - Enforce cooldown manually in application logic
//          */
//         const log = await Share.findOne({ userId, issueId: id });

//         const now = new Date();
//         let shouldIncrement = false;

//         if (log) {
//             /**
//              * Calculate time difference since last share
//              * If within cooldown window, block share
//              */
//             const msDiff = now - new Date(log.lastSharedAt);
//             const minutesPassed = msDiff / (60 * 1000);

//             if (minutesPassed < COOL_DOWN_MIN) {
//                 return res.status(200).json({
//                     success: true,
//                     message: "You have already shared this issue"
//                 });
//             }

//             // Cooldown passed → update lastSharedAt
//             log.lastSharedAt = now;
//             await log.save();
//             shouldIncrement = true;
//         } else {
//             /**
//              * First-time share:
//              * Create a new share log entry
//              */
//             await Share.create({
//                 userId,
//                 issueId: id,
//                 lastSharedAt: now
//             });
//             shouldIncrement = true;
//         }

//         /**
//          * Increment issue share count only when:
//          * - First-time share OR
//          * - Cooldown window has passed
//          */
//         if (shouldIncrement) {
//             const updateIssue = await Issue.findOneAndUpdate(
//                 { _id: id, isDeleted: false },
//                 { $inc: { shareCount: 1 } },
//                 { new: true }
//             );

//             if (!updateIssue) {
//                 return res.status(404).json({
//                     success: false,
//                     message: 'Issue not found'
//                 });
//             }

//             return res.status(200).json({
//                 success: true,
//                 message: "Issue shared",
//                 shares: updateIssue.shareCount
//             });
//         }
//     }
//     catch (err) {
//         // Log unexpected server errors
//         console.log(err);

//         return res.status(500).json({
//             success: false,
//             message: 'Server error: error in sharing'
//         });
//     }
// });



// PUT /issue/:id/share
// Handles sharing an issue with TTL-based throttling

issueRouter.put('/issue/:id/share', userAuth, profileAuth, async (req, res) => {
    try {
        // Extract authenticated userId (set by auth middleware)
        const { userId } = req;

        // Extract issue id from route params
        const { id } = req.params;

        // Validate MongoDB ObjectId early to avoid unnecessary DB calls
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Issue"
            });
        }

        /**
         * Attempt to create a share log entry.
         * - This collection has:
         *   1) TTL index (auto-expiry after cooldown)
         *   2) Unique compound index (userId + issueId)
         *
         * If the user already shared within the TTL window,
         * MongoDB throws E11000 (duplicate key error).
         */
        await Share.create({ userId, issueId: id });

        /**
         * Increment share count only if share log creation succeeds.
         * This ensures:
         * - Accurate shareCount
         * - No double counting during cooldown
         *
         * Using findOneAndUpdate keeps this operation atomic.
         */
        const issue = await Issue.findOneAndUpdate(
            { _id: id, isDeleted: false },
            { $inc: { shareCount: 1 } },
            { new: true }
        );

        // If issue does not exist or is soft-deleted
        if (!issue) {
            return res.status(404).json({
                success: false,
                message: "Issue not found"
            });
        }

        // Successful share
        return res.status(200).json({
            success: true,
            message: "Issue shared",
            shares: issue.shareCount
        });
    }
    catch (err) {
        /**
         * Duplicate key error (E11000) occurs when:
         * - The same user tries to share the same issue
         * - Within the TTL cooldown window
         *
         * Treated as a throttled but successful request
         */
        if (err.code === 11000) {
            return res.status(200).json({
                success: true,
                message: "You have already shared this issue"
            });
        }

        // Log unexpected errors for debugging
        console.error(err);

        // Generic server error response
        return res.status(500).json({
            success: false,
            message: "Server error while sharing"
        });
    }
});

// GET endpoint to fetch the impact score of a specific issue
issueRouter.get('/issue/:id/impact-score', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;        // Extract authenticated user's ID from the middleware
        const { id } = req.params;     // Get the issue ID from the URL parameters

        // Validate the issue ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid Issue"  // Respond if ID is not a valid Mongo ObjectId
            });
        }

        // Find the issue in the database, ensure it's not deleted
        const issue = await Issue.findOne({ _id: id, isDeleted: false });
        if (!issue) {
            return res.status(404).json({ 
                success: false, 
                message: "Issue not found"  // Respond if no matching issue exists
            });
        }

        // Calculate the impact score using the utility function
        const impactScore = calculateImpactScore(issue);

        // Send back the score in a success response
        return res.status(200).json({
            success: true,
            message: "Impact score retrieved successfully",
            impactScore: impactScore
        });

    } catch (err) {
        // Log any server errors and respond with 500
        console.log(err);
        return res.status(500).json({ 
            success: false, 
            message: "Server error in getting impact score" 
        });
    }
});


module.exports = issueRouter;