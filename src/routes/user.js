const express = require('express');
const User = require('../models/User');
const userRouter = express.Router();
const bcrypt = require('bcrypt');


userRouter.post("/user/request-otp", async (req, res) => {
    try {
        const { mobile } = req.body;
        if (!mobile) return res.status(400).json({ message: 'Mobile number is required' });

        //Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(otp, 10);
        //Find User
        let user = await User.findOne({ mobile });
        if (!user) {
            user = await User.create({ mobile, otp: hashedOtp });
        }
        else {
            //Update Otp for existing user
            user.otp = hashedOtp;
            await user.save();
        }
        //TODO : Send OTP via Gateway


        res.status(200).json({ message: "OTP sent on Mobile Number" });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ message: "OTP could not be sent" });
    }

})

module.exports = userRouter;