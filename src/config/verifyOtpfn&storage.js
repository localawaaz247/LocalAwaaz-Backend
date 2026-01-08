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
    if (!bcrypt.compare(record.otp, enteredOtp)) {
        record.attempts += 1;
        await record.save();
        throw new Error("Wrong OTP entered");
    }
    await OtpModel.deleteOne({ email });
    return true;
}

module.exports = verifyOtp
