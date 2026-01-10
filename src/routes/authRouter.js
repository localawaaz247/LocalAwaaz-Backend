    const express = require('express');
    const validateSignUpData = require('../utils/validateSignUpData');
    const verifyOtp = require('../config/verifyOtp');
    const validate = require('validator');
    const OtpModel = require('../models/Otp');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcrypt');
    const User = require('../models/User');
    const checkUniqueness = require('../utils/checkUniqueness');
    const { generateAccessToken, generateRefreshToken } = require('../config/tokens');
    const authRouter = express.Router();

    authRouter.post('/auth/register', async (req, res) => {
        try {
            const { userName, password, name, email, gender, country, state, district, pinCode } = req.body;
            validateSignUpData(req);
            await checkUniqueness(req);
            const role = 'user'
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = await User.create({ userName, password: hashedPassword, role, name, contact: { email, gender, country, state, district, pinCode } });
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

    authRouter.post('/auth/login', async (req, res) => {
        try {
            const { identifier, password } = req.body;
            const user = await User.findOne({
                $or: [
                    { "contact.email": identifier },
                    { userName: identifier }
                ]
            });
            if (!user) {
                return res.status(400).json({ success: false, message: "User credentials Invalid" })
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: "User credentials Invalid" })
            }
            const accessToken = generateAccessToken(user._id);
            const refreshToken = generateRefreshToken(user._id);
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                path: '/refresh_token'
            })
            const userObj = user.toObject();
            delete userObj.password;
            res.json({ accessToken, user: userObj });
        }
        catch (err) {
            res.status(401).json({ success: false, message: "Unauthorized access" });
        }
    })

    authRouter.post('/refresh_token', async (req, res) => {
        try {
            const { refreshToken } = req.cookies;
            if (!refreshToken) return res.status(401).json({ success: false, message: "No refresh token" });
            const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
            if (!decoded) {
                return res.status(403).json({ success: false, message: "Invalid refresh token" });
            }
            const accessToken = generateAccessToken(decoded._id);
            res.json({ accessToken });
        }
        catch (err) {
            res.status(401).json({ success: false, message: "Unauthorized Access" });
        }
    })

    authRouter.post('/auth/logout', (req, res) => {
        try {
            res.clearCookie('refreshToken', {
                httpOnly: true,
                path: '/refresh_token'
            });
            res.status(200).json({ success: true, message: "User Logged Out successfully" })
        }
        catch (err) {
            res.status(500).json({ success: false, message: "Error in Logging out" })
        }
    })

    module.exports = authRouter