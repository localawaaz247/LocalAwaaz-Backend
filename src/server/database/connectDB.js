const mongoose = require('mongoose');
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_CONNECT_URL);
        console.log("DB is ONLINE");
    }
    catch (err) {
        console.log("DB Connection failed:", err.message)
        throw new Error("DB OFFLINE")
    }
}
module.exports = connectDB