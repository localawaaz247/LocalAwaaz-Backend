const mongoose = require('mongoose');

const tempMediaSchema = new mongoose.Schema({
    r2Key: { type: String, required: true }, // The unique file name in Cloudflare
    createdAt: { type: Date, default: Date.now, expires: '24h' } // Automatically deletes this document after 24 hours
});

module.exports = mongoose.model('TempMedia', tempMediaSchema);