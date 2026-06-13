const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
    identifier: {
        type: String,
        default: 'global_count',
        unique: true
    },
    count: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Visitor', visitorSchema);