const express = require("express");
const User = require("../models/User");
const userAuth = require("../middlewares/userAuth"); // JWT auth middleware
const userRouter = express.Router();
const validate = require('validator');
const Issue = require("../models/Issue");
const profileAuth = require("../middlewares/profileAuth");
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

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
userRouter.patch("/users/complete-profile", userAuth, async (req, res) => {
    try {
        const {
            userName,
            gender,
            // mobile,
            country,
            state,
            city,
            pinCode
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

userRouter.get('/feed', userAuth, profileAuth, async (req, res) => {
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
                $unwind: '$authorDetails'
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

                    // CONDITIONAL AUTHOR DISPLAY
                    author: {
                        $cond: {
                            if: { $eq: ["$isAnonymous", true] },
                            // CASE A: Anonymous -> Mask Data
                            then: {
                                name: "Anonymous Citizen",
                                userName: "Hidden",
                                profilePic: "https://res.cloudinary.com/your-cloud-name/image/upload/v1/assets/anonymous_avatar.png", // Use a generic placeholder
                                civilScore: null,
                                _id: null // Hide ID to prevent tracking
                            },
                            // CASE B: Public -> Show Data
                            else: {
                                name: "$authorDetails.name",
                                userName: "$authorDetails.userName",
                                profilePic: "$authorDetails.profilePic",
                                civilScore: "$authorDetails.civilScore",
                                _id: "$authorDetails._id"
                            }
                        }
                    }
                }
            }
        ]);
        return res.status(200).json({ success: true, message: "Feed Updated Successfully", count: issues.length, data: issues });
    }
    catch (err) {
        console.log("Feed error", err);
        return res.status(500).json({ success: false, message: "Error in fetching feed" });
    }
})

userRouter.get('/profile', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const user = await User.findById(userId).select("-password");
        if (!user) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }
        return res.status(200).json(
            {
                success: true,
                message: "User Profile sent successfully",
                data: user
            }
        )
    }
    catch (err) {
        console.log("Profile error : ", err);
        return res.status(500).json({ success: false, message: "Error in fetching profile" });
    }

})

userRouter.patch('/profile/edit', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;

        // 1. Explicit Destructuring (Security)
        // Only extract the fields we allow users to change.
        const { name, profilePic, gender, bio, address, password } = req.body;

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

userRouter.get('/my-issues', userAuth, profileAuth, async (req, res) => {
    try {
        const { userId } = req;
        const { status, page = 1, limit = 10 } = req.query;
        const query = {
            reportedBy: userId,
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
            // We don't need to populate 'reportedBy' because we know it's the user
        ]);
        return res.status(200).json({
            success: true,
            message: "User issues fetched successfully",
            count: issues.length,
            total: totalIssues, // Useful for frontend pagination (e.g., "Page 1 of 5")
            currentPage: pageNum,
            totalPages: Math.ceil(totalIssues / limitNum),
            data: issues
        });
    }
    catch (err) {
        console.error("My Issues Error:", err);
        return res.status(500).json({ success: false, message: "Error fetching your issues" });
    }
})


module.exports = userRouter;
