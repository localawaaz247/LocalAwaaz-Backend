const mongoose = require('mongoose');

const otaUpdateSchema = new mongoose.Schema({
    version: {
        type: String,
        required: true,
        unique: true // e.g., "1.0.1"
    },
    url: {
        type: String,
        required: true // The R2 download link
    },
    isMandatory: {
        type: Boolean,
        default: true
    },
    releaseNotes: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('OtaUpdate', otaUpdateSchema);