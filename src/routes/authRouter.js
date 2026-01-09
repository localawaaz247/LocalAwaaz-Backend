const express = require('express');
const validateSignUpData = require('../utils/validateSignUpData');
const verifyOtp = require('../config/verifyOtp');
const validate = require('validator');
const OtpModel = require('../models/Otp');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const checkUniqueness = require('../utils/checkUniqueness');
const authRouter = express.Router();

authRouter.post('/auth/register', async (req, res) => {
    try {
        const { userName, password, name, email, gender, country, state, district, pinCode } = req.body;
        validateSignUpData(req);
        await checkUniqueness(req);
        const role = 'user'
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ userName, password: hashedPassword, email, role, name, gender, country, state, district, pinCode });
        const otpRecord = await OtpModel.findOne({ email, isVerified: true });
        if (otpRecord) {
            user.isVerified = true;
            await user.save();
        }
        res.status(200).json({ success: true, message: "Signup Successful" });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
})

authRouter.post('/auth/login', (req, res) => {

})

authRouter.post('/auth/logout', (req, res) => {

})

module.exports = authRouter