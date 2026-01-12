require('dotenv').config()
const express = require('express');
const connectDB = require('../database/connectDB');
const authRouter = require('../routes/authRouter');
const otpRouter = require('../routes/otpRouter');
const app = express();
const cookieParser = require('cookie-parser');
const session = require("express-session");
const passport = require("../config/passport");
const userRouter = require('../routes/userRouter')

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);

app.use(passport.initialize());
app.use(passport.session());


app.use(express.json());
app.use(cookieParser());


app.use("/", authRouter);
app.use("/", otpRouter);
app.use('/', userRouter);

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

