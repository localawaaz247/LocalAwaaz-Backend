const mongoose = require('mongoose');

const tempMediaSchema = new mongoose.Schema({
    uploadToken: { type: String, required: true, index: true },
    url: { type: String, default: null },
    r2Key: { type: String, required: true }, // The unique file name in Cloudflare
    mediaFailed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '24h' } // Automatically deletes this document after 24 hours
});

module.exports = mongoose.model('TempMedia', tempMediaSchema);