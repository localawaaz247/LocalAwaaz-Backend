const express = require('express');
const connectDB = require('../database/connectDB');
const userRouter = require('../routes/userRouter');
require('dotenv').config()
const app = express();
app.use(express.json());

app.use("/", userRouter);

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

