const express = require("express");
const User = require("../models/User");
const userAuth = require("../middlewares/userAuth"); // JWT auth middleware
const userRouter = express.Router();
const validate = require('validator');

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
            mobile,
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
                message: "Username must be 4–10 characters and cannot contain spaces or emojis."
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
        if (!mobile || !validate.isMobilePhone(mobile, 'any')) {
            return res.status(400).json({
                success: false,
                message: "Enter valid Mobile Number"
            });
        }

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
        user.contact.mobile = mobile;
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

module.exports = userRouter;
