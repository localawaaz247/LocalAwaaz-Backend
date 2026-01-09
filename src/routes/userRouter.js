const express = require('express');
const { sendMail } = require('../config/sendOtp')
const validateSignUpData = require('../../utils/validateSignUpData');
const verifyOtp = require('../config/verifyOtp');
const validate = require('validator');
const OtpModel = require('../models/Otp');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const checkUniqueness = require('../../utils/checkUniqueness');
const userRouter = express.Router();

userRouter.post('/user/signup', async (req, res) => {
    try {
        const { userName, password, name, profilePic, email, gender, mobile, country, state, district, pinCode } = req.body;
        validateSignUpData(req);
        await checkUniqueness(req);
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ userName, password: hashedPassword, email, name, profilePic, gender, mobile, country, state, district, pinCode });
        const otpRecord = await OtpModel.findOne({ email, isVerified: true });
        if (otpRecord) {
            user.isVerified = true;
            await user.save();
        }
        const token = jwt.sign({ userName: user.userName }, process.env.JWT_PRIVATE_KEY, {
            expiresIn: '7d'
        });
        res.cookie("token", token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: true
        });
        res.status(200).json({ success: true, message: "Signup Successful" });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
})

userRouter.post('/user/send-otp', async (req, res) => {
    try {
        const { email, userName } = req.body;
        if (!validate.isEmail(email)) {
            return res.status(400).json({ message: "Enter Valid email id" });
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

        res.status(200).json({ success: true, message: "If email exists, OTP has been sent" });
    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})


userRouter.post('/user/verify-otp', async (req, res) => {
    try {
        const { email, otp, userName } = req.body;

        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

        await verifyOtp(email, otp);
        if (userName) {
            const userRecord = await OtpModel.findOne({ userName });
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
userRouter.post('/user/resend-otp', async (req, res) => {
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
        res.status(200).json({ success: true, message: "If email exists, OTP has been sent" });

    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})
module.exports = userRouter