const OtpModel = require("../models/OtpModel");
const bcrypt = require('bcrypt');

const verifyOtp = async (email, enteredOtp, purpose, userName) => {
    const record = await OtpModel.findOne({ email, purpose });
    if (!record) throw new Error("No OTP request found. Please request a new one.");

    // Optional: Only check userName if it was provided
    if (userName && record.userName !== userName) {
        throw new Error("This email verification belongs to a different username.");
    }

    if (Date.now() >= record.expiresAt.getTime()) throw new Error("OTP has expired.");
    if (record.attempts >= 5) throw new Error("Too many attempts! Try again after some time.");

    const isMatch = await bcrypt.compare(enteredOtp.toString(), record.otp);

    if (record.blockUntil && Date.now() < record.blockUntil.getTime()) {
        throw new Error("Too many failed attempts. You are temporarily blocked.");
    }

    if (!isMatch) {
        record.attempts += 1;
        await record.save();
        throw new Error("Invalid OTP entered");
    }

    // SECURITY TWEAK: Nullify the OTP so it can never be verified twice
    record.otp = null;
    record.isVerified = true;
    await record.save();

    return record;
};

module.exports = verifyOtp;