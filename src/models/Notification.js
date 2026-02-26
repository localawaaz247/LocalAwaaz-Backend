// models/Notification.js
const mongoose = require('mongoose');

const Notification = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // The person who triggered the action
    },
    issue: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Issue',
    },
    type: {
        type: String,
        // These are the specific, high-priority events you defined
        enum: ['NEW_COMMENT', 'COMMENT_REPLY', 'ISSUE_CONFIRMED', 'ISSUE_RESOLVED', 'ISSUE_IN_REVIEW', 'ISSUE_REJECTED'],
        required: true
    },
    message: {
        type: String,
        required: true
    },
    isRead: {
        type: Boolean,
        default: false // Turns true when they open the notification dropdown
    }
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

module.exports = mongoose.model('Notification', Notification);