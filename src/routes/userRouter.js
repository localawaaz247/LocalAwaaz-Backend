const express = require("express");
const User = require("../models/User");
const userAuth = require("../middlewares/userAuth"); // JWT auth middleware
const userRouter = express.Router();
const validate = require('validator');
const Issue = require("../models/Issue");
const profileAuth = require("../middlewares/profileAuth");
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const Notification = require('../models/Notification');
const axios = require("axios");

/**
 * ============================
 * COMPLETE USER PROFILE
 * ============================
 * Used mainly after:
 * - Google OAuth signup
 * - Incomplete profile registrations
 *
 * Requires authentication.
 */
userRouter.patch("/me/profile-complete", userAuth, async (req, res) => {
    try {
        const {
            userName,
            gender,
            // mobile,
            country,
            state,
            city,
            pinCode,
            profilePic
        } = req.body;

        /**
         * ---------------------------------
         * VALIDATION SECTION
         * ---------------------------------
         * Only validates fields required to
         * complete the profile.
         */

        // Username rules:
        // - minimum length
        // - must contain uppercase, lowercase & number
        // - allows only _ and @ as special chars
        const userNameRegex = /^[\x21-\x7E]{4,10}$/;

        if (!userName || userName.length < 4) {
            return res.status(400).json({
                success: false,
                message: "Username too short"
            });
        }

        if (!userNameRegex.test(userName)) {
            return res.status(400).json({
                success: false,
                message: "Username must be 4-10 characters and cannot contain spaces or emojis."
            });
        }

        // Gender validation
        if (!gender || !["male", "female", "other"].includes(gender)) {
            return res.status(400).json({
                success: false,
                message: "Invalid gender"
            });
        }

        // Mobile number validation
        // if (!mobile || !validate.isMobilePhone(mobile, 'any')) {
        //     return res.status(400).json({
        //         success: false,
        //         message: "Enter valid Mobile Number"
        //     });
        // }

        /**
         * ---------------------------------
         * USERNAME UNIQUENESS CHECK
         * ---------------------------------
         * Ensure no other user (except current)
         * already has this username.
         */
        const existing = await User.findOne({
            userName,
            _id: { $ne: req.userId }
        });

        if (existing) {
            return res.status(400).json({
                message: "Username already taken"
            });
        }

        /**
         * ---------------------------------
         * UPDATE USER PROFILE
         * ---------------------------------
         */
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Update missing / editable fields
        user.userName = userName;
        user.gender = gender;
        // user.contact.mobile = mobile;
        user.contact.country = country;
        user.contact.state = state;
        user.contact.city = city;
        user.contact.pinCode = pinCode;

        if (profilePic) {
            user.profilePic = profilePic;
        }
        // Mark profile as completed
        user.isProfileComplete = true;

        await user.save();

        res.status(200).json({
            success: true,
            message: "Profile completed successfully",
            user
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: "Error in updating profile"
        });
    }
});

userRouter.get('/issues/feed', userAuth, profileAuth, async (req, res) => {
    try {
        const { lng, lat, page = 1, limit = 10 } = req.query;
        if (!lng || !lat) {
            return res.status(400).json({ success: false, message: "User location required" });
        }
        const userId = new mongoose.Types.ObjectId(req.userId);
        const userLng = parseFloat(lng);
        const userLat = parseFloat(lat);

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const issues = await Issue.aggregate([
            {
                $geoNear: {
                    near: { type: "Point", coordinates: [userLng, userLat] },
                    key: 'location.geoData',
                    distanceField: "distance",
                    maxDistance: 3000,
                    spherical: true,
                    query: {
                        isDeleted: false,
                        reportedBy: { $ne: userId }
                    }
                }
            },
            { $skip: skip },
            { $limit: limitNum },
            {
                $lookup: {
                    from: 'users',
                    localField: 'reportedBy',
                    foreignField: '_id',
                    as: 'authorDetails'
                }
            },
            {
                $unwind: {
                    path: '$authorDetails',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    title: 1,
                    description: 1,
                    category: 1,
                    location: 1,
                    media: 1,
                    status: 1,
                    priority: 1,
                    impactScore: 1,
                    confirmationCount: 1,
                    createdAt: 1,
                    distance: 1, // Calculated by $geoNear
                    isAnonymous: 1,
                    hasConfirmed: {
                        $in: [userId, { $ifNull: ["$confirmations.user", []] }]
                    },
                    // CONDITIONAL AUTHOR DISPLAY
                    reportedBy: {
                        $cond: {
                            if: { $eq: ["$isAnonymous", true] },
                            // CASE A: Anonymous -> Mask Data
                            then: {
                                name: "Anonymous Citizen",
                                userName: "active_citizen",
                                civilScore: 10,
                                issuesReported: 0,
                                issuesConfirmed: 0,
                                contact: { email: "hidden@localawaaz.in" },
                                profilePic: null,
                                isAnonymous: true
                            },
                            // CASE B: Public -> Show Data
                            else: {
                                name: "$authorDetails.name",
                                userName: "$authorDetails.userName",
                                civilScore: "$authorDetails.civilScore",
                                issuesReported: "$authorDetails.issuesReported",
                                issuesConfirmed: "$authorDetails.issuesConfirmed",
                                contact: { email: "$authorDetails.contact.email" },
                                profilePic: "$authorDetails.profilePic",
                                isAnonymous: false
                            }
                        }
                    }
                }
            }
        ]);
        return res.status(200).json({
            success: true,
            message: issues.length > 0 ? "Feed Updated Successfully" : "No issues found nearby",
            count: issues.length,
            data: issues
        });
    }
    catch (err) {
        console.log("Feed error", err);
        return res.status(500).json({ success: false, message: "Error in fetching feed" });
    }
})

userRouter.get('/me/profile', userAuth, async (req, res) => {
    try {
        const { userId } = req;
        const user = await User.findById(userId).select("-password");
        if (!user) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }
        return res.status(200).json({
            success: true,
            message: "User Profile sent successfully",
            data: user
        });
    }
    catch (err) {
        console.log("Profile error : ", err);
        return res.status(500).json({ success: false, message: "Error in fetching profile" });
    }
})

userRouter.patch('/me/profile', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;

        // 1. Explicit Destructuring (Security)
        // -> Added 'language' to the extracted fields
        const { name, profilePic, gender, bio, address, password, isAnonymous, globalNotification, language } = req.body;

        const updates = {};

        // 2. Validation & Assignment
        if (name) {
            if (name.length < 3 || name.length > 50) {
                return res.status(400).json({ success: false, message: "Name must be 3-50 chars" });
            }
            updates.name = name;
        }

        if (profilePic) {
            // Validate it's a real URL (prevents XSS or garbage data)
            if (!validate.isURL(profilePic)) {
                return res.status(400).json({ success: false, message: "Invalid Profile Picture URL" });
            }
            updates.profilePic = profilePic;
        }

        if (gender) {
            const lowerGender = gender.toLowerCase();
            const allowedGenders = ['male', 'female', 'other'];
            if (!allowedGenders.includes(lowerGender)) {
                return res.status(400).json({ success: false, message: "Invalid Gender" });
            }
            updates.gender = lowerGender;
        }

        if (bio) {
            if (bio.length > 150) {
                return res.status(400).json({ success: false, message: "Bio cannot exceed 150 chars" });
            }
            updates.bio = bio;
        }

        // Setting preferences
        if (typeof isAnonymous === 'boolean') {
            updates['preferences.globalAnonymous'] = isAnonymous;
        }
        if (typeof globalNotification === 'boolean') {
            updates['preferences.globalNotifications'] = globalNotification;
        }
        
        // -> NEW: Handle Language update
        if (language) {
            const allowedLanguages = ['en', 'hi']; // Based on your schema enum
            if (!allowedLanguages.includes(language)) {
                return res.status(400).json({ success: false, message: "Invalid Language preference" });
            }
            updates['preferences.language'] = language;
        }

        // Optional: Address (Text based)
        if (address) {
            if (address.city) updates['contact.city'] = address.city;
            if (address.state) updates['contact.state'] = address.state;
            if (address.country) updates['contact.country'] = address.country;
            if (address.pinCode) updates['contact.pinCode'] = address.pinCode;
        }

        //Password Update
        if (password) {
            const passwordOptions = {
                minLength: 8,
                minLowercase: 1,
                minUppercase: 1,
                minNumbers: 1,
                minSymbols: 1
            };
            if (!validate.isStrongPassword(password, passwordOptions)) {
                return res.status(400).json({ success: false, message: "Password must be 8+ chars and include uppercase, lowercase, number, and symbol." });
            }
            const hashedPass = await bcrypt.hash(password, 10);
            updates.password = hashedPass;
        }

        // 3. Database Update
        // { new: true } returns the updated document
        // .select("-password") ensures we don't send back the hash
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select("-password");

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: updatedUser
        });

    } catch (err) {
        console.error("Profile Update Error:", err);
        return res.status(500).json({ success: false, message: "Failed to update profile" });
    }
});

userRouter.get('/me/issues', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { status, page = 1, limit = 10 } = req.query;
        const query = {
            reportedBy: userId,
            isPublic: true,
            isDeleted: false
        };
        if (status) {
            query.status = status.toUpperCase();
        }
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const [totalIssues, issues] = await Promise.all([
            Issue.countDocuments(query),
            Issue.find(query)
                .sort({ createdAt: -1 }) // Newest first
                .skip(skip)
                .limit(limitNum)
                .populate('reportedBy', 'name userName profilePic civilScore issuesReported issuesConfirmed contact.email')
        ]);
        const finalData = issues.map(issue => {
            const issueObj = issue.toObject();

            // Explicitly pass the RAW date to a new key, if you prefer not to just use issueObj.createdAt
            issueObj.dateOfFormation = issueObj.createdAt;

            // Privacy Masking
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
                };
            }
            return issueObj;
        });
        return res.status(200).json({
            success: true,
            message: "User issues fetched successfully",
            count: issues.length,
            total: totalIssues, // Useful for frontend pagination (e.g., "Page 1 of 5")
            currentPage: pageNum,
            totalPages: Math.ceil(totalIssues / limitNum),
            data: finalData
        });
    }
    catch (err) {
        console.error("My Issues Error:", err);
        return res.status(500).json({ success: false, message: "Error fetching your issues" });
    }
})

userRouter.get('/me/issues/confirmed', userAuth, profileAuth, async (req, res) => {
    try {
        // 1. Pagination Setup
        const { page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // 2. Ensure userId is an ObjectId for the aggregation pipeline
        const userId = new mongoose.Types.ObjectId(req.userId);

        // 3. Aggregation Pipeline
        const issues = await Issue.aggregate([
            {
                // STEP A: Filter for issues the user confirmed, excluding their own
                $match: {
                    'confirmations.user': userId,
                    reportedBy: { $ne: userId },
                    isDeleted: false
                }
            },
            {
                // STEP B: Sort by newest first
                $sort: { createdAt: -1 }
            },
            { $skip: skip },
            { $limit: limitNum },
            {
                // STEP C: Join the User collection
                $lookup: {
                    from: 'users',
                    localField: 'reportedBy',
                    foreignField: '_id',
                    as: 'authorDetails'
                }
            },
            {
                // STEP D: Flatten the author array
                $unwind: {
                    path: '$authorDetails',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                // STEP E: Project the exact same fields as your Feed API
                $project: {
                    title: 1,
                    description: 1,
                    category: 1,
                    location: 1,
                    media: 1,
                    status: 1,
                    priority: 1,
                    impactScore: 1,
                    confirmationCount: 1,
                    createdAt: 1,
                    dateOfFormation: "$createdAt", // Added this to pass the raw date explicitly
                    isAnonymous: 1,

                    // CONDITIONAL AUTHOR DISPLAY (Exact match to your feed)
                    reportedBy: {
                        $cond: {
                            if: { $eq: ["$isAnonymous", true] },
                            // CASE A: Anonymous -> Mask Data
                            then: {
                                name: "Anonymous Citizen",
                                userName: "active_citizen",
                                civilScore: 10,
                                issuesReported: 0,
                                issuesConfirmed: 0,
                                contact: { email: "hidden@localawaaz.in" },
                                profilePic: null,
                                isAnonymous: true
                            },
                            // CASE B: Public -> Show Data
                            else: {
                                _id: "$authorDetails._id",
                                name: "$authorDetails.name",
                                userName: "$authorDetails.userName",
                                civilScore: "$authorDetails.civilScore",
                                issuesReported: "$authorDetails.issuesReported",
                                issuesConfirmed: "$authorDetails.issuesConfirmed",
                                contact: { email: "$authorDetails.contact.email" },
                                profilePic: "$authorDetails.profilePic",
                                isAnonymous: false
                            }
                        }
                    }
                }
            }
        ]);

        return res.status(200).json({
            success: true,
            message: issues.length > 0 ? "Confirmed Issues Fetched Successfully" : "No confirmed issues found",
            count: issues.length,
            data: issues
        });

    } catch (err) {
        console.log("Confirmed Issues error", err);
        return res.status(500).json({
            success: false,
            message: "Error fetching confirmed issues"
        });
    }
});


userRouter.post('/get-location-from-coords', userAuth, async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({
                success: false,
                message: "Latitude and Longitude required"
            });
        }

        const axios = require('axios');

        const response = await axios.get(
            `https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lng}&key=${process.env.OPENCAGE_API_KEY}`
        );

        const components = response.data.results[0]?.components;

        if (!components) {
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                city: components.city || components.town || components.village,
                state: components.state,
                country: components.country
            }
        });

    } catch (err) {
        console.log("Reverse Geocoding Error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch location"
        });
    }
});

userRouter.patch('/me/preferences/notification', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { enableNotification } = req.body;
        if (typeof enableNotification !== 'boolean') {
            return res.status(400).json({ success: false, message: "Invalid preference value" });
        }
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: { 'preferences.globalNotifications': enableNotification } },
            { new: true }
        ).select('preferences');

        return res.status(200).json(
            {
                success: true,
                message: "Notification preferences updated",
                data: updatedUser.preferences
            }
        )
    }
    catch (err) {
        console.log("Notification Preferences Error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Failed to update preferences" });
    }
})

// ==========================================
// NOTIFICATION ROUTES
// ==========================================

/**
 * GET /me/notifications
 * Fetches the user's notification history for the dropdown panel
 */
userRouter.get('/me/notifications', userAuth, async (req, res) => {
    try {
        // Basic pagination to keep the payload light
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const notifications = await Notification.find({ recipient: req.userId })
            .sort({ createdAt: -1 }) // Show newest first
            .skip(skip)
            .limit(parseInt(limit))
            // Populate sender details so you can show their avatar next to the message
            .populate('sender', 'name userName profilePic')
            // Populate issue details so you can link directly to the issue page
            .populate('issue', 'title status');

        // Get the total number of unread alerts for the red bell badge
        const unreadCount = await Notification.countDocuments({
            recipient: req.userId,
            isRead: false
        });

        return res.status(200).json({
            success: true,
            unreadCount,
            data: notifications
        });

    } catch (err) {
        console.error("Fetch notifications error:", err);
        return res.status(500).json({ success: false, message: "Error fetching notifications" });
    }
});

/**
 * PATCH /me/notifications/read
 * Marks all of the user's unread notifications as "read"
 */
userRouter.patch('/me/notifications/read', userAuth, async (req, res) => {
    try {
        // Find all unread notifications for this specific user and turn them to true
        await Notification.updateMany(
            { recipient: req.userId, isRead: false },
            { $set: { isRead: true } }
        );

        return res.status(200).json({
            success: true,
            message: "Notifications marked as read"
        });

    } catch (err) {
        console.error("Update notifications error:", err);
        return res.status(500).json({ success: false, message: "Error updating notifications" });
    }
});

// DELETE a specific notification
userRouter.delete('/me/notifications/:id', userAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Ensure the notification belongs to the user trying to delete it
        const deleted = await Notification.findOneAndDelete({
            _id: id,
            recipient: req.userId
        });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        return res.status(200).json({ success: true, message: "Notification deleted" });

    } catch (err) {
        console.error("Delete notification error:", err);
        return res.status(500).json({ success: false, message: "Error deleting notification" });
    }
});

// DELETE all notifications for the user
userRouter.delete('/me/notifications', userAuth, async (req, res) => {
    try {
        await Notification.deleteMany({ recipient: req.userId });

        return res.status(200).json({ success: true, message: "All notifications cleared" });

    } catch (err) {
        console.error("Clear notifications error:", err);
        return res.status(500).json({ success: false, message: "Error clearing notifications" });
    }
});

/**
 * Get locations from keywords
 */
userRouter.get('/locations', async (req, res) => {
    const { keyword } = req.query;

    if (!keyword) {
        return res.status(400).json({ error: 'Keyword query parameter is required' });
    }

    try {
        const isPincode = /^\d{6}$/.test(keyword.trim());
        const url = isPincode
            ? `https://api.postalpincode.in/pincode/${keyword}`
            : `https://api.postalpincode.in/postoffice/${keyword}`;

        let response;
        let maxRetries = 3;

        for (let i = 0; i < maxRetries; i++) {
            try {
                response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
                        'Accept': 'application/json',
                        'Connection': 'keep-alive'
                    },
                    timeout: 5000 // 5 seconds per attempt
                });

                // If the request succeeds, break out of the loop immediately
                break;
            } catch (error) {
                console.warn(`Attempt ${i + 1} failed. Retrying...`);
                // If this was the last attempt, throw the error down to your catch block
                if (i === maxRetries - 1) {
                    throw error;
                }
                // Optional: Wait 1 second before trying again so we don't spam the server
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const data = response.data[0];

        if (data.Status === "Error" || !data.PostOffice) {
            return res.json([]);
        }

        // --- THE FIX: Smart Sorting Strategy ---
        const sortedPostOffices = data.PostOffice.sort((a, b) => {
            const keywordLower = keyword.toLowerCase();
            const nameA = a.Name.toLowerCase();
            const nameB = b.Name.toLowerCase();

            // 1. If searching by text, prioritize exact matches first (e.g., "Sultanpur")
            if (!isPincode) {
                if (nameA === keywordLower && nameB !== keywordLower) return -1;
                if (nameB === keywordLower && nameA !== keywordLower) return 1;
            }

            // 2. Prioritize Head Post Offices (Main Cities/Districts)
            if (a.BranchType === 'Head Post Office' && b.BranchType !== 'Head Post Office') return -1;
            if (b.BranchType === 'Head Post Office' && a.BranchType !== 'Head Post Office') return 1;

            // 3. Prioritize locations where the Name matches the District (e.g., Name: Sultanpur, District: Sultanpur)
            if (nameA === a.District?.toLowerCase() && nameB !== b.District?.toLowerCase()) return -1;
            if (nameB === b.District?.toLowerCase() && nameA !== a.District?.toLowerCase()) return 1;

            // 4. Prioritize Sub Post Offices over rural Branch Post Offices
            if (a.BranchType === 'Sub Post Office' && b.BranchType === 'Branch Post Office') return -1;
            if (b.BranchType === 'Sub Post Office' && a.BranchType === 'Branch Post Office') return 1;

            return 0;
        });

        // Map, Filter, and Limit the sorted results
        const results = sortedPostOffices.map(place => ({
            name: place.Name,
            district: place.District || 'N/A',
            state: place.State || 'N/A',
            pincode: place.PINCode || (isPincode ? keyword : 'N/A'),
            fullAddress: `${place.Name}, ${place.District}, ${place.State}`
        }))
            .filter((value, index, self) =>
                index === self.findIndex((t) => (
                    t.name === value.name && t.district === value.district
                ))
            )
            .slice(0, 5);

        return res.json({ success: true, message: "Matched locations are here...", data: results });

    } catch (error) {
        console.error('Error fetching locations:', error.message);
        return res.status(500).json({ error: 'Failed to fetch location data' });
    }
});

userRouter.post('/save-issue/:id', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { id } = req.params;
        const issueId = id;
        if (!mongoose.Types.ObjectId.isValid(issueId)) {
            return res.status(400).json({ success: false, message: "Invalid Issue Id" });
        }
        const issueExists = await Issue.exists({ _id: issueId, isDeleted: false });
        if (!issueExists) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }
        const user = await User.findByIdAndUpdate(
            userId,
            { $addToSet: { savedIssues: issueId } },
            { new: true }
        );
        return res.status(200).json(
            {
                success: true,
                message: "Issue Saved Successfully",
                savedIssues: user.savedIssues
            }
        )
    }
    catch (err) {
        console.log("Server Error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Issue can't be saved" });
    }
})

userRouter.get('/saved-issues', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const user = await User.findById(userId).populate({
            path: 'savedIssues',
            match: { isDeleted: false },
            populate: {
                path: 'reportedBy',
                select: 'name userName profilePic civilScore issuesReported issuesConfirmed contact.email'
            }
        });
        if (!user) {
            return res.status(200).json(
                {
                    success: true, message: "No saved Issue found",
                    savedIssues: []
                }
            );
        }
        const sanitizedIssues = user.savedIssues
            .filter(issue => issue !== null)
            .map(issue => {
                const issueObj = issue.toObject();

                // Added this to pass the raw date explicitly
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
                    };
                };
                return issueObj;
            })
        return res.status(200).json(
            {
                success: true,
                message: sanitizedIssues.length > 0 ? "Saved issues retrieved" : "No saved issues found",
                count: sanitizedIssues.length,
                savedIssues: sanitizedIssues
            });
    }
    catch (err) {
        console.log("Server Error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Can't get saved Issues" });
    }
})

userRouter.delete('/remove/saved-issue/:id', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const issueId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(issueId)) {
            return res.status(400).json({ success: false, message: "Invalid Issue Id" });
        }
        const user = await User.findByIdAndUpdate(
            userId,
            { $pull: { savedIssues: issueId } }, // $pull removes all instances of this value from the array
            { new: true } // Returns the updated user document
        );
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        return res.status(200).json({
            success: true,
            message: "Issue removed from saved list",
            savedIssues: user.savedIssues
        });

    }
    catch (err) {
        console.log("Remove Saved Issue Error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Could not remove saved issue" })
    }

})

userRouter.delete('/saved-issues/clear', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;

        // Directly set the array to empty
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: { savedIssues: [] } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
            success: true,
            message: "All saved issues cleared successfully",
            savedIssues: user.savedIssues // This will safely return [] to your frontend
        });

    } catch (err) {
        console.error("Clear All Saved Issues Error : ", err);
        return res.status(500).json({ success: false, message: "Server Error : Could not clear saved issues" });
    }

})


module.exports = userRouter;
