const express = require('express');
const { sendMail } = require('../config/sendOtp');   // sends OTP email
const verifyOtp = require('../config/verifyOtp');   // verifies OTP correctness + expiry
const validate = require('validator');
const OtpModel = require('../models/OtpModel');     // stores OTP, attempts, block info
const bcrypt = require('bcrypt');
const User = require('../models/User');
const otpRouter = express.Router();
const jwt = require('jsonwebtoken');

/**
 * ============================
 * OTP REQUEST ROUTE
 * ============================
 * Handles:
 * 1. Email validation
 * 2. Database uniqueness check
 * 3. OTP throttling & blocking
 * 4. OTP generation + storage (UPSERT)
 */
otpRouter.post('/otp/request', async (req, res) => {
    try {
        const { email } = req.body; // <--- userName removed!

        // Basic email validation
        if (!email || !validate.isEmail(email)) {
            return res.status(400).json({ success: false, message: "Enter valid email id" });
        }

        const lowerCaseEmail = email.toLowerCase();

        // Check if email already registered
        const emailExists = await User.findOne({ "contact.email": lowerCaseEmail });
        if (emailExists) {
            return res.status(409).json({ success: false, message: "Email already registered. Please login." });
        }

        const purpose = "REGISTER";
        const otpRecord = await OtpModel.findOne({ email: lowerCaseEmail, purpose });

        if (otpRecord?.blockUntil && otpRecord.blockUntil > Date.now()) {
            return res.status(429).json({ success: false, message: "Too many attempts. Try again later." });
        }

        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);

        const attempts = (otpRecord?.attempts || 0) + 1;
        const blockUntil = attempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000) : null;

        await sendMail({ email: lowerCaseEmail, generatedOtp, purpose });

        await OtpModel.findOneAndUpdate(
            { email: lowerCaseEmail, purpose },
            {
                email: lowerCaseEmail,
                otp: hashedOtp,
                purpose,
                attempts,
                blockUntil,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                isVerified: false
            },
            { upsert: true, new: true }
        );

        // Example: turns "ankitpandey@gmail.com" into "an*********@gmail.com"
        const maskEmail = (email) => {
            if (!email || !email.includes('@')) return email;
            const [name, domain] = email.split('@');
            return `${name.substring(0, 2)}${'*'.repeat(name.length - 2)}@${domain}`;
        };

        res.status(200).json({ success: true, message: `OTP sent to ${maskEmail(lowerCaseEmail)}` });

    } catch (err) {
        console.log(err);
        return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
});

/**
 * ============================
 * OTP VERIFY ROUTE
 * ============================
 */
otpRouter.post('/otp/verify', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }

        // Pass null for userName to avoid breaking your existing verifyOtp utility
        await verifyOtp(email.toLowerCase(), otp, "REGISTER", null);
        const tempUploadToken = jwt.sign(
            { email: email, purpose: 'REGISTRATION_UPLOAD' },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '15m' } // Only valid for 15 minutes!
        );

        return res.status(200).json({
            success: true,
            message: "Email verified successfully",
            tempUploadToken
        });
    } catch (err) {
        console.log("OTP Verification Error:", err);
        return res.status(400).json({ success: false, message: err.message || "OTP Verification Failed" });
    }
});

module.exports = otpRouter;