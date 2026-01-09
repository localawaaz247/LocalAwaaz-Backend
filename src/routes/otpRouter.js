const express = require('express');
const { sendMail } = require('../config/sendOtp');
const verifyOtp = require('../config/verifyOtp');
const validate = require('validator');
const OtpModel = require('../models/Otp');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const otpRouter = express.Router();


otpRouter.post('/auth/otp/send', async (req, res) => {
    try {
        const { email, userName } = req.body;
        if (!email || !validate.isEmail(email)) {
            return res.status(400).json({ success: false, message: "Enter Valid email id" });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);
        await sendMail({ email, generatedOtp });
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
        if (userName) {
            await OtpModel.create({ email, otp: hashedOtp, userName, expiresAt });
        }
        else {
            await OtpModel.create({ email, otp: hashedOtp, expiresAt });
        }

        res.status(200).json({ success: true, message: "OTP sent on email id" });
    } catch (err) {
        console.log(err)
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})

otpRouter.post('/auth/otp/verify', async (req, res) => {
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

otpRouter.post('/auth/otp/resend', async (req, res) => {
    try {
        const { email, userName } = req.body;
        if (!validate.isEmail(email)) {
            return res.status(400).json({ message: "Enter Valid email id" });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);
        const record = await OtpModel.findOne({ email });
        if (!record) {
            return res.status(400).json({ success: false, message: "Enter valid email id" })
        }
        await sendMail({ email, generatedOtp });
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        if (userName) {
            record.userName = userName;
        }
        record.otp = hashedOtp;
        record.attempts = 0;
        record.expiresAt = expiresAt;
        await record.save();
        res.status(200).json({ success: true, message: "OTP sent on email id" });

    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})

module.exports = otpRouter