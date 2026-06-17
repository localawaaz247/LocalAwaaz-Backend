const User = require('../models/User');

const authorityAuth = async (req, res, next) => {
    try {
        // 1. Fetch the full user from the database
        const user = await User.findById(req.userId);

        // 2. Check if they exist and have the correct role
        if (!user || !['official', 'ngo'].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: "Authority access denied. Only verified NGOs or Officials can perform this action."
            });
        }

        // 3. Check if the Admin has actually APPROVED them
        if (user.authorityProfile?.verificationStatus !== 'APPROVED') {
            return res.status(403).json({
                success: false,
                message: "Account restricted. Your authority status is pending admin approval."
            });
        }

        // 4. CRITICAL: Attach the user to the request so the router can read their district!
        req.authorityUser = user;

        next();
    } catch (err) {
        console.error("Server Error in checking authority", err);
        return res.status(500).json({
            success: false,
            message: "Server Error: authorityAuth error occurred"
        });
    }
}

module.exports = authorityAuth;