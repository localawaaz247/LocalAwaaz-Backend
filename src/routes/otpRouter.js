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
        if (!userName || userName.trim().length < 4) {
            return res.status(400).json({
                success: false,
                message: "Valid UserName is required to start verification"
            });
        }
        // Basic email validation
        if (!email || !validate.isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter valid email id"
            });
        }
        const userNameExists = await User.findOne({ userName });
        if (userNameExists) {
            return res.status(409).json({
                success: false,
                message: "UserName already taken. Choose another."
            });
        }
        const emailExists = await User.findOne({ "contact.email": email });
        if (emailExists) {
            return res.status(409).json({
                success: false,
                message: "Email already registered. Please login."
            });
        }
        const purpose = "REGISTER";
        const otpRecord = await OtpModel.findOne({ email, purpose });
        if (otpRecord?.blockUntil && otpRecord.blockUntil > Date.now()) {
            return res.status(429).json({
                success: false,
                message: "Too many attempts. Try again later."
            });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);

        const attempts = (otpRecord?.attempts || 0) + 1;
        const blockUntil = attempts > 5 ? new Date(Date.now() + 5 * 60 * 1000) : null;
        await sendMail({ email, generatedOtp, purpose });
        await OtpModel.findOneAndUpdate(
            { email, purpose },
            {
                email,
                userName: userName, // <--- BINDING HAPPENS HERE
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
        res.status(200).json({
            success: true,
            message: `OTP sent to ${maskEmail(email)}`
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

        if (!email || !otp || !userName) {
            return res.status(400).json({ message: 'Email, OTP, and userName are required' });
        }

        // Pass the data to your utility! 
        // If it fails, it throws an error and jumps straight to the catch block.
        await verifyOtp(email, otp, "REGISTER", userName);

        // If we reach this line, the OTP was perfectly valid!
        res.status(200).json({
            success: true,
            message: 'Email verified successfully!'
        });

    } catch (err) {
        // This catches ALL errors from your utility ("Expired", "Invalid OTP", etc.)
        console.log("OTP Verification Error:", err);
        return res.status(400).json({
            success: false,
            message: err.message || "OTP Verification Failed"
        });
    }
});

module.exports = otpRouter;
