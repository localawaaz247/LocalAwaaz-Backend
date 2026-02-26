const adminAuth = async (req, res, next) => {
    try {
        if (req.role !== 'admin') {
            return res.status(403).json(
                {
                    success: false,
                    message: "Admin access denied. Insufficient permissions."
                }
            )
        } else {
            next();
        }
    }
    catch (err) {
        console.log("Server Error in checking admin");
        return res.status(500).json(
            {
                success: false,
                message: "Server Error : adminAuth error occurred"
            }
        )
    }
}
module.exports = adminAuth