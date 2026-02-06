const mongoose = require('mongoose');

/**
 * ============================
 * USER SCHEMA
 * ============================
 * Supports:
 * - Local authentication
 * - Google OAuth
 * - Optional email & mobile
 * - Incremental profile completion
 */
const userSchema = new mongoose.Schema({

    /**
     * ----------------------------
     * BASIC USER INFO
     * ----------------------------
     */
    name: {
        type: String
    },

    /**
     * Username:
     * - Unique identifier
     * - Can be null initially (OAuth flow)
     * - Sparse index prevents duplicate null conflicts
     */
    userName: {
        type: String,
        trim: true,
        unique: [true, "UserName already exists"],
        sparse: true
    },

    /**
     * Password:
     * - Stored as hashed value
     * - May be null for OAuth users
     */
    password: {
        type: String
    },

    /**
     * Role:
     * - Default role is "user"
     * - Can be extended for admin/moderator
     */
    role: {
        type: String,
        default: "user"
    },

    /**
     * Gender:
     * - Optional
     * - Restricted to predefined values
     */
    gender: {
        type: String,
        enum: {
            values: ["male", "female", "other"],
            message: "Gender must be male, female, or other"
        }
    },

    /**
     * Profile picture URL
     */
    profilePic: {
        type: String
    },
    bio: {
        type: String,
        default: 'Active Citizen'
    },
    /**
     * Email verification status
     */
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    civilScore: {
        type: Number,
        default: 10
    },
    issuesReported: {
        type: Number,
        default: 0
    },
    issuesResolved: {
        type: Number,
        default: 0
    },
    issuesConfirmed: {
        type: Number,
        default: 0
    },
    issuesFlagged: {
        type: Number,
        default: 0
    },
    /**
     * ----------------------------
     * CONTACT INFORMATION
     * ----------------------------
     * Kept inside a nested object
     * to logically group related fields.
     */
    contact: {

        /**
         * Email:
         * - Optional (OAuth users may not provide immediately)
         * - Unique across users
         * - Sparse index allows multiple null values
         * - Stored in lowercase to avoid duplicates
         */
        email: {
            type: String,
            default: null,
            trim: true,
            required: [true, 'Email id is required'],
            unique: [true, "Email already exists"],
            lowercase: true
        },

        /**
         * Mobile number:
         * - Optional
         * - Unique when provided
         * - Sparse index allows null values
         * - Validated to be exactly 10 digits
         */
        // mobile: {
        //     type: Number,
        //     sparse: true,
        //     unique: [true, "Mobile Number already registered"],
        //     validate: {
        //         validator: v => v === null || v.toString().length === 10,
        //         message: "Mobile number must be 10 digits"
        //     }
        // },

        /**
         * Address information
         */
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
            type: String
        },
    },

    /**
     * Google OAuth ID:
     * - Present only for Google-auth users
     * - Must be unique
     * - Sparse allows users without Google login
     */
    googleId: {
        type: String,
        unique: [true, "Needed unique id"],
        sparse: true
    },

    /**
     * Profile completion flag:
     * - Used to restrict access to features
     * - Especially important for OAuth users
     */
    isProfileComplete: {
        type: Boolean,
        default: false
    }
},
    {
        // Automatically adds createdAt & updatedAt
        timestamps: true
    });

const User = mongoose.model('User', userSchema);
module.exports = User;
