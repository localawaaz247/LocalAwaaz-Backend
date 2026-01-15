const User = require("../models/User");

/**
 * ============================
 * UNIQUENESS CHECK UTILITY
 * ============================
 * Used during:
 * - User registration
 * - Profile completion / updates
 *
 * Responsibility:
 * - Ensure username, email, and mobile are unique
 * - Validate mobile length
 *
 * Design choice:
 * - This function THROWS errors
 * - Caller must handle errors via try/catch
 */
const checkUniqueness = async (req) => {
    try {
        const { userName, email, mobile } = req.body;

        /**
         * ----------------------------
         * USERNAME UNIQUENESS CHECK
         * ----------------------------
         */
        if (userName) {
            const record = await User.findOne({ userName });
            if (record) {
                throw new Error("Username already taken");
            }
        }

        /**
         * ----------------------------
         * EMAIL UNIQUENESS CHECK
         * ----------------------------
         * Email is stored inside contact object
         */
        if (email) {
            const record = await User.findOne({ "contact.email": email });
            if (record) {
                throw new Error("Email is already registered");
            }
        }

        /**
         * ----------------------------
         * MOBILE UNIQUENESS CHECK
         * ----------------------------
         * Mobile is stored inside contact object
         */
        if (mobile) {
            const record = await User.findOne({ "contact.mobile": mobile });
            if (record) {
                throw new Error("Mobile number is already registered");
            }
        }

        /**
         * ----------------------------
         * MOBILE FORMAT VALIDATION
         * ----------------------------
         * Ensures mobile number is exactly 10 digits
         */
        if (mobile && mobile.toString().length !== 10) {
            throw new Error("Mobile must be of 10 digits");
        }
    }
    catch (err) {
        /**
         * IMPORTANT:
         * This catch block overrides the original error message.
         * Useful for generic error handling,
         * but it hides the exact validation failure reason.
         */
        throw new Error("Error occured in checking Uniqueness");
    }
};

module.exports = checkUniqueness;
