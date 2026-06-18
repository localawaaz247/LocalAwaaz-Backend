const jwt = require('jsonwebtoken');

const uploadAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: "Unauthorized" });

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: "Forbidden or Token Expired" });

        // Check if it's a normal user OR a temp registration user
        if (decoded.id || decoded.purpose === 'REGISTRATION_UPLOAD') {
            req.userEmail = decoded.email; // Attach info if needed
            return next();
        }

        return res.status(403).json({ message: "Invalid token purpose" });
    });
};

module.exports = uploadAuth;