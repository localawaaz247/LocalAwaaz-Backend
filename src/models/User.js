const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    mobile: {
        type: String,
        unique: true,
        sparse: true // allows null values
    },
    otp: {
        type: String
    },
    email: {
        type: String,
        unique: true
    },
    password: {
        type: String
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    name: {
        type: String
    },
    profilePic: {
        type: String
    },
    gender: {
        type: String,
        enum: ["male", "female", "other"]
    },
    country: {
        type: String
    },
    state: {
        type: String
    },
    pinCode: {
        type: Number
    }
},
    {
        timestamps: true
    });
const User = mongoose.model('User', userSchema);
module.exports = User;