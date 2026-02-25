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
        enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"],
        default: "OPEN",
        required: true,
        index: true
    },
    statusHistory: [
        {
            status: String,
            changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            changedAt: { type: Date, default: Date.now },
            note: String
        }
    ],
    media: [
        {
            url: String,
            uploadedAt: { type: Date, default: Date.now }
        }
    ],
    // uploadToken: { type: String, index: true, default: null },
    // mediaProcessing: { type: Boolean, default: false },
    // mediaFailed: { type: Boolean, default: false },
    priority: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        default: 'LOW'
    },
    impactScore: {
        type: Number,
        default: 10
    },
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

const Issue = mongoose.model('Issue', issueModel);

module.exports = Issue;