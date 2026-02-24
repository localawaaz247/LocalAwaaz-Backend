const mongoose = require('mongoose');

const tempMediaSchema = new mongoose.Schema({
    // uploadToken: { type: String, required: true, index: true },
    url: { type: String, default: null },
    r2Key: { type: String, required: true }, // The unique file name in Cloudflare
    createdAt: { type: Date, default: Date.now }
    // mediaFailed: { type: Boolean, default: false },
});

module.exports = mongoose.model('TempMedia', tempMediaSchema);