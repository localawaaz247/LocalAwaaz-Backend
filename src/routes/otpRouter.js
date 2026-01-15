const express = require('express');
const { sendMail } = require('../config/sendOtp');   // sends OTP email
const verifyOtp = require('../config/verifyOtp');   // verifies OTP correctness + expiry
const validate = require('validator');
const OtpModel = require('../models/Otp');           // stores OTP, attempts, block info
const bcrypt = require('bcrypt');
const User = require('../models/User');
const otpRouter = express.Router();

/**
 * ============================
 * OTP REQUEST ROUTE
 * ============================
 * Handles:
 * 1. Email validation
 * 2. Inside-app vs outside-app email verification
 * 3. Email hijack prevention
 * 4. OTP throttling & blocking
 * 5. OTP generation + storage (UPSERT)
 */
otpRouter.post('/otp/request', async (req, res) => {
    try {
        const { email, userName } = req.body;

        // Basic email validation
        if (!email || !validate.isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter Valid email id"
            });
        }

        let user = null;

        /**
         * ----------------------------
         * INSIDE-APP VERIFICATION FLOW
         * ----------------------------
         * If userName is provided, OTP is being requested
         * by an already existing user from within the app.
         */
        if (userName) {
            user = await User.findOne({ userName });

            // Username must exist
            if (!user) {
                return res.status(400).json({
                    success: false,
                    message: "User does not exists"
                });
            }

            /**
             * If user already has an email stored,
             * the requested email MUST match it.
             * Prevents changing email silently via OTP.
             */
            if (user?.contact?.email && user?.contact?.email !== email) {
                return res.status(400).json({
                    success: false,
                    message: "Email does not match the user"
                });
            }
        }

        /**
         * ---------------------------------
         * EMAIL HIJACK PREVENTION
         * ---------------------------------
         * If this email already belongs to some OTHER account,
         * do NOT allow OTP request for a different username.
         */
        let existingEmailUser = await User.findOne({ "contact.email": email });
        if (existingEmailUser && existingEmailUser.userName !== userName) {
            return res.status(400).json({
                success: false,
                message: "Email is already in use by another account"
            });
        }

        /**
         * ---------------------------------
         * OTP THROTTLING & BLOCKING
         * ---------------------------------
         * Prevent OTP spamming by tracking attempts
         * and blocking requests temporarily.
         */
        const otpRecord = await OtpModel.findOne({ email });

        // If blocked, reject immediately
        if (otpRecord?.blockUntil && otpRecord.blockUntil > Date.now()) {
            return res.status(429).json({
                success: false,
                message: "Too many requests. Try again later"
            });
        }

        // Increment attempts count
        const attempts = (otpRecord?.attempts || 0) + 1;

        // Block user for 5 minutes after 5 attempts
        const blockUntil = attempts > 5
            ? new Date(Date.now() + 5 * 60 * 1000)
            : null;

        /**
         * ---------------------------------
         * OTP GENERATION & STORAGE
         * ---------------------------------
         */
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);

        // Send OTP email
        // await sendMail({ email, generatedOtp });

        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        /**
         * UPSERT is critical here:
         * - avoids duplicate key errors
         * - updates OTP if already exists
         * - preserves username if already linked
         */
        await OtpModel.findOneAndUpdate(
            { email },
            {
                email,
                otp: hashedOtp,
                userName: userName || otpRecord?.userName || null,
                attempts,
                lastSent: new Date(),
                blockUntil,
                expiresAt,
                isVerified: false
            },
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: "OTP sent on email id"
        });

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
});

/**
 * ============================
 * OTP VERIFY ROUTE
 * ============================
 * Handles:
 * 1. OTP correctness & expiry
 * 2. Marks OTP as verified
 * 3. Links verified email to user (inside-app flow)
 */
otpRouter.post('/otp/verify', async (req, res) => {
    try {
        const { email, otp, userName } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                message: 'Email and OTP required'
            });
        }

        // Throws error if OTP is invalid or expired
        await verifyOtp(email, otp);

        /**
         * If username is provided,
         * this is an inside-app verification.
         * Mark user as verified and attach email.
         */
        if (userName) {
            const userRecord = await OtpModel.findOne({ email, userName });

            if (userRecord) {
                const user = await User.findOne({ userName });
                user.isVerified = true;
                user.contact.email = email;
                await user.save();
            }
        }

        res.status(200).json({
            success: true,
            message: 'OTP verified successfully'
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
});

module.exports = otpRouter;
