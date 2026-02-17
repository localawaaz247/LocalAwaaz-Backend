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
const contactRouter = require('../routes/contactRouter');

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);
app.use(cors({
  origin: '*', // Or your specific frontend domains
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'] 
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

app.set("trust proxy", 1);

app.use("/", authRouter);
app.use("/", otpRouter);
app.use('/', userRouter);
app.use('/', issueRouter);
app.use('/', contactRouter);


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

