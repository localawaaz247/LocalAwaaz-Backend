const express = require('express');
const { sendMail } = require('../config/sendOtp');
const verifyOtp = require('../config/verifyOtp');
const validate = require('validator');
const OtpModel = require('../models/Otp');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const otpRouter = express.Router();


otpRouter.post('/otp/request', async (req, res) => {
    try {
        const { email, userName } = req.body;
        if (!email || !validate.isEmail(email)) {
            return res.status(400).json({ success: false, message: "Enter Valid email id" });
        }
        let user = null;
        //check whether email is verifying from within the app
        if (userName) {
            user = await User.findOne({ userName });
            if (!user) {
                return res.status(400).json({ success: false, message: "User does not exists" });
            }
            else {
                if (user?.contact?.email && user.contact.email !== email) {
                    return res.send(400).json({ success: false, message: "Email does not match the user" });
                }
            }
        }

        //what if email is already in use by some other account
        let existingEmailUser = await User.findOne({ "contact.email": email });
        if (existingEmailUser && existingEmailUser.userName !== userName) {
            return res.status(400).json({ success: false, message: "Email is already in use by another account" });
        }

        const otpRecord = await OtpModel.findOne({ email });
        if (otpRecord?.blockUntil && otpRecord?.blockUntil > Date.now()) {
            return res.status(429).json({ success: false, message: "Too many requests. Try again later" });
        }

        const attempts = (otpRecord?.attempts || 0) + 1;
        const blockUntil = attempts > 5 ? new Date(Date.now() + 5 * 60 * 1000) : null;

        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);
        await sendMail({ email, generatedOtp });
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await OtpModel.findOneAndUpdate({ email }, {
            email,
            otp: hashedOtp,
            userName: userName || otpRecord?.userName || null,
            attempts,
            lastSent: new Date(),
            blockUntil,
            expiresAt,
            isVerified: false
        }, {
            upsert: true, new: true
        })
        res.status(200).json({ success: true, message: "OTP sent on email id" });
    } catch (err) {
        console.log(err)
        return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
})

otpRouter.post('/otp/verify', async (req, res) => {
    try {
        const { email, otp, userName } = req.body;

        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

        await verifyOtp(email, otp);
        if (userName) {
            const userRecord = await OtpModel.findOne({ email, userName });
            if (userRecord) {
                const user = await User.findOne({ userName });
                user.isVerified = true
                user.email = email;
                await user.save();
            }
        }
        res.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
})

module.exports = otpRouter