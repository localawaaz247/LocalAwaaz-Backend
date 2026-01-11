const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    name: {
        type: String
    },
    userName: {
        type: String,
        trim: true,
        unique: true,
        sparse: true,
        lowercase: true
    },
    password: {
        type: String
    },
    role: {
        type: String,
        default: "user"
    },
    gender: {
        type: String,
        enum: {
            values: ["male", "female", "other"],
            message: "Gender must be male, female, or other"
        }
    },
    profilePic: {
        type: String
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    contact: {
        email: {
            type: String,
            default: null,
            trim: true,
            sparse: true,
            unique: true,
            lowercase: true
        },
        mobile: {
            type: Number,
            sparse: true, // allows null values
            default: null,
            unique: true,
            validate: {
                validator: v => v === null || v.toString().length === 10,
                message: "Mobile number must be 10 digits"
            }
        },
        country: {
            type: String
        },
        state: {
            type: String
        },
        district: {
            type: String
        },
        pinCode: {
            type: Number
        },
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    isProfileComplete: {
        type: Boolean,
        default: false
    }
},
    {
        timestamps: true
    });
const User = mongoose.model('User', userSchema);
module.exports = User;