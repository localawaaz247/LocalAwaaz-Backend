const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    name: {
        type: String
    },
    userId: {
        type: String,
        unique: true,
        required: true
    },
    password: {
        type: String
    },
    gender: {
        type: String,
        enum: ["male", "female", "other"]
    },
    email: {
        type: String,
        unique: true
    },
    mobile: {
        type: Number,
        unique: true,
        sparse: true,    // allows null values
        default: null
    },
    profilePic: {
        type: String
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    country: {
        type: String,
        required: true
    },
    state: {
        type: String,
        required: true
    },
    district: {
        type: String,
        required: true
    },
    pinCode: {
        type: Number,
        required: true
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    }
},
    {
        timestamps: true
    });
const User = mongoose.model('User', userSchema);
module.exports = User;