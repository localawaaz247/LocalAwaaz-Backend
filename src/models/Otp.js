const mongoose = require('mongoose');

/**
 * ============================
 * OTP SCHEMA
 * ============================
 * Purpose:
 * - Store OTPs for email verification or login
 * - Track verification status, attempts, and expiry
 * - Support throttling / blocking to prevent abuse
 */
const OtpSchema = new mongoose.Schema({

    /**
     * Email:
     * - Required because OTP is always linked to an email
     * - Unique to prevent multiple concurrent OTPs for the same email
     */
    email: {
        type: String,
        required: true,
        unique: [true, "OTP already sent to this email"]
    },

    /**
     * Optional username:
     * - Only set when OTP is for a logged-in user
     * - Sparse index allows null values
     */
    userName: {
        type: String,
        default: null,
        sparse: true
    },

    /**
     * OTP value:
     * - Stored as hashed string for security
     * - Required
     */
    otp: {
        type: String,
        required: true
    },

    /**
     * Verification flag:
     * - True if user successfully verified OTP
     */
    isVerified: {
        type: Boolean,
        default: false
    },

    /**
     * Number of attempts:
     * - Helps implement throttling / rate limiting
     */
    attempts: {
        type: Number,
        default: 0
    },

    /**
     * Timestamp of last OTP sent:
     * - Useful for resend logic and rate-limiting
     */
    lastSent: {
        type: Date
    },

    /**
     * Block until timestamp:
     * - Used to temporarily block OTP requests after too many failed attempts
     */
    blockUntil: {
        type: Date
    },

    /**
     * OTP expiry timestamp:
     * - Required
     * - TTL index will auto-remove document after expiry
     */
    expiresAt: {
        type: Date,
        required: true
    }

}, {
    // Automatically add createdAt & updatedAt timestamps
    timestamps: true
});

/**
 * TTL INDEX:
 * - Automatically deletes OTP documents when expiresAt < current time
 * - expireAfterSeconds: 0 → deletes immediately after expiry
 */
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OtpModel = mongoose.model("OTP", OtpSchema);
module.exports = OtpModel;
