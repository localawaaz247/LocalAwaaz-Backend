const jwt = require('jsonwebtoken')
const userAuth = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Access token missing' });

        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ message: 'Invalid access token' });
            req.userId = decoded.id;
            next();
        });
    } catch (err) {
        res.status(401).json({ success: false, message: "Unauthorized Access" });
    }
}
module.exports = userAuth