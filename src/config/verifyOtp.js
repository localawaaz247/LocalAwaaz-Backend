const OtpModel = require("../models/Otp");
const bcrypt = require('bcrypt');

/**
 * ============================
 * VERIFY OTP UTILITY
 * ============================
 * Purpose:
 * - Verify a user's OTP for email authentication
 * - Handles expiration, attempt limits, and marking verified
 * - Returns true if OTP is correct
 *
 * @param {string} email - User's email
 * @param {string} enteredOtp - OTP entered by the user
 */
const verifyOtp = async (email, enteredOtp) => {
    // Find OTP record for this email
    const record = await OtpModel.findOne({ email });
    if (!record) {
        throw new Error("No OTP with this email exists");
    }

    const { otp, attempts, expiresAt } = record;

    // Check if OTP has expired
    if (Date.now() >= expiresAt.getTime()) {
        throw new Error("OTP expired");
    }

    // Check if attempts limit exceeded (throttling)
    if (attempts >= 5) {
        throw new Error("Too many attempts! Try again after some time");
    }

    // Compare entered OTP with stored hashed OTP
    const isMatch = await bcrypt.compare(enteredOtp, otp);
    if (!isMatch) {
        // Increment attempts on wrong OTP
        record.attempts += 1;
        await record.save();
        throw new Error("Wrong OTP entered");
    }

    // OTP correct → mark as verified
    record.isVerified = true;

    // Optionally refresh OTP expiration after successful verification
    record.expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await record.save();

    return true; // OTP verified successfully
};

module.exports = verifyOtp;
