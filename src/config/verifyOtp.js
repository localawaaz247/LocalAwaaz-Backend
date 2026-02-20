// verifyOtp.js
const OtpModel = require("../models/Otp");
const bcrypt = require('bcrypt');

const verifyOtp = async (email, enteredOtp, purpose, userName) => {
    const record = await OtpModel.findOne({ email, purpose });
    if (!record) throw new Error("No OTP request found. Please request a new one.");
    
    // Optional: Only check userName if it was provided (useful for Registration)
    if (userName && record.userName !== userName) {
        throw new Error("This email verification belongs to a different username.");
    }

    if (Date.now() >= record.expiresAt.getTime()) throw new Error("OTP has expired.");
    if (record.attempts >= 5) throw new Error("Too many attempts! Try again after some time.");

    const isMatch = await bcrypt.compare(enteredOtp.toString(), record.otp);
    if (!isMatch) {
        record.attempts += 1;
        await record.save();
        throw new Error("Invalid OTP entered");
    }

    record.isVerified = true;
    await record.save();
    return record; // Return the record in case the route needs the ID
};

module.exports = verifyOtp;