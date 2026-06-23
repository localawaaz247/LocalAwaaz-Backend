const express = require('express');
const contactRouter = express.Router();
const rateLimit = require('express-rate-limit');
const Inquiry = require('../models/Inquiry');
const validator = require('validator');

// --- SPAM PROTECTION CONFIGURATION ---
const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: {
        success: false,
        msg: "Too many messages sent, try again after an hour."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// --- VALIDATION & SANITIZATION MIDDLEWARE ---
const sanitizeAndValidateInquiry = (req, res, next) => {
    const { name, email, message } = req.body;

    // 1. Prevent NoSQL Injection: Ensure inputs are strictly strings
    if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string') {
        return res.status(400).json({ success: false, message: "Invalid input data type format" });
    }

    // 2. Trim whitespace
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanMessage = message.trim();

    // 3. Basic Validation Checks
    if (!cleanName || !cleanEmail || !cleanMessage) {
        return res.status(400).json({ success: false, message: 'Please enter all fields' });
    }

    // Prevent extremely long string payloads (Denial of Service protection)
    if (cleanName.length < 3 || cleanName.length > 50) {
        return res.status(400).json({ success: false, message: "Name must be between 3 and 50 chars" });
    }

    if (!validator.isEmail(cleanEmail)) {
        return res.status(400).json({ success: false, message: "Enter valid email id" });
    }

    const wordCount = cleanMessage.split(/\s+/).length;
    if (wordCount > 50) {
        return res.status(400).json({ success: false, message: "Message is too long (max 50 words)!!" });
    }

    // 4. Sanitize against XSS (Escape HTML/Scripts)
    // validator.escape() converts <, >, &, ', ", and / to HTML entities.
    req.body.name = validator.escape(cleanName);
    req.body.email = validator.normalizeEmail(cleanEmail);
    req.body.message = validator.escape(cleanMessage);

    // Pass the sanitized data to the next function
    next();
};

// --- ROUTE HANDLER ---
// Notice how the custom middleware sits right after the rate limiter
contactRouter.post('/inquiry', contactLimiter, sanitizeAndValidateInquiry, async (req, res) => {
    // req.body is now strictly strings, trimmed, validated, and HTML-escaped.
    const { name, email, message } = req.body;

    try {
        // Create new Inquiry object
        const newInquiry = new Inquiry({
            name,
            email,
            message
        });

        // Save to Database
        await newInquiry.save();

        res.status(200).json({ success: true, message: 'Message sent successfully!' });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

module.exports = contactRouter;