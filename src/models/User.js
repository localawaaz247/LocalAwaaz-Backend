const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    name: {
        type: String
    },
    userName: {
        type: String,
        required: [true, "userName is required"],
        trim: true,
        unique: true
    },
    password: {
        type: String
    },
    gender: {
        type: String,
        enum: {
            values: ["male", "female", "other"],
            message: "Gender must be male, female, or other"
        }
    },
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
        sparse: true,    // allows null values
        default: null,
        unique: true,
        validate: {
            validator: v => v === null || v.toString().length === 10,
            message: "Mobile number must be 10 digits"
        }
    },
    profilePic: {
        type: String
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    country: {
        type: String,
        required: [true, 'Country is Required']
    },
    state: {
        type: String,
        required: [true, "State is Required"]
    },
    district: {
        type: String,
        required: [true, "District is Required"]
    },
    pinCode: {
        type: Number,
        required: [true, "pinCode is Required"],
        validate: {
            validator: v => v.toString().length === 6,
            message: "PinCode must be of 6 digits"
        }
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