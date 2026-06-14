// models/AppRelease.js
const mongoose = require('mongoose');

const appReleaseSchema = new mongoose.Schema({
    versionName: { type: String, required: true }, // e.g., "1.0.5"
    versionCode: { type: Number, required: true }, // e.g., 5 (Important for Android comparisons)
    downloadUrl: { type: String, required: true }, // The Cloudflare R2 public URL
    fileSize: { type: String }, // e.g., "24.5 MB" - Good for UX
    releaseNotes: { type: String }, // e.g., "Fixed FCM push notifications"
    isMandatory: { type: Boolean, default: false }, // For future "Force Update" feature
    isActive: { type: Boolean, default: true } // Toggle to quickly rollback a bad version
}, { timestamps: true });

module.exports = mongoose.model('AppRelease', appReleaseSchema);