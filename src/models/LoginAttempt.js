const mongoose = require('mongoose');
const LoginAttemptSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    failedAttempts: {
        type: Number,
        default: 0
    },
    lastAttempt: {
        type: Date,
        default: Date.now()
    },
    lockUntil: {
        type: Date
    }
});

const LoginAttempt = mongoose.model('LoginAttempt', LoginAttemptSchema);
module.exports = LoginAttempt