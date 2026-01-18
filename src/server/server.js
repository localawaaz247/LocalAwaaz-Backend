require('dotenv').config()
const express = require('express');
const connectDB = require('../database/connectDB');
const authRouter = require('../routes/authRouter');
const otpRouter = require('../routes/otpRouter');

const cors = require('cors');
const app = express();
const cookieParser = require('cookie-parser');
const session = require("express-session");
const passport = require("../config/passport");
const userRouter = require('../routes/userRouter');
const issueRouter = require('../routes/issueRouter');

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);

app.use(passport.initialize());
app.use(passport.session());


app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.set("trust proxy", 1);

app.use("/", authRouter);
app.use("/", otpRouter);
app.use('/', userRouter);
app.use('/', issueRouter);


// A simple route to keep the server awake
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! Server is awake.');
});

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

