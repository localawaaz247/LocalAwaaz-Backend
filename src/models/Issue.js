const mongoose = require('mongoose');

const issueModel = new mongoose.Schema({
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: [true, "userid is required"],
        ref: 'User',
        index: true
    },
    title: {
        type: String,
        trim: true,
        required: [true, 'title is required']
    },
    category: {
        type: String,
        enum: ["ROAD", "WATER", "ELECTRICITY", "SANITATION", "SAFETY", "OTHER"],
        required: [true, 'category is required'],
        uppercase: true,
        index: true
    },
    description: {
        type: String,
        trim: true,
        required: [true, 'description is required']
    },
    location: {
        country: { type: String, default: "India" },
        state: String,
        city: String,
        pincode: String,

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
    upVotesCount: {
        type: Number,
        default: 0,
        min: 0
    },
    priority: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        default: 'LOW'
    },
    isPublic: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true }
});

//Essential GeoSpatial Index
issueModel.index({ 'location.geoData': '2dsphere' });

const Issue = mongoose.model('Issue', issueModel);

module.exports = Issue;