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
const { sendMail } = require('../config/sendOtp');
const validator = require('validator')

const authRouter = express.Router();

/**
 * ============================
 * USER REGISTRATION (SECURE)
 * ============================
 * Final step of the 2-Step Signup Process.
 * * Flow:
 * 1. Validate Form Data
 * 2. Check for Duplicates (User/Email)
 * 3. SECURITY GATE: Verify that email was pre-verified via OTP API.
 * 4. STRICT BINDING: Ensure the verification session matches the Username.
 * 5. Create User (Initialized as Verified + 10 CivilScore).
 * 6. Cleanup Temporary OTP Data.
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

        // 1. Validate Request Structure (Data Integrity)
        validateSignUpData(req);

        // 2. Uniqueness Check (User & Email)
        // Ensures we don't try to create duplicates before doing expensive DB ops
        await checkUniqueness(req);

        const role = 'user';
        const hashedPassword = await bcrypt.hash(password, 10);
        const isProfileComplete = true;

        /**
         * ---------------------------------
         * 3. COMPULSORY VERIFICATION GATE
         * ---------------------------------
         * Query the temporary OTP collection.
         * The user MUST have verified their email in Step 1 (Frontend).
         */
        const otpRecord = await OtpModel.findOne({ email });

        // Gate 1: Check if verification record exists and is marked true
        if (!otpRecord || !otpRecord.isVerified) {
            return res.status(400).json({
                success: false,
                message: "Email is not verified"
            });
        }

        /**
         * ---------------------------------
         * 4. STRICT BINDING CHECK (Anti-Hijack)
         * ---------------------------------
         * Security Rule: The 'userName' stored during OTP verification
         * MUST match the 'userName' being registered now.
         * * Prevents User A from verifying an email, but then 
         * using that valid session to register User B (Account Hijacking).
         */
        if (otpRecord.userName !== userName) {
            return res.status(400).json({
                success: false,
                message: "Security Mismatch: The verified email is bound to a different username."
            });
        }

        // 5. Create User Document
        // We safely set isEmailVerified: true because of the checks above.
        const user = await User.create({
            // Root Fields
            userName,
            password: hashedPassword,
            role,
            name,
            gender,
            isProfileComplete,

            // Initialization Checks
            isEmailVerified: true,  // Immediately active
            civilScore: 10,         // Gamification: Start with 'Citizen' rank points

            // Nested Contact Info
            contact: {
                email,
                country,
                state,
                city,
                pinCode
            }
        });

        // 6. Cleanup
        // Delete the temporary OTP record as it is no longer needed
        await OtpModel.deleteOne({ email });

        res.status(200).json({
            success: true,
            message: "Signup Successful"
        });

    } catch (err) {
        console.error("Signup Error:", err);
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
        return res.json({ accessToken });

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
        session: false // do not use passport session
    }),
    (req, res) => {
        /**
         * If profile is incomplete,
         * redirect user to complete profile page
         * with access token.
         */
        const accessToken = generateAccessToken(req.user._id);

        if (!req.user.isProfileComplete) {
            return res.redirect(
                `${process.env.FRONTEND_URL}/google/callback?token=${accessToken}&isProfileComplete=false`
            );
        }

        // Profile complete → go to dashboard
        res.redirect(`${process.env.FRONTEND_URL}/google/callback?token=${accessToken}&isProfileComplete=true`);
    }
);


authRouter.post('/reset-password/verify-user', async (req, res) => {
    const { identifier } = req.body;
    try {
        const user = await User.findOne({
            $or: [
                { 'contact.email': identifier },
                { userName: identifier }
            ]
        })
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const email = user.contact.email;
        const otpRecord = await OtpModel.findOne({ email });
        if (otpRecord?.blockUntil && otpRecord.blockUntil > Date.now()) {
            return res.status(429).json({
                success: false,
                message: "Too many attempts. Try again later."
            });
        }
        if (otpRecord?.attempts >= 5) {
            const blockUntil = new Date(Date.now() + 5 * 60 * 1000);
            await OtpModel.updateOne({ email }, { blockUntil });
            return res.status(429).json({ success: false, message: "Too many failed attempts. You are blocked for 5 minutes." });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);
        const purpose = 'PASSWORD_RESET'

        const attempts = (otpRecord?.attempts || 0) + 1;
        const blockUntil = attempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000) : null;
        await OtpModel.findOneAndUpdate(
            { email },
            {
                email,
                userName: user.userName, // <--- BINDING HAPPENS HERE
                otp: hashedOtp,
                purpose: purpose,
                attempts,
                blockUntil,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                isVerified: false
            },
            { upsert: true, new: true }
        );
        await sendMail({ email, generatedOtp, purpose });
        // Example: turns "ankitpandey@gmail.com" into "an*********@gmail.com"
        const maskEmail = (email) => {
            if (!email || !email.includes('@')) return email;
            const [name, domain] = email.split('@');
            return `${name.substring(0, 2)}${'*'.repeat(name.length - 2)}@${domain}`;
        };
        return res.status(200).json(
            {
                success: true,
                message: `OTP sent to ${maskEmail(email)}`
            }
        );
    }
    catch (err) {
        console.log(err);
        const errorMessage = err.message || "";
        if (errorMessage.toLowerCase().includes("blocked") || errorMessage.toLowerCase().includes("unsubscribed")) {
            return res.status(403).json({
                success: false,
                message: "Your email address has unsubscribed from LocalAwaaz emails. Please contact support to unblock your account."
            });
        }
        return res.status(500).json({ success: false, message: "Server error in sending OTP" })

    }
})

authRouter.post('/reset-password/verify-otp', async (req, res) => {
    const { identifier, otp } = req.body;
    var userOtp = otp;
    try {
        if (!identifier || !userOtp) {
            return res.status(400).json({ success: false, message: "Missing required fields" })
        }
        const purpose = "PASSWORD_RESET"
        const otpRecord = await OtpModel.findOne({
            $or: [
                { email: identifier },
                { userName: identifier }
            ],
            purpose
        });
        if (!otpRecord) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const { otp, attempts, expiresAt } = otpRecord;
        const hashedOtp = otp;
        if (attempts >= 5) {
            return res.status(400).json({ success: false, message: "Too many attempts! Try again after some time" })
        }
        if (Date.now() > expiresAt) {
            return res.status(400).json({ success: false, message: "OTP expired" })
        }
        const isMatch = await bcrypt.compare(userOtp, hashedOtp);
        if (!isMatch) {
            otpRecord.attempts += 1;
            await otpRecord.save();
            return res.status(400).json({ success: false, message: "Invalid OTP entered" })
        }
        const resetToken = jwt.sign({ identifier, purpose }, process.env.OTP_TOKEN_SECRET, { expiresIn: "10m" });
        otpRecord.resetToken = resetToken;
        otpRecord.isVerified = true;
        otpRecord.otp = null;
        await otpRecord.save();
        return res.status(200).json(
            {
                success: true,
                message: "OTP verified successfully",
                resetToken: resetToken
            }
        );
    }
    catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Server Error : OTP can't be verified" });
    }

})

authRouter.patch('/reset-password/update', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const { resetToken } = req.query
        const purpose = "PASSWORD_RESET"
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Missing Required fields" });
        }
        if (!resetToken) {
            return res.send("Missing Reset Token");
        }
        if (!validator.isStrongPassword(password)) {
            return res.send("Enter Strong Password");
        }
        try {
            const isValidToken = jwt.verify(resetToken, process.env.OTP_TOKEN_SECRET);
            const { purpose } = isValidToken;
            if (purpose !== "PASSWORD_RESET") {
                return res.status(403).json({ success: false, message: "Invalid token usage" })
            }
        }
        catch (err) {
            return res.status(400).json({ success: false, message: "Invalid or expired Reset Token" })
        }
        const user = await User.findOne({
            $or: [
                { 'contact.email': identifier },
                { userName: identifier }
            ]
        });
        if (!user) { return res.status(404).json({ success: false, message: "User not found" }); }
        const isVerified = true
        const email = user.contact.email;
        const record = await OtpModel.findOne({ email, resetToken, purpose, isVerified });
        if (!record) {
            return res.status(404).json({ success: false, message: "OTP Record not found" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        await user.save();
        await OtpModel.deleteOne({ _id: record._id })

        return res.status(200).json({ success: true, message: "Password Changed Successfully" });
    }
    catch (err) {
        console.log("Password Reset Update Error:", err);
        return res.status(500).json({ success: false, message: "Server Error : Password Reset Failure" })
    }

})
module.exports = authRouter;
