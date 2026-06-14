const authorityAuth = async (req, res, next) => {
    try {
        if (!['official', 'ngo'].includes(req.role)) {
            return res.status(403).json({
                success: false,
                message: "Authority access denied. Only verified NGOs or Officials can perform this action."
            });
        }
        next();
    } catch (err) {
        console.error("Server Error in checking authority");
        return res.status(500).json({
            success: false,
            message: "Server Error: authorityAuth error occurred"
        });
    }
}

module.exports = authorityAuth;