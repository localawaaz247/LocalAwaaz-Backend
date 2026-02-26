const jwt = require('jsonwebtoken');

/**
 * ============================
 * USER AUTH MIDDLEWARE
 * ============================
 * Purpose:
 * - Protect routes by verifying JWT access tokens
 * - Attach userId to req for downstream use
 *
 * Usage:
 * - Add to routes that require authentication
 *   Example:
 *     router.get("/dashboard", userAuth, dashboardController)
 */
const userAuth = (req, res, next) => {
    try {
        // Extract token from Authorization header (Bearer <token>)
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Get token after "Bearer "

        // If token missing, reject request
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token missing'
            });
        }

        // Verify JWT token
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
            if (err) {
                // Token invalid or expired
                return res.status(403).json({
                    success: false,
                    message: 'Invalid access token'
                });
            }

            // Token valid → attach userId to request for use in downstream middleware/controllers
            req.userId = decoded.id;
            req.role = decoded.role;

            // Proceed to next middleware/controller
            next();
        });

    } catch (err) {
        // Catch any unexpected errors
        res.status(401).json({
            success: false,
            message: "Unauthorized Access"
        });
    }
};

module.exports = userAuth;
