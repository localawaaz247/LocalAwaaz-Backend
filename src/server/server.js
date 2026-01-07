const express = require('express');
require('dotenv').config()
const connectDB = require('./database/connectDB');
const app = express();
app.use("/", (req, res) => {
    res.send("hello");
})


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

