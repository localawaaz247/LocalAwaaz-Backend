const mongoose = require('mongoose');

const issueModel = new mongoose.Schema({
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: [true, "userid is required"],
        ref: 'User',
        index: true
    },
    isAnonymous: {
        type: Boolean,
        default: false,
    },
    title: {
        type: String,
        trim: true,
        required: [true, 'title is required']
    },
    category: {
        type: String,
        required: [true, 'category is required'],
        uppercase: true,
        index: true
    },
    subCategory: {
        type: String,
        default: null,
        uppercase: true,
        index: true
    },
    description: {
        type: String,
        trim: true,
        required: [true, 'description is required']
    },
    location: {
        address: {
            type: String,
            default: 'Anonymous location',
        },
        city: {
            type: String,
            trim: true,
            required: [true, 'City is required'],
            index: true
        },
        pinCode: {
            type: String,
            trim: true,
            index: true
        },
        state: {
            type: String,
            trim: true
        },
        district: {
            type: String,
            trim: true,
            required: [true, 'District is required for authority routing'],
            index: true
        },
        //2d sphere indexing
        geoData: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], //longitude, latitude
                required: true,
            }
        }
    },
    confirmations: [
        {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            confirmedAt: { type: Date, default: Date.now },
            // NEW: Tracking their verification vote & counter-proof photo
            verdict: { type: String, enum: ['PENDING', 'APPROVED', 'OPPOSED'], default: 'PENDING' },
            verdictMedia: { type: String, default: null }
        }
    ],
    reportedByVerdict: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'OPPOSED'],
        default: 'PENDING'
    },
    reportedByVerdictMedia: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ["OPEN", "LOCKED", "PENDING_EXTENSION", "AWAITING_HANDOVER", "RESOLVED", "FAILED", "DISPUTED", "RELEASED", "ORPHANED"],
        default: "OPEN",
        required: true,
        index: true
    },
    statusHistory: [
        {
            status: String,
            changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            changedAt: { type: Date, default: Date.now },
            remark: String
        }
    ],
    media: [
        {
            url: String,
            uploadedAt: { type: Date, default: Date.now }
        }
    ],

    disputeEvidence: {
        mediaUrl: { type: String, default: null },
        adminRemark: { type: String },
        disputedAt: { type: Date }
    },
    // --- NEW: Added thumbnails array ---
    thumbnails: [{
        type: String
    }],
    priority: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        default: 'LOW'
    },
    impactScore: {
        type: Number,
        default: 10
    },
    adminRemark: {
        type: String
    },
    /**
     * ============================
     * THE BIDDING MARKETPLACE
     * ============================
     */
    bidding: {
        auctionStartsAt: { type: Date }, // Triggered on 1st bid
        auctionEndsAt: { type: Date },   // Exactly 24h after auctionStartsAt

        bids: [{
            authorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            proposedTimeValue: { type: Number, required: true }, // e.g., 24
            proposedTimeUnit: { type: String, enum: ['HOURS', 'DAYS', 'WEEKS', 'MONTHS'], required: true }, // e.g., DAYS
            proposedTimeInHours: { type: Number, required: true }, // Normalized for easy DB sorting
            timestamp: { type: Date, default: Date.now }
        }],

        winningBid: {
            authorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            commitmentTimeHours: { type: Number },
            acceptedAt: { type: Date }
        }
    },

    /**
     * ============================
     * THE WORK CYCLE & HANDOVERS
     * ============================
     */
    workCycle: {
        commitmentDeadline: { type: Date },

        // 🟢 NEW: For pausing the clock during Extension Requests
        isClockPaused: { type: Boolean, default: false },
        pausedAt: { type: Date },

        extensionRequests: [{
            requestedTimeValue: { type: Number, required: true },
            requestedTimeUnit: { type: String, enum: ['HOURS', 'DAYS', 'WEEKS', 'MONTHS'], required: true },
            hoursRequested: { type: Number, required: true }, // Normalized
            reason: { type: String, required: true },
            requestedAt: { type: Date, default: Date.now },
            status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
            adminRemark: { type: String }
        }],

        // 🟢 NEW: The Ghost Protocol Timer
        ghostTimerExpiresAt: { type: Date },

        // 🟢 NEW: Mandatory Proof of Partial Work
        handoverReports: [{
            authorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            completionPercentage: { type: Number, min: 0, max: 100, required: true },
            photoUrl: { type: String, required: true },
            reasonForFailure: { type: String },
            createdAt: { type: Date, default: Date.now }
        }],

        // 🟢 NEW: CSI Verification Escrow
        escrow: {
            isEscrowActive: { type: Boolean, default: false },
            pointsHolding: { type: Number, default: 0 },
            citizenVerdict: { type: String, enum: ['PENDING', 'ACCEPTED', 'OPPOSED'], default: 'PENDING' },
            autoReleaseAt: { type: Date } // 72 hours after marked resolved
        },

        // If they release/abandon the job
        releaseApology: { type: String },

        // The ultimate verdict by the citizen
        finalVerdict: { type: String, enum: ['PENDING', 'CONFIRMED', 'OPPOSED'], default: 'PENDING' }
    },

    /**
     * Audit Log (In addition to your statusHistory)
     * Tracks non-status events like "Bid Placed", "Extension Requested", "Override by Admin"
     */
    auditLog: [{
        action: { type: String, required: true },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        timestamp: { type: Date, default: Date.now },
        details: { type: String } // e.g., "Bid 24 hours", "Extended by 6 hours"
    }],

    flags: [
        {
            flagReason: String,
            flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            createdAt: { type: Date, default: Date.now }
        },
    ],
    flagCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    confirmationCount: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true }
},
    { timestamps: true });

// Essential GeoSpatial Index
issueModel.index({ 'location.geoData': '2dsphere' });

// Optimized for finding issues by status within a city (e.g., "Open issues in Mumbai")
issueModel.index({ 'location.city': 1, status: 1 });
issueModel.index({ 'location.pinCode': 1, status: 1 });
issueModel.index({ 'title': 'text' });

// 🟢 CRITICAL CRON INDEXES: Optimized for our auto-state-machine background workers
issueModel.index({ status: 1, 'bidding.auctionEndsAt': 1 });
issueModel.index({ status: 1, 'workCycle.commitmentDeadline': 1 });
issueModel.index({ status: 1, 'workCycle.ghostTimerExpiresAt': 1 });
issueModel.index({ 'workCycle.escrow.isEscrowActive': 1, 'workCycle.escrow.autoReleaseAt': 1 });

const Issue = mongoose.model('Issue', issueModel);

module.exports = Issue;