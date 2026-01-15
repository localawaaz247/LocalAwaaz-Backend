const express = require('express');
const validateSignUpData = require('../utils/validateLocalSignupData'); // validates signup payload
const OtpModel = require('../models/Otp'); // OTP verification records
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const checkUniqueness = require('../utils/checkUniqueness'); // username/email uniqueness check
const { generateAccessToken, generateRefreshToken } = require('../config/tokens');
require('dotenv').config();
const passport = require('passport');
const LoginAttempt = require('../models/LoginAttempt'); // tracks failed login attempts

const authRouter = express.Router();

/**
 * ============================
 * USER REGISTRATION (LOCAL)
 * ============================
 * Handles:
 * 1. Input validation
 * 2. Uniqueness checks
 * 3. Password hashing
 * 4. Profile creation
 * 5. Auto-verification if OTP already verified
 */
authRouter.post('/auth/register', async (req, res) => {
    try {
        const {
            userName,
            password,
            name,
            email,
            gender,
            country,
            state,
            city,
            pinCode
        } = req.body;

        // Validate request body structure and required fields
        validateSignUpData(req);

        // Ensure username/email uniqueness
        await checkUniqueness(req);

        const role = 'user';
        const hashedPassword = await bcrypt.hash(password, 10);
        const isProfileComplete = true;

        // Create new user with contact info
        const user = await User.create({
            userName,
            password: hashedPassword,
            role,
            name,
            isProfileComplete,
            contact: {
                email,
                gender,
                country,
                state,
                city,
                pinCode,
                isProfileComplete
            }
        });

        /**
         * ---------------------------------
         * AUTO EMAIL VERIFICATION
         * ---------------------------------
         * If OTP was already verified before signup,
         * directly mark user as verified.
         */
        const otpRecord = await OtpModel.findOne({ email, isVerified: true });
        if (otpRecord) {
            user.isVerified = true;
            await user.save();
        }

        res.status(200).json({
            success: true,
            message: "Signup Successful"
        });

    } catch (err) {
        console.log(err);
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
});

/**
 * ============================
 * USER LOGIN
 * ============================
 * Supports login via:
 * - username
 * - email
 *
 * Includes:
 * - password validation
 * - login attempt throttling
 * - JWT access + refresh token generation
 */
authRouter.post('/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;

        // Find user by username OR email
        const user = await User.findOne({
            $or: [
                { "contact.email": identifier },
                { userName: identifier }
            ]
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid User credentials"
            });
        }

        /**
         * ---------------------------------
         * LOGIN ATTEMPT TRACKING
         * ---------------------------------
         * Prevent brute-force attacks by:
         * - counting failed attempts
         * - locking login temporarily
         */
        let attempt = await LoginAttempt.findOne({ userId: user._id });

        // Create record if first login attempt
        if (!attempt) {
            attempt = await LoginAttempt.create({ userId: user._id });
        }

        // Block login if currently locked
        if (attempt.lockUntil && attempt.lockUntil > Date.now()) {
            return res.status(429).json({
                success: false,
                message: "Too many attempts.Try again Later"
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        /**
         * If password does not match:
         * - increase failed attempts
         * - progressively increase lock duration
         */
        if (!isMatch) {
            attempt.failedAttempts += 1;
            attempt.lastAttempt = Date.now();

            // Short lock after 3 failures
            if (attempt.failedAttempts === 3) {
                attempt.lockUntil = new Date(Date.now() + 30 * 1000);
            }
            // Longer lock after 5 failures
            else if (attempt.failedAttempts === 5) {
                attempt.lockUntil = new Date(Date.now() + 5 * 60 * 1000);
            }

            await attempt.save();

            return res.status(400).json({
                success: false,
                message: "Invalid User credentials"
            });
        }

        /**
         * Successful login:
         * - reset attempt counters
         * - clear lock
         */
        attempt.failedAttempts = 0;
        attempt.lastAttempt = new Date();
        attempt.lockUntil = null;
        await attempt.save();

        /**
         * ---------------------------------
         * TOKEN GENERATION
         * ---------------------------------
         * Access token → short lived
         * Refresh token → stored in HTTP-only cookie
         */
        const accessToken = generateAccessToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            path: '/refresh_token'
        });

        // Remove password before sending user object
        const userObj = user.toObject();
        delete userObj.password;

        res.json({ accessToken, user: userObj });

    } catch (err) {
        res.status(401).json({
            success: false,
            message: "Unauthorized Access"
        });
    }
});

/**
 * ============================
 * REFRESH ACCESS TOKEN
 * ============================
 * Generates a new access token
 * using a valid refresh token.
 */
authRouter.post('/refresh_token', async (req, res) => {
    try {
        const { refreshToken } = req.cookies;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                message: "No refresh token"
            });
        }

        const decoded = jwt.verify(
            refreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        if (!decoded) {
            return res.status(403).json({
                success: false,
                message: "Invalid refresh token"
            });
        }

        const accessToken = generateAccessToken(decoded._id);
        res.json({ accessToken });

    } catch (err) {
        res.status(401).json({
            success: false,
            message: "Unauthorized Access"
        });
    }
});

/**
 * ============================
 * LOGOUT
 * ============================
 * Clears refresh token cookie.
 */
authRouter.post('/auth/logout', (req, res) => {
    try {
        res.clearCookie('refreshToken', {
            httpOnly: true,
            path: '/refresh_token'
        });

        res.status(200).json({
            success: true,
            message: "User Logged Out Successfully"
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error in Logging out"
        });
    }
});

/**
 * ============================
 * GOOGLE AUTH
 * ============================
 * OAuth login using Passport.
 */
authRouter.get(
    "/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"]
    })
);

authRouter.get(
    "/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/login",
        session: true // maintain passport session
    }),
    (req, res) => {
        /**
         * If profile is incomplete,
         * redirect user to complete profile page
         * with access token.
         */
        if (!req.user.isProfileComplete) {
            const accessToken = generateAccessToken(req.user._id);
            return res.redirect(
                `${process.env.FRONTEND_URL}/complete-profile?token=${accessToken}`
            );
        }

        // Profile complete → go to dashboard
        res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
    }
);

module.exports = authRouter;
