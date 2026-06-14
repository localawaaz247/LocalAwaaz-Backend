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
            required: [true, 'Pincode is required'],
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
            confirmedAt: { type: Date, default: Date.now }
        }
    ],
    status: {
        type: String,
        enum: ["OPEN", "LOCKED", "RESOLVED", "FAILED", "DISPUTED", "RELEASED"],
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
        // Automatically set to 24 hours after Issue creation
        windowEndsAt: { type: Date },

        // Array of all bids placed on this issue
        bids: [{
            authorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            proposedTimeHours: { type: Number, required: true },
            timestamp: { type: Date, default: Date.now }
        }],

        // The winner of the bid (who locked it)
        winningBid: {
            authorityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            commitmentTimeHours: { type: Number },
            acceptedAt: { type: Date }
        }
    },

    /**
     * ============================
     * THE WORK CYCLE & EXTENSIONS
     * ============================
     */
    workCycle: {
        // Calculate as: acceptedAt + commitmentTimeHours
        commitmentDeadline: { type: Date },

        extensionRequests: [{
            hoursRequested: { type: Number, required: true, max: 24 }, // Max 24h as discussed
            reason: { type: String, required: true },
            requestedAt: { type: Date, default: Date.now },
            status: { type: String, enum: ['PENDING', 'APPROVED'], default: 'APPROVED' } // Auto-approved up to 24h
        }],

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

//Essential GeoSpatial Index
issueModel.index({ 'location.geoData': '2dsphere' });
// Optimized for finding issues by status within a city (e.g., "Open issues in Mumbai")
issueModel.index({ 'location.city': 1, status: 1 });
issueModel.index({ 'location.pinCode': 1, status: 1 });
issueModel.index({ 'title': 'text' });

// Find issues that are OPEN and the bidding window has expired (For Auto-Dispute)
issueModel.index({ status: 1, 'bidding.windowEndsAt': 1 });

// Find issues that are LOCKED and the deadline has passed (For Auto-Fail)
issueModel.index({ status: 1, 'workCycle.commitmentDeadline': 1 });

const Issue = mongoose.model('Issue', issueModel);

module.exports = Issue;