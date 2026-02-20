require('dotenv').config()
const express = require('express');
const connectDB = require('../database/connectDB');
const authRouter = require('../routes/authRouter');
const otpRouter = require('../routes/otpRouter');

const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require("express-session");
const passport = require("../config/passport");
const userRouter = require('../routes/userRouter');
const issueRouter = require('../routes/issueRouter');
const contactRouter = require('../routes/contactRouter');
const mediaRouter = require('../routes/mediaRouter');
const startGarbageCollector = require('../utils/garbageCollector');

const app = express();
// Start the background cron jobs
startGarbageCollector();

app.set("trust proxy", 1);
app.use(cors({
    origin: [
        'https://www.localawaaz.in',
        'http://localhost:5173',
        'https://localawaaz.in'
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",        // HTTPS required
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"    // required for frontend-backend on different domains
        }
    })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
app.use(cookieParser());


app.use("/", authRouter);
app.use("/", otpRouter);
app.use('/', userRouter);
app.use('/', issueRouter);
app.use('/', contactRouter);
app.use('/', mediaRouter);


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

