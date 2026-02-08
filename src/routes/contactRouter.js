const express = require('express');
const contactRouter = express.Router();
const rateLimit = require('express-rate-limit');
const Inquiry = require('../models/Inquiry');
const validator = require('validator');
// --- SPAM PROTECTION CONFIGURATION ---
// Allow only 5 messages from the same IP every 1 hour
const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour in milliseconds
    max: 5,
    message: {
        success: false,
        msg: "Too many messages sent, try again after an hour."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

contactRouter.post('/inquiry', contactLimiter, async (req, res) => {
    const { name, email, message } = req.body;

    // 1. Basic Validation
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, msg: 'Please enter all fields' });
    }
    if (name.trim().length < 3) {
        return res.status(400).json({ success: false, message: "Name must be atleast 3 chars" });
    }
    if (!validator.isEmail(email)) {
        return res.status(400).json({ success: false, message: "Enter valid email id" });
    }
    const wordCount = message.trim().split(/\s+/).length
    if (wordCount > 50) {
        return res.status(400).json({ success: false, message: "Message is too long (max 50 words)!!" });
    }
    try {
        // 2. Create new Inquiry object
        const newInquiry = new Inquiry({
            name: name.trim(),
            email,
            message: message.trim()
        });

        // 3. Save to Database
        await newInquiry.save();

        res.status(200).json({ success: true, message: 'Message sent successfully!' });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: "Server Error" })
    }
});

module.exports = contactRouter;