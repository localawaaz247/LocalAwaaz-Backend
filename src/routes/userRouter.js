const express = require('express');
const { sendMail } = require('../../config/sendOtp');
const validateSignUpData = require('../../utils/validateSignUpData');
const { saveOtp, verifyOtp } = require('../../config/otpStore');
const validate = require('validator')
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
        console.log(generatedOtp)
        await sendMail({ email, generatedOtp });
        saveOtp(email, generatedOtp);
        res.status(200).json({ success: true, message: "OTP sent on your email id" });
    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})


userRouter.post('/user/verify-otp', (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

        verifyOtp(email, otp);

        res.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (err) {
        res.status(400).json({ success: false, message: 'Enter Correct OTP' });
    }
})
userRouter.post('/user/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!validate.isEmail(email)) {
            return res.status(400).json({ message: "Enter Valid email id" });
        }
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(generatedOtp)
        await sendMail({ email, generatedOtp });
        saveOtp(email, generatedOtp);
        res.status(200).json({ success: true, message: "OTP sent on your email id" });
    } catch (err) {
        res.status(400).json({ success: false, message: "Enter valid email id" });
    }
})
module.exports = userRouter