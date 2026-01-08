const mongoose = require('mongoose');
const OtpSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    otp: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    isEmailVerified: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); //otp will be removed after some time from db

const OtpModel = mongoose.model("OTP", OtpSchema);
module.exports = OtpModel
