const User = require("../models/User");

const statusAuth = async (req, res, next) => {
    try {
        const { userId } = req;

        // Fallback in case this is accidentally placed before userAuth
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized Access: Token missing or invalid"
            });
        }
        const record = await User.findById(userId).select("accountStatus");
        if (!record) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized Access: User not found"
            });
        }
        if (record.accountStatus === 'BANNED' || record.accountStatus === 'SUSPENDED') {

            // Instantly drop their real-time socket connection if they are currently online
            const io = req.app.get('io');
            if (io) {
                io.in(userId.toString()).disconnectSockets(true);
            }

            return res.status(403).json({
                success: false,
                message: `Account ${record.accountStatus.toLowerCase()}. Contact administrator first.`
            });
        }
        next();
    }
    catch (err) {
        console.error("Status check error:", err);
        return res.status(500).json({
            success: false,
            message: "Error in checking account status"
        });
    }
};

module.exports = statusAuth;