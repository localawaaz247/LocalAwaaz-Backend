const mongoose = require('mongoose');

const InquirySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'name is required'],
        trim: true
    },
    email: {
        type: String,
        trim: true,
        required: [true, 'email is required'],
        lowercase: true
    },
    message: {
        type: String,
        trim: true,
        required: [true, 'message can\'t be empty']
    },
    status: {
        type: String,
        enum: ['unread', 'read', 'resolved'],
        default: 'unread'
    }
}, { timestamps: true });

module.exports = mongoose.model('Inquiry', InquirySchema);