const User = require("../models/User");

/**
 * ============================
 * PROFILE COMPLETION MIDDLEWARE
 * ============================
 * Ensures that:
 * - User is authenticated (userId exists)
 * - User has completed their profile
 *
 * This middleware is typically used to:
 * - Restrict access to core features
 * - Force profile completion after OAuth signup
 */
const profileAuth = async (req, res, next) => {
    try {
        const { userId } = req;

        /**
         * Fetch only what is needed for this check
         * to keep the query lightweight.
         */
        const record = await User.findOne({ _id: userId })
            .select("isProfileComplete");

        // If user does not exist, treat as unauthorized
        if (!record) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized Access"
            });
        }

        /**
         * If profile is incomplete,
         * block access to protected routes.
         */
        if (!record.isProfileComplete) {
            return res.status(403).json({
                success: false,
                message: "Complete your profile first!!"
            });
        }

        // Profile is complete → allow request to continue
        next();
    }
    catch (err) {
        return res.status(500).json({
            success: false,
            message: "Error in checking profile"
        });
    }
};

module.exports = profileAuth;
