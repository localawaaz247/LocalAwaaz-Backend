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
const { checkAndAssignRank } = require('../utils/gamification');
const { S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

//GET issues according to City and Pincode
issueRouter.get('/issue/area', userAuth, profileAuth, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search) return res.status(400).json({ success: false, message: "Search term required" });

        // 1. Split the search term by commas or spaces into an array of words
        // e.g., "Ahimane, Sultanpur" -> ["Ahimane", "Sultanpur"]
        const searchTokens = search.trim().split(/[\s,]+/).filter(Boolean);

        // 2. Create a regex for each word
        function escapeRegex(text) {
            return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        }
        const regexArray = searchTokens.map(token => new RegExp(escapeRegex(token), 'i'));

        // 3. Search for ANY of the tokens in your location fields
        const query = {
            isPublic: true,
            isDeleted: false,
            $or: [
                { 'location.city': { $in: regexArray } },
                { 'location.address': { $in: regexArray } },
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
    try {
        const userId = req.userId;

        // 1. Validation (Strict)
        checkIssueCreation(req);

        const { title, category, description, location, isAnonymous, media } = req.body;

        // Validate that media URLs exist
        if (!media || !Array.isArray(media) || media.length === 0) {
            throw new Error('At least one media file must be uploaded before creating an issue.');
        }

        // 2. Fetch User (Removed .session())
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');
        if (!user.isEmailVerified) throw new Error('Verify email before posting');

        const finalIsAnonymous = user.preferences.globalAnonymous !== undefined
            ? user.preferences.globalAnonymous
            : isAnonymous;

        // 3. Priority Logic
        let priority = 'LOW';
        switch (category) {
            case 'SAFETY':
            case 'HEALTH':
            case 'CORRUPTION': priority = 'CRITICAL'; break;
            case 'WATER_SUPPLY':
            case 'ELECTRICITY':
            case 'EDUCATION':
            case 'SANITATION': priority = 'HIGH'; break;
            case 'ROAD_&_POTHOLES':
            case 'GARBAGE':
            case 'STREET_LIGHTS':
            case 'TRAFFIC': priority = 'MEDIUM'; break;
        }

        const issueLocation = {
            address: finalIsAnonymous ? 'Anonymous location' : (location?.address || 'Location not provided'),
            city: location?.city,
            pinCode: location?.pinCode,
            state: location?.state,
            geoData: {
                type: 'Point',
                coordinates: location?.geoData?.coordinates
            }
        };

        // Format the URLs for the Schema
        const mediaObjects = media.map(url => ({ url: url }));

        // 4. Create Issue 
        // NOTE: Removed the array brackets [] around the object since we aren't using a transaction array anymore
        const newIssue = await Issue.create({
            reportedBy: userId,
            title: title.trim(),
            isAnonymous: finalIsAnonymous,
            category: category,
            description: description.trim(),
            location: issueLocation,
            priority,
            media: mediaObjects,
            status: "OPEN",
            statusHistory: [{
                status: "OPEN",
                changedBy: userId,
                note: "Issue reported by user"
            }]
        });

        // 5. Give Points (Removed { session })
        await User.findByIdAndUpdate(userId, {
            $inc: { issuesReported: 1, civilScore: 20 }
        });

        // 6. The "Verify" Step (Cleanup TempMedia - Removed .session())
        if (media.length > 0) {
            await TempMedia.deleteMany({ url: { $in: media } });
        }

        // 🚀 Check for Rank Up!
        try {
            await checkAndAssignRank(userId);
        } catch (rankError) {
            console.error("Rank update failed (non-critical):", rankError.message);
        }

        return res.status(201).json({
            success: true,
            message: "Your Issue has been recorded",
            issueId: newIssue._id // NOTE: Changed from newIssue[0]._id to newIssue._id
        });

    } catch (err) {
        // Simple error catch, no more abortTransaction needed
        console.error('Issue Creation Error:', err.message);
        return res.status(500).json({ success: false, message: err.message });
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

        // 🟢 CHANGE 1: Remove 'uploadToken', ensure 'media' is allowed
        const allowedUpdates = ['title', 'category', 'description', 'location', 'media'];

        checkIssueUpdates(req);

        // 1. Validate ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue Id format" });
        }

        const issue = await Issue.findById(id);

        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }
        if (issue.isDeleted) {
            return res.status(400).json({ success: false, message: "The issue has been deleted" });
        }

        if (issue.status !== "OPEN") {
            return res.status(400).json({ success: false, message: "Only issues with status 'OPEN' can be updated" })
        }

        if (userId.toString() !== issue.reportedBy.toString()) {
            return res.status(403).json({ success: false, message: 'You are not authorized to update this issue' });
        }

        const updates = Object.keys(req.body);
        const isValidUpdate = updates.every((field) => allowedUpdates.includes(field));

        if (!isValidUpdate) {
            return res.status(400).json({ success: false, message: "Invalid field in update request" });
        }

        // 🟢 CHANGE 2: Handle Media Updates (The Logic Shift)
        if (updates.includes('media')) {
            const newMediaUrls = req.body.media || []; // Expecting ["url1", "url2"]
            const currentMediaUrls = issue.media.map(m => m.url);

            // A. Identify Deleted Images (In DB, but NOT in new request)
            const urlsToDelete = currentMediaUrls.filter(url => !newMediaUrls.includes(url));

            if (urlsToDelete.length > 0) {
                console.log(`🗑️ Deleting ${urlsToDelete.length} removed images...`);
                for (const url of urlsToDelete) {
                    try {
                        const key = url.split('/').pop(); // Extract filename from URL
                        const command = new DeleteObjectCommand({
                            Bucket: process.env.R2_BUCKET_NAME,
                            Key: key,
                        });
                        await s3.send(command);
                    } catch (err) {
                        console.error(`❌ Failed to delete old media: ${url}`, err);
                    }
                }
            }

            // B. Identify New Images (In new request, but NOT in DB)
            const newlyAddedUrls = newMediaUrls.filter(url => !currentMediaUrls.includes(url));

            if (newlyAddedUrls.length > 0) {
                // "Verify" these new images so Garbage Collector doesn't eat them
                await TempMedia.deleteMany({ url: { $in: newlyAddedUrls } });
                console.log(`✅ Verified ${newlyAddedUrls.length} new images.`);
            }

            // C. Update the Issue Record
            issue.media = newMediaUrls.map(url => ({ url }));
        }

        // 3. Handle Other Fields
        updates.forEach((field) => {
            if (field === 'media') return; // Handled above

            if (field === 'location') {
                const newLoc = req.body.location;
                if (!issue.location) issue.location = {};
                if (newLoc.address) issue.location.address = newLoc.address;
                if (newLoc.city) issue.location.city = newLoc.city;
                if (newLoc.pinCode) issue.location.pinCode = newLoc.pinCode;
                if (newLoc.state) issue.location.state = newLoc.state;
                if (newLoc.geoData?.coordinates) {
                    issue.location.geoData = {
                        type: 'Point',
                        coordinates: newLoc.geoData.coordinates
                    };
                }
            } else if (field === 'category') {
                // Priority Logic
                const upperCat = req.body.category.toUpperCase();
                let newPriority = 'LOW';
                switch (upperCat) {
                    case 'SAFETY':
                    case 'HEALTH':
                    case 'CORRUPTION': priority = 'CRITICAL'; break;
                    case 'WATER_SUPPLY':
                    case 'ELECTRICITY':
                    case 'EDUCATION':
                    case 'SANITATION': priority = 'HIGH'; break;
                    case 'ROAD_&_POTHOLES':
                    case 'GARBAGE':
                    case 'STREET_LIGHTS':
                    case 'TRAFFIC': priority = 'MEDIUM'; break;
                }
                issue.priority = newPriority;
                issue.category = upperCat;
            } else {
                issue[field] = req.body[field]; // Title, Description
            }
        });

        await issue.save();
        return res.status(200).json({ success: true, message: "Issue updated successfully", issue });

    } catch (err) {
        console.error("Update issue error", err);
        return res.status(500).json({ success: false, message: err.message });
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
                $push: { confirmations: { user: userId } },
                $inc: { confirmationCount: 1 }
            },
            { new: true }
        );

        if (confirmedIssue) {
            // Give Points to the CONFIRMER
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    civilScore: 5,
                    issuesConfirmed: 1
                }
            });

            // 🚀 NEW: Check for Rank Up!
            await checkAndAssignRank(userId);

            // Optional: Also give points to the Reporter (Community Support)
            // const reporter = await User.findById(confirmedIssue.reportedBy);
            // reporter.civilScore += 2;
            // await reporter.save();
            // await checkAndAssignRank(reporter._id);

            triggerNotification({
                recipientId: confirmedIssue.reportedBy,
                senderId: userId,
                issueId: confirmedIssue._id,
                type: 'ISSUE_CONFIRMED',
                message: "Someone confirmed the issue you reported.",
                io: req.app.get('io')
            });

            return res.status(200).json({
                success: true,
                message: "Issue confirmed successfully",
                newConfirmedCount: confirmedIssue.confirmationCount
            });
        }

        const issue = await Issue.exists({ _id: id, isDeleted: false });
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        } else {
            return res.status(400).json({ success: false, message: "You have already confirmed this Issue" });
        }
    } catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Server Error : Can't confirm" });
    }
});

// POST endpoint to flag an issue for a specific reason
issueRouter.post('/issue/:id/:flag', userAuth, profileAuth, locationAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;
        const flag = checkIssueFlags(req);

        if (!flag) {
            return res.status(400).json({ success: false, message: "Invalid Flag reason" });
        }

        const updatedIssue = await Issue.findOneAndUpdate(
            {
                _id: id,
                "flags.flaggedBy": { $ne: userId },
                isDeleted: false
            },
            {
                $push: {
                    flags: { flagReason: flag, flaggedBy: userId }
                },
                $inc: { flagCount: 1 }
            },
            { new: true }
        );

        if (updatedIssue) {
            // Give Points for Flagging (Helpful Moderation)
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    civilScore: 2,
                    issuesFlagged: 1
                }
            });

            // 🚀 NEW: Check for Rank Up!
            await checkAndAssignRank(userId);

            return res.status(200).json({
                success: true,
                message: "Issue flagged successfully",
                newFlagCount: updatedIssue.flagCount
            });
        }

        const issueExists = await Issue.exists({ _id: id, isDeleted: false });
        if (!issueExists) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        return res.status(400).json({ success: false, message: "You have already flagged this Issue" });

    } catch (err) {
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