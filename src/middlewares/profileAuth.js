const User = require("../models/User");

const profileAuth = async (req, res, next) => {
    try {
        const { userId } = req;
        const record = await User.findOne({ _id: userId }).select("isProfileComplete");
        if (!record) {
            return res.status(401).json({ success: false, message: "Unauthorized Access" });
        }
        if (!record.isProfileComplete) {
            return res.status(403).json({ success: false, message: "Complete your profile first!!" });
        }
        next();
    }
    catch (err) {
        return res.status(500).json({ success: false, message: "Error in checking profile" });
    }
}
module.exports = profileAuth