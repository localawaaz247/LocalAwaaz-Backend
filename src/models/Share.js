const mongoose = require('mongoose');

// Schema to temporarily log when a user shares an issue
// This is mainly used for share-throttling (cooldown control)
const shareLogSchema = new mongoose.Schema({
    // Reference to the user who shared
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Reference to the issue being shared
    issueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Issue',
        required: true
    },

    // Time when the issue was shared
    // `expires: 200` creates a TTL index:
    // MongoDB will automatically delete this document
    // 200 seconds after `sharedAt`
    // This removes the need for manual cleanup logic
    sharedAt: {
        type: Date,
        default: Date.now,
        expires: 60
    }
}, {
    // Automatically adds createdAt and updatedAt fields
    timestamps: true
});

// Unique compound index to ensure:
// A user can share a specific issue only once
// within the TTL window
// If a duplicate share happens, MongoDB throws E11000
// which can be treated as "share throttled"
shareLogSchema.index(
    { userId: 1, issueId: 1 },
    { unique: true }
);

// Share model representing temporary share logs
const Share = mongoose.model('Share', shareLogSchema);

module.exports = Share;
