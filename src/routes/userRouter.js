const express = require('express');
const { sendMail } = require('../config/sendOtp')
const validateSignUpData = require('../../utils/validateSignUpData');
const verifyOtp = require('../config/verifyOtpfn&storage');
const validate = require('validator');
const OtpModel = require('../models/Otp');
const bcrypt = require('bcrypt')
const userRouter = express.Router();

userRouter.post('/user/signup', async (req, res) => {
    try {
        validateSignUpData(req);
        res.status(200).json({ success: true, message: "Signup Successfull" });

    } catch (err) {
        res.status(400).json({ success: false, message: "Denied Signup Request" });
    }
})

userRouter.post('/user/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!validate.isEmail(email)) {
            return res.status(400).json({ message: "Enter Valid email id" });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(generatedOtp, 10);
        await sendMail({ email, generatedOtp });
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
        const record = await OtpModel.findOne({ email });
        if (record) {
            record.otp = hashedOtp;
            record.expiresAt = expiresAt;
            await record.save();
        }
        else {
            await OtpModel.create({ email, otp: hashedOtp, expiresAt });
        }
        res.status(200).json({ success: true, message: "If email exists, OTP has been sent" });
    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})


userRouter.post('/user/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

        await verifyOtp(email, otp);
        
        res.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
})
userRouter.post('/user/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
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
        record.otp = hashedOtp;
        record.attempts = 0;
        record.expiresAt = expiresAt;
        await record.save();
        res.status(200).json({ success: true, message: "If email exists, OTP has been sent" });

    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})
module.exports = userRouter