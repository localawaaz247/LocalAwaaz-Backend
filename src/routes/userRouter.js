const express = require('express');
const { sendMail } = require('../../config/sendOtp');
const validateSignUpData = require('../../utils/validateSignUpData');
const userRouter = express.Router();

userRouter.post('/user/signup', async (req, res) => {
    const { userId, password, email, name, profilePic, gender, mobile, country, state, pinCode } = req.body;
    validateSignUpData(req);
    if (email) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await sendMail({ email, otp });
        res.send("OTP sent");
        
    }
})

module.exports = userRouter