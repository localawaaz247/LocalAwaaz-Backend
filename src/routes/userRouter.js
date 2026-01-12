const express = require("express");
const User = require("../models/User");
const userAuth = require("../middlewares/userAuth");
const userRouter = express.Router();
const validate = require('validator');

// Complete profile route
userRouter.patch("/users/complete-profile", userAuth, async (req, res) => {
    try {
        const { userName, gender, mobile, country, state, district, pinCode } = req.body;

        // Optional: you can run a partial validator for only these fields
        const userNameRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d_@]+$/;
        if (!userName || userName.length < 4) return res.status(400).json({ success: false, message: "Username too short" });
        if (!userNameRegex.test(userName)) return res.status(400).json({ success: false, message: "userName must contain at least 1 uppercase, 1 lowercase, 1 number and only _ or @ are allowed" });
        if (!gender || !["male", "female", "other"].includes(gender)) return res.status(400).json({ success: false, message: "Invalid gender" });
        if (!mobile || !validate.isMobilePhone(mobile, 'any')) {
            return res.status(400).json({ success: false, message: ('Enter valid Mobile Number') });
        }
        //Check for existing userName
        const existing = await User.findOne({ userName, _id: { $ne: req.userId } });
        if (existing) return res.status(400).json({ message: "Username already taken" });

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Update missing fields
        user.userName = userName;
        user.gender = gender;
        user.contact.mobile = mobile;
        user.contact.country = country;
        user.contact.state = state;
        user.contact.district = district;
        user.contact.pinCode = pinCode;
        user.isProfileComplete = true;

        await user.save();

        res.status(200).json({ success: true, message: "Profile completed successfully", user });
    } catch (err) {
        res.status(400).json({ success: false, message: "Error in updating profile" });
    }
});

module.exports = userRouter;
