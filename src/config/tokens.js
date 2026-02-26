const jwt = require('jsonwebtoken');

/**
 * ============================
 * JWT TOKEN GENERATORS
 * ============================
 * Purpose:
 * - Generate access and refresh tokens for authenticated users
 * - Keep sensitive user info out of the token (store only userId)
 * - Control token expiration for security
 */

/**
 * Generate Access Token
 * - Short-lived token (15 minutes)
 * - Used to authorize API requests
 * @param {string} userId - MongoDB _id of the user
 * @param {string} role - The user's role (e.g., 'user', 'admin')
 * @returns {string} JWT access token
 */
const generateAccessToken = (userId, role) => {
    return jwt.sign(
        { id: userId, role: role },                        // Payload: minimal info
        process.env.ACCESS_TOKEN_SECRET,        // Secret key from environment
        { expiresIn: '30m' }                    // Token validity
    );
}

/**
 * Generate Refresh Token
 * - Long-lived token (7 days)
 * - Used to generate new access tokens without forcing login
 * @param {string} userId - MongoDB _id of the user
 * @param {string} role - The user's role (e.g., 'user', 'admin')
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (userId, role) => {
    return jwt.sign(
        { id: userId, role: role },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
    );
}

module.exports = { generateAccessToken, generateRefreshToken };

