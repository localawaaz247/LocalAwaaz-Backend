const mongoose = require('mongoose');

/**
 * ============================
 * LOGIN ATTEMPT SCHEMA
 * ============================
 * Purpose:
 * - Track failed login attempts for each user
 * - Implement throttling and temporary lockouts to prevent brute-force attacks
 * - Works with both local auth and OAuth users
 */
const LoginAttemptSchema = new mongoose.Schema({

    /**
     * User reference:
     * - Links login attempt to a specific user
     * - Uses ObjectId referencing the User model
     */
    userId: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },

    /**
     * Failed attempts counter:
     * - Incremented each time a user enters a wrong password
     * - Reset on successful login
     */
    failedAttempts: {
        type: Number,
        default: 0
    },

    /**
     * Timestamp of the last login attempt:
     * - Useful to implement rolling counters or time-based resets
     */
    lastAttempt: {
        type: Date,
        default: Date.now()
    },

    /**
     * Lock until timestamp:
     * - If user exceeds allowed failed attempts, set a lock period
     * - User cannot attempt login until this time passes
     */
    lockUntil: {
        type: Date
    }

}, {
    // Automatically adds createdAt & updatedAt timestamps
    timestamps: true
});

const LoginAttempt = mongoose.model('LoginAttempt', LoginAttemptSchema);
module.exports = LoginAttempt;
