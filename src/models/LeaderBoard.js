const mongoose = require('mongoose');

const leaderboardSchema = new mongoose.Schema({
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    type: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true },

    citizens: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rank: Number,
        csi: Number,
        activeScore: Number,
        isHero: { type: Boolean, default: false }
    }],

    authorities: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rank: Number,
        csi: Number,
        activeScore: Number,
        isHero: { type: Boolean, default: false }
    }]
}, { timestamps: true });

module.exports = mongoose.model('LeaderBoard', leaderboardSchema);