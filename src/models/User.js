const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    name: {
        type: String
    },
    userName: {
        type: String,
        trim: true,
        unique: [true, "UserName already exists"],
        sparse: true
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
            unique: [true, "Email already exists"],
            lowercase: true
        },
        mobile: {
            type: Number,
            sparse: true, // allows null values
            unique: [true, "Mobile Number already registered"],
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
        city: {
            type: String
        },
        pinCode: {
            type: Number
        },
    },
    googleId: {
        type: String,
        unique: [true, "Needed unique id"],
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