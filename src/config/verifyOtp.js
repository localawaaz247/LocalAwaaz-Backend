const OtpModel = require("../models/Otp");
const bcrypt = require('bcrypt')
const verifyOtp = async (email, enteredOtp) => {
    const record = await OtpModel.findOne({ email });
    if (!record) {
        throw new Error("No OTP with this email exists");
    }
    const { otp, attempts, expiresAt } = record;
    if (Date.now() >= expiresAt.getTime()) {
        throw new Error("OTP expired");
    }
    if (attempts >= 5) {
        throw new Error("Maximum attempts reached! Try again after some time");
    }
    const isMatch = await bcrypt.compare(enteredOtp, otp);
    if (!isMatch) {
        record.attempts += 1;
        await record.save();
        throw new Error("Wrong OTP entered");
    }
    record.isVerified = true;
    record.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await record.save();
    return true;
}

module.exports = verifyOtp
