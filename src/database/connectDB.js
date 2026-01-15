const mongoose = require('mongoose');

/**
 * ============================
 * DATABASE CONNECTION UTILITY
 * ============================
 * Purpose:
 * - Connect to MongoDB using Mongoose
 * - Provide a single function to initialize DB on server startup
 * - Handle connection errors gracefully
 *
 * Usage:
 *   const connectDB = require('./config/db');
 *   connectDB();
 */
const connectDB = async () => {
    try {
        // Connect to MongoDB using the URL in environment variables
        await mongoose.connect(process.env.MONGO_CONNECT_URL);
        console.log("DB is ONLINE"); // Connection successful
    }
    catch (err) {
        // Connection failed
        console.log("DB Connection failed:", err.message);
        // Throw an error so the server startup can handle it
        throw new Error("DB OFFLINE");
    }
}

module.exports = connectDB;
