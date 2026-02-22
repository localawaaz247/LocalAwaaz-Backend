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
const TempMedia = require('../models/TempMedia');
const triggerNotification = require('../utils/notificationService');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../config/s3Client')

//GET issues according to City and Pincode
issueRouter.get('/issue/area', userAuth, profileAuth, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search) return res.status(400).json({ success: false, message: "Search term required" });

        // 1. Split the search term by commas or spaces into an array of words
        // e.g., "Ahimane, Sultanpur" -> ["Ahimane", "Sultanpur"]
        const searchTokens = search.trim().split(/[\s,]+/).filter(Boolean);

        // 2. Create a regex for each word
        const regexArray = searchTokens.map(token => new RegExp(token, 'i'));

        // 3. Search for ANY of the tokens in your location fields
        const query = {
            isPublic: true,
            isDeleted: false,
            $or: [
                { 'location.city': { $in: regexArray } },
                { 'location.pinCode': { $in: regexArray } }
            ]
        };

        const issues = await Issue.find(query)
            .select('-statusHistory')
            .populate('reportedBy', 'name userName profilePic civilScore issuesReported issuesConfirmed contact.email ');

        if (!issues || issues.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No issues found in this area",
                data: [],
                issueCount: 0
            });
        }

        // --- Your existing mapping logic stays the same below ---
        const sanitizedIssues = issues.map((issue) => {
            const issueObj = issue.toObject();
            issueObj.dateOfFormation = issueObj.createdAt;

            if (issueObj.isAnonymous) {
                issueObj.reportedBy = {
                    name: "Anonymous Citizen",
                    userName: "active_citizen",
                    civilScore: 10,
                    issuesReported: 0,
                    issuesConfirmed: 0,
                    contact: { email: "hidden@localawaaz.in" },
                    profilePic: null,
                    isAnonymous: true
                }
            }
            return issueObj;
        });

        return res.status(200).json({
            success: true,
            message: "Issues found for this area",
            issueCount: sanitizedIssues.length,
            data: sanitizedIssues
        });

    } catch (err) {
        console.error('Search Error:', err);
        return res.status(500).json({ success: false, message: 'Server Error in Searching' });
    }
});
// ---------------------------------------------------------
// POST: Create Issue
// ---------------------------------------------------------
issueRouter.post('/issue', userAuth, profileAuth, async (req, res) => {
    // 1. Start the Transaction Session
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.userId;

        // Validation (Strict)
        checkIssueCreation(req);
        const { title, category, description, location, media, isAnonymous } = req.body;

        // 2. Fetch User (Pass the session!)
        const user = await User.findById(userId).session(session);
        if (!user) {
            throw new Error('User not found'); // Throws to the catch block to abort transaction
        }
        if (!user.isEmailVerified) {
            throw new Error('Verify email before posting');
        }

        // 3. Priority Logic
        let priority = 'LOW';
        switch (category) {
            case 'SAFETY': priority = 'CRITICAL'; break;
            case 'WATER_SUPPLY':
            case 'ELECTRICITY':
            case 'SANITATION': priority = 'HIGH'; break;
            case 'ROAD_&_POTHOLES':
            case 'GARBAGE':
            case 'STREET_LIGHTS':
            case 'TRAFFIC': priority = 'MEDIUM'; break;
        }

        const issueLocation = {
            address: location?.address || 'Anonymous location',
            city: location?.city,
            pinCode: location?.pinCode,
            state: location?.state,
            geoData: {
                type: 'Point',
                coordinates: location?.geoData?.coordinates
            }
        };

        // 4. Format Media Array to match Schema requirements
        // Handles an array of strings OR an array of objects from the frontend
        const formattedMedia = Array.isArray(media)
            ? media.map(m => ({ url: m.publicUrl || m.url || m }))
            : [];

        // 5. Create Issue
        // CRITICAL Mongoose Trap: When using sessions, Issue.create MUST take an array of objects.
        const [newIssue] = await Issue.create([{
            reportedBy: userId,
            title: title.trim(),
            isAnonymous,
            category: category,
            description: description.trim(),
            location: issueLocation,
            priority,
            media: formattedMedia,
            status: "OPEN",
            statusHistory: [{
                status: "OPEN",
                changedBy: userId,
                note: "Issue reported by user"
            }]
        }], { session });

        // 6. Update User Score
        await User.findByIdAndUpdate(userId, {
            $inc: { issuesReported: 1, civilScore: 20 }
        }, { session });

        // 7. Commit the Transaction (Saves everything to the database permanently)
        await session.commitTransaction();
        const mediaKeys = formattedMedia.map(m => {
            // Extract just the filename from the end of the publicUrl
            return m.url.split('/').pop();
        });
        session.endSession();

        await TempMedia.deleteMany({ r2Key: { $in: mediaKeys } });
        return res.status(201).json({
            success: true,
            message: "Your Issue has been recorded",
            issueId: newIssue._id
        });

    } catch (err) {
        // 8. Rollback! If anything above fails, undo all changes.
        await session.abortTransaction();
        session.endSession();

        // Differentiate between our custom errors and server crashes
        const statusCode = err.message === 'User not found' || err.message === 'Verify email before posting' ? 400 : 500;
        return res.status(statusCode).json({ success: false, message: err.message });
    }
});
// ---------------------------------------------------------
// GET: Get issue accoring to issue id
// ---------------------------------------------------------
issueRouter.get('/issue/:id', userAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid issue id" });
        }

        // .populate() to get the author's details from the User collection
        const issueRecord = await Issue.findOne({
            _id: id,
            isDeleted: false
        }).populate('reportedBy', 'name userName profilePic civilScore issuesReported issuesConfirmed contact.email ');

        if (!issueRecord) {
            return res.status(404).json({ // Use 404 for 'Not Found'
                success: false,
                message: "Issue not found"
            });
        }

        // 3. ENHANCEMENT: Handle the "isAnonymous" masking for the single issue view
        // We convert the Mongoose document to a plain JS object so we can modify it safely
        let responseData = issueRecord.toObject();

        // Explicitly pass the RAW date to a new key
        responseData.dateOfFormation = responseData.createdAt;

        if (responseData.isAnonymous) {
            responseData.reportedBy = {
                name: "Anonymous Citizen",
                userName: "active_citizen",
                civilScore: 10,
                issuesReported: 0,
                issuesConfirmed: 0,
                contact: { // Keep the nested structure consistent with your Schema
                    email: "hidden@localawaaz.in"
                },
                profilePic: null,
                isAnonymous: true
            };
        }

        return res.status(200).json({
            success: true,
            message: "Issue details retreived",
            data: responseData
        });

    } catch (err) {
        console.error("Issue fetch error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Issue not found" });
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

        const { reportedBy } = issue;
        if (userId.toString() !== reportedBy.toString()) {
            return res.status(403).json({ success: false, message: 'You are not authorized to update' });
        }

        const updates = Object.keys(req.body);
        const isValidUpdate = updates.every((field) => allowedUpdates.includes(field));

        if (!isValidUpdate) {
            return res.status(400).json({ success: false, message: "Invalid field in update request" });
        }

        // 3. PRIORITY LOGIC
        if (req.body.category) {
            const upperCat = req.body.category.toUpperCase();
            let newPriority;
            switch (upperCat) {
                case 'SAFETY': newPriority = 'CRITICAL'; break;
                case 'WATER_SUPPLY':
                case 'ELECTRICITY':
                case 'SANITATION': newPriority = 'HIGH'; break;
                case 'ROAD_&_POTHOLES':
                case 'GARBAGE':
                case 'STREET_LIGHTS':
                case 'TRAFFIC': newPriority = 'MEDIUM'; break;
                case 'ENCROACHMENT':
                default: newPriority = 'LOW'; break;
            }
            issue.priority = newPriority;
            issue.category = upperCat;
        }

        // 4. Update Loop (Changed to for...of to support async/await operations)
        for (const field of updates) {
            if (field === 'category') continue;

            if (field === 'location') {
                const newLoc = req.body.location;
                if (!issue.location) issue.location = {};
                if (newLoc.address) issue.location.address = newLoc?.address;
                if (newLoc.city) issue.location.city = newLoc?.city;
                if (newLoc.pinCode) issue.location.pinCode = newLoc?.pinCode;
                if (newLoc.state) issue.location.state = newLoc?.state;

                if (newLoc.geoData && newLoc.geoData.coordinates) {
                    issue.location.geoData = {
                        type: 'Point',
                        coordinates: newLoc.geoData.coordinates
                    };
                }
            }
            else if (field === 'title' || field === 'description') {
                issue[field] = req.body[field].trim();
            }
            // --- NEW: Handle Media Array & Garbage Collection ---
            else if (field === 'media') {
                if (Array.isArray(req.body.media)) {
                    // Grab old keys before overwriting
                    const oldMediaKeys = issue.media.map(m => m.url.split('/').pop());

                    // Format and apply new media array
                    issue.media = req.body.media.map(item => {
                        const stringUrl = typeof item === 'object' ? (item.url || item.publicUrl) : item;
                        return { url: stringUrl };
                    });

                    // Grab new keys
                    const newMediaKeys = issue.media.map(m => m.url.split('/').pop());

                    // CLAIM NEW MEDIA: Remove newly uploaded files from TempMedia so they aren't deleted tonight
                    await TempMedia.deleteMany({ r2Key: { $in: newMediaKeys } });

                    // DELETE REMOVED MEDIA: Find files the user deleted and nuke them from Cloudflare
                    const keysToDelete = oldMediaKeys.filter(key => !newMediaKeys.includes(key));

                    for (const key of keysToDelete) {
                        try {
                            const command = new DeleteObjectCommand({
                                Bucket: process.env.R2_BUCKET_NAME,
                                Key: key,
                            });
                            await s3.send(command);
                            console.log(`Deleted removed media from Cloudflare: ${key}`);
                        } catch (err) {
                            console.error(`Failed to delete media ${key} from Cloudflare:`, err);
                        }
                    }
                }
            }
            else {
                issue[field] = req.body[field];
            }
        }

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
        if (issue.reportedBy.toString() !== userId.toString()) {
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
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    civilScore: 5,
                    issuesConfirmed: 1
                }
            });
            triggerNotification({
                recipientId: confirmedIssue.reportedBy, // The owner of the issue
                senderId: userId,                       // The person confirming
                issueId: confirmedIssue._id,
                type: 'ISSUE_CONFIRMED',
                message: "Someone confirmed the issue you reported.",
                io: req.app.get('io')                   // Grab the socket instance
            });
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
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    civilScore: 2,
                    issuesFlagged: 1
                }
            })
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