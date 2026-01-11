require('dotenv').config()
const express = require('express');
const connectDB = require('../database/connectDB');
const authRouter = require('../routes/authRouter');
const otpRouter = require('../routes/otpRouter');
const cors = require('cors');
const app = express();
const cookieParser = require('cookie-parser');

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use("/", authRouter);
app.use("/", otpRouter);


const startServer = async () => {
    try {
        await connectDB();
        const server = app.listen(process.env.PORT, () => {
            console.log("Server ONLINE");
        })
        server.on("error", (err) => {
            console.error("Server encountered an error:", err.message);
        });
    }
    catch (err) {
        console.log(err.message);
    }

}
startServer();

