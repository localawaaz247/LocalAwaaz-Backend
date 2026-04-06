require('dotenv').config()
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const lokAiRouter = require('../routes/lokAiRouter');
const adminRouter = require('../routes/adminRouter');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: [
            'https://www.localawaaz.in',
            'https://localawaaz.in',
            'http://localhost:5173'
        ],
        methods: ["GET", "POST"],
        credentials: true // <-- ADDED: This is required for Socket.IO to accept cookies/sessions
    }
});

app.set('io', io);

// The Real-Time Connection Logic
io.on('connection', (socket) => {
    console.log(`User connected to socket: ${socket.id}`);

    // When the React frontend loads, it will emit this event with the user's ID
    socket.on('join_user_room', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their private notification room.`);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// require('../workers/mediaWorker')(io);
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());


app.use("/", authRouter);
app.use("/", otpRouter);
app.use('/', userRouter);
app.use('/', issueRouter);
app.use('/', contactRouter);
app.use('/', mediaRouter);
app.use('/', lokAiRouter);
app.use('/', adminRouter);

// A simple route to keep the server awake
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! Server is awake.');
});

cron.schedule('*/14 * * * *', async () => {
    try {
        const serverUrl = process.env.NODE_ENV === 'production' ? 'https://localawaaz-backend.onrender.com/ping' : `http://localhost:${process.env.PORT}/ping`;

        const response = await fetch(serverUrl);
        const data = await response.text();

        console.log(`[${new Date().toISOString()}] Cron ping status: ${response.status} - ${data}`);
    } catch (error) {
        console.error('Cron self-ping failed:', error.message);
    }
});

const startServer = async () => {
    try {
        await connectDB();
        const Port = process.env.PORT || 1111
        server.listen(Port, () => {
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
