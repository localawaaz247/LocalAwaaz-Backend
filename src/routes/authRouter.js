const express = require('express');
const validateSignUpData = require('../utils/validateLocalSignupData');
const OtpModel = require('../models/Otp');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const checkUniqueness = require('../utils/checkUniqueness');
const { generateAccessToken, generateRefreshToken } = require('../config/tokens');
require('dotenv').config();
const passport = require('passport');
const LoginAttempt = require('../models/LoginAttempt');
const { sendMail } = require('../config/sendOtp');
const validator = require('validator')
const Inquiry = require('../models/Inquiry');

const authRouter = express.Router();

const { OAuth2Client } = require('google-auth-library');
// Note: You will eventually need to add your Android/iOS Client IDs here too, 
// but we can start with the web client ID for the backend verification.
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * USER REGISTRATION
 */
authRouter.post('/auth/register', async (req, res) => {
    try {
        const {
            userName, password, name, email, gender, country, state, city, pinCode
        } = req.body;

        // Validate payload & check duplicates
        validateSignUpData(req);
        await checkUniqueness(req);

        const role = 'user';
        const hashedPassword = await bcrypt.hash(password, 10);
        const isProfileComplete = true;

        // Verify OTP session exists and is verified
        const otpRecord = await OtpModel.findOne({ email });
        if (!otpRecord || !otpRecord.isVerified) {
            return res.status(400).json({ success: false, message: "Email is not verified" });
        }

        // Prevent session hijacking
        if (otpRecord.userName !== userName) {
            return res.status(400).json({
                success: false,
                message: "Security Mismatch: The verified email is bound to a different username."
            });
        }

        // Create User
        await User.create({
            userName, password: hashedPassword, role, name, gender, isProfileComplete,
            isEmailVerified: true, civilScore: 10,
            contact: { email, country, state, city, pinCode }
        });

        // Cleanup OTP
        await OtpModel.deleteOne({ email });

        res.status(200).json({ success: true, message: "Signup Successful" });

    } catch (err) {
        console.error("Signup Error:", err);
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * USER LOGIN
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
            return res.status(400).json({ success: false, message: "Invalid User credentials" });
        }

        // ---------------------------------------------------------
        // GATEWAY: BLOCK SUSPENDED/BANNED ACCOUNTS FROM LOGGING IN
        // ---------------------------------------------------------
        if (user.accountStatus === 'BANNED' || user.accountStatus === 'SUSPENDED') {
            return res.status(403).json({
                success: false,
                message: `Account ${user.accountStatus.toLowerCase()}. Contact administrator first.`
            });
        }

        // ---------------------------------------------------------
        // GATEWAY: BLOCK UNVERIFIED AUTHORITIES (NGO/OFFICIAL)
        // ---------------------------------------------------------
        if (['official', 'ngo'].includes(user.role)) {
            if (!user.authorityProfile || !user.authorityProfile.isVerified) {
                return res.status(403).json({
                    success: false,
                    message: "Your application is still under review by the Admin. Please wait for verification."
                });
            }
        }

        // Login Attempt Throttling
        let attempt = await LoginAttempt.findOne({ userId: user._id });
        if (!attempt) {
            attempt = await LoginAttempt.create({ userId: user._id });
        }

        if (attempt.lockUntil && attempt.lockUntil > Date.now()) {
            return res.status(429).json({ success: false, message: "Too many attempts. Try again Later" });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            attempt.failedAttempts += 1;
            attempt.lastAttempt = Date.now();

            if (attempt.failedAttempts === 3) {
                attempt.lockUntil = new Date(Date.now() + 30 * 1000);
            } else if (attempt.failedAttempts === 5) {
                attempt.lockUntil = new Date(Date.now() + 5 * 60 * 1000);
            }

            await attempt.save();
            return res.status(400).json({ success: false, message: "Invalid User credentials" });
        }

        // Reset attempt counters
        attempt.failedAttempts = 0;
        attempt.lastAttempt = new Date();
        attempt.lockUntil = null;
        await attempt.save();

        // Token Generation
        const accessToken = generateAccessToken(user._id, user.role);
        const refreshToken = generateRefreshToken(user._id, user.role);
        const isProduction = process.env.NODE_ENV === "production"

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            path: '/refresh_token',
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax"
        });

        const userObj = user.toObject();
        delete userObj.password;

        res.json({ accessToken, user: userObj });

    } catch (err) {
        res.status(401).json({ success: false, message: "Unauthorized Access" });
    }
});

/**
 * REFRESH ACCESS TOKEN
 */
authRouter.post('/refresh_token', async (req, res) => {
    try {
        const { refreshToken } = req.cookies;

        if (!refreshToken) {
            return res.status(401).json({ success: false, message: "No refresh token" });
        }

        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        if (!decoded) {
            return res.status(403).json({ success: false, message: "Invalid refresh token" });
        }

        const accessToken = generateAccessToken(decoded.id, decoded.role);
        return res.json({ accessToken });

    } catch (err) {
        res.status(401).json({ success: false, message: "Unauthorized Access" });
    }
});

/**
 * LOGOUT
 */
authRouter.post('/auth/logout', (req, res) => {
    try {
        const isProduction = process.env.NODE_ENV === "production";
        res.clearCookie('refreshToken', {
            httpOnly: true,
            path: '/refresh_token',
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax"
        });

        res.status(200).json({ success: true, message: "User Logged Out Successfully" });

    } catch (err) {
        res.status(500).json({ success: false, message: "Error in Logging out" });
    }
});

/**
 * GOOGLE AUTH
 */
authRouter.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

authRouter.get(
    "/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/login",
        session: false
    }),
    (req, res) => {

        // ---------------------------------------------------------
        // GATEWAY: BLOCK SUSPENDED/BANNED GOOGLE USERS
        // ---------------------------------------------------------
        if (req.user.accountStatus === 'BANNED' || req.user.accountStatus === 'SUSPENDED') {
            // Redirect them to login with a query parameter indicating they are banned
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=account_${req.user.accountStatus.toLowerCase()}`);
        }

        const accessToken = generateAccessToken(req.user._id, req.user.role);
        const refreshToken = generateRefreshToken(req.user._id, req.user.role);
        const EXPIRY_LIMIT = 7 * 24 * 60 * 60 * 1000

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax',
            maxAge: EXPIRY_LIMIT
        });

        if (!req.user.isProfileComplete) {
            return res.redirect(`${process.env.FRONTEND_URL}/google/callback?token=${accessToken}&isProfileComplete=false&role=${req.user.role}`);
        }

        res.redirect(`${process.env.FRONTEND_URL}/google/callback?token=${accessToken}&isProfileComplete=true&role=${req.user.role}`);
    }
);

/**
 * PASSWORD RESET: VERIFY USER
 */
authRouter.post('/reset-password/verify-user', async (req, res) => {
    const { identifier } = req.body;
    try {
        const user = await User.findOne({
            $or: [
                { 'contact.email': identifier },
                { userName: identifier }
            ]
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // ---------------------------------------------------------
        // GATEWAY: BLOCK PASSWORD RESETS FOR BANNED ACCOUNTS
        // ---------------------------------------------------------
        if (user.accountStatus === 'BANNED' || user.accountStatus === 'SUSPENDED') {
            return res.status(403).json({
                success: false,
                message: `Account ${user.accountStatus.toLowerCase()}. Contact administrator first.`
            });
        }

        const email = user.contact.email;
        const otpRecord = await OtpModel.findOne({ email });

        if (otpRecord?.blockUntil && otpRecord.blockUntil > Date.now()) {
            return res.status(429).json({ success: false, message: "Too many attempts. Try again later." });
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
                email, userName: user.userName, otp: hashedOtp, purpose: purpose,
                attempts, blockUntil, expiresAt: new Date(Date.now() + 10 * 60 * 1000), isVerified: false
            },
            { upsert: true, new: true }
        );

        await sendMail({ email, generatedOtp, purpose });

        const maskEmail = (email) => {
            if (!email || !email.includes('@')) return email;
            const [name, domain] = email.split('@');
            return `${name.substring(0, 2)}${'*'.repeat(name.length - 2)}@${domain}`;
        };

        return res.status(200).json({ success: true, message: `OTP sent to ${maskEmail(email)}` });

    } catch (err) {
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
});

/**
 * PASSWORD RESET: VERIFY OTP
 */
authRouter.post('/reset-password/verify-otp', async (req, res) => {
    const { identifier, otp } = req.body;
    var userOtp = otp;
    try {
        if (!identifier || !userOtp) {
            return res.status(400).json({ success: false, message: "Missing required fields" })
        }

        const purpose = "PASSWORD_RESET"
        const otpRecord = await OtpModel.findOne({
            $or: [{ email: identifier }, { userName: identifier }],
            purpose
        });

        if (!otpRecord) return res.status(404).json({ success: false, message: "User not found" });

        const { otp: hashedOtp, attempts, expiresAt } = otpRecord;

        if (attempts >= 5) return res.status(400).json({ success: false, message: "Too many attempts! Try again after some time" })
        if (Date.now() > expiresAt) return res.status(400).json({ success: false, message: "OTP expired" })

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

        return res.status(200).json({ success: true, message: "OTP verified successfully", resetToken });

    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error : OTP can't be verified" });
    }
});

/**
 * PASSWORD RESET: UPDATE DB
 */
authRouter.patch('/reset-password/update', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const { resetToken } = req.query
        const purpose = "PASSWORD_RESET"

        if (!identifier || !password) return res.status(400).json({ success: false, message: "Missing Required fields" });
        if (!resetToken) return res.send("Missing Reset Token");
        if (!validator.isStrongPassword(password)) return res.send("Enter Strong Password");

        try {
            const isValidToken = jwt.verify(resetToken, process.env.OTP_TOKEN_SECRET);
            if (isValidToken.purpose !== "PASSWORD_RESET") {
                return res.status(403).json({ success: false, message: "Invalid token usage" })
            }
        } catch (err) {
            return res.status(400).json({ success: false, message: "Invalid or expired Reset Token" })
        }

        const user = await User.findOne({
            $or: [{ 'contact.email': identifier }, { userName: identifier }]
        });

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const email = user.contact.email;
        const record = await OtpModel.findOne({ email, resetToken, purpose, isVerified: true });

        if (!record) return res.status(404).json({ success: false, message: "OTP Record not found" });

        user.password = await bcrypt.hash(password, 10);
        await user.save();
        await OtpModel.deleteOne({ _id: record._id })

        return res.status(200).json({ success: true, message: "Password Changed Successfully" });

    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error : Password Reset Failure" })
    }
});

/**
 * INQUIRY
 */
authRouter.post('/inquiry', async (req, res) => {
    try {
        const { name, email, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: "Name, email, and message are required." });
        }

        const newInquiry = await Inquiry.create({ name, email, message });

        return res.status(201).json({
            success: true,
            message: "Message sent successfully!",
            data: newInquiry
        });

    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error: Could not submit your message." });
    }
});

/**
 * NATIVE GOOGLE AUTH (For Mobile App)
 * Does not use redirects. Expects a POST request with an idToken.
 */
authRouter.post('/auth/google/native', async (req, res) => {
    try {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ success: false, message: "ID Token is required" });
        }

        // 1. Verify the token securely with Google
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();

        // 2. Security Check (Mimicking your Passport logic)
        if (!payload.email_verified) {
            return res.status(400).json({ success: false, message: "Google account email is not verified." });
        }

        const email = payload.email;
        const googleId = payload.sub;

        // 3. User Lookup / Creation
        let user = await User.findOne({ googleId });

        if (!user) {
            const emailUser = await User.findOne({ "contact.email": email });

            if (emailUser) {
                if (emailUser.googleId) {
                    return res.status(400).json({ success: false, message: "This email is already linked to another Google account" });
                }

                emailUser.googleId = googleId;
                if (!emailUser.profilePic) {
                    emailUser.profilePic = payload.picture;
                }
                user = await emailUser.save();
            } else {
                user = await User.create({
                    name: payload.name,
                    contact: { email },
                    googleId: googleId,
                    profilePic: payload.picture,
                    isEmailVerified: true,
                    civilScore: 10,
                    isProfileComplete: false,
                });
            }
        }

        // 4. Gateway: Block Suspended/Banned Users
        if (user.accountStatus === 'BANNED' || user.accountStatus === 'SUSPENDED') {
            return res.status(403).json({
                success: false,
                message: `Account ${user.accountStatus.toLowerCase()}. Contact administrator first.`
            });
        }

        // 5. Generate Tokens & Set Cookies
        const accessToken = generateAccessToken(user._id, user.role);
        const refreshToken = generateRefreshToken(user._id, user.role);
        const EXPIRY_LIMIT = 7 * 24 * 60 * 60 * 1000;
        const isProduction = process.env.NODE_ENV === "production";

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: EXPIRY_LIMIT
        });

        const userObj = user.toObject();
        delete userObj.password;

        // Send back a JSON response instead of a redirect
        return res.status(200).json({
            success: true,
            accessToken,
            user: userObj,
            isProfileComplete: user.isProfileComplete
        });

    } catch (err) {
        console.error("Native Google Auth Error:", err);
        return res.status(500).json({ success: false, message: "Google Authentication Failed" });
    }
});

/**
 * ============================
 * AUTHORITY (NGO/OFFICIAL) REGISTRATION
 * ============================
 * Creates an unverified 'official' or 'ngo' account. 
 * Must be verified by SuperAdmin before they can login.
 */
authRouter.post('/auth/register-authority', async (req, res) => {
    try {
        const {
            name, email, password, role, // role must be 'official' or 'ngo'
            departmentName, expertiseTags,
            assignedState, assignedDistrict, idProofUrl,
            country, state, city, pinCode
        } = req.body;

        // 1. Validate Input Basics
        if (!['official', 'ngo'].includes(role)) {
            return res.status(400).json({ success: false, message: "Role must be 'official' or 'ngo'" });
        }
        if (!departmentName || !assignedDistrict || !assignedState || !idProofUrl) {
            return res.status(400).json({ success: false, message: "Missing required authority profile fields." });
        }

        // 2. Check for existing email across the entire platform
        const existingUser = await User.findOne({ "contact.email": email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email is already registered." });
        }

        // 3. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Generate a unique username for them based on department
        const baseUserName = departmentName.toLowerCase().replace(/[^a-z0-9]/g, '') + "_" + Math.floor(1000 + Math.random() * 9000);

        // 5. Create the Unverified Authority User
        const newAuthority = await User.create({
            name,
            userName: baseUserName,
            password: hashedPassword,
            role: role,
            isProfileComplete: true,
            isEmailVerified: true, // Assuming you verify email on frontend or trust it for now
            contact: {
                email: email.toLowerCase(),
                country, state, city, pinCode
            },
            authorityProfile: {
                departmentName,
                expertiseTags: expertiseTags || [],
                assignedState,
                assignedDistrict,
                idProofUrl,
                isVerified: false // Admin must change this to true later
            }
        });

        // 6. Return Success Response
        res.status(201).json({
            success: true,
            message: "Authority Registration submitted successfully. Please wait for Admin verification.",
            authorityId: newAuthority._id
        });

    } catch (err) {
        console.error("Authority Registration Error:", err);
        res.status(500).json({ success: false, message: "Server error during registration." });
    }
});

module.exports = authRouter;