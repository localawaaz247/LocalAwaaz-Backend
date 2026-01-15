const nodemailer = require('nodemailer');
const otpEmailTemplate = require('./otpEmailTemplate'); // HTML template for OTP emails
require('dotenv').config();

/**
 * ============================
 * EMAIL TRANSPORTER SETUP
 * ============================
 * Purpose:
 * - Uses Gmail SMTP via Nodemailer
 * - Sends OTP emails to users
 * - Auth credentials are stored in environment variables
 */
const transporter = nodemailer.createTransport({
    service: 'gmail', // Gmail service
    auth: {
        user: process.env.EMAIL,         // Your email address
        pass: process.env.EMAIL_APP_PASS // App password (not your Gmail password)
    }
});

/**
 * ============================
 * SEND OTP EMAIL FUNCTION
 * ============================
 * @param {Object} options
 * @param {string} options.email - Recipient email address
 * @param {string} options.generatedOtp - OTP to send
 *
 * Usage:
 *   await sendMail({ email: "user@example.com", generatedOtp: "123456" });
 */
async function sendMail({ email, generatedOtp }) {
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL,          // Sender email
            to: email,                         // Recipient email
            subject: "Email Authentication",   // Email subject
            html: otpEmailTemplate(generatedOtp) // HTML content from template
        });

        console.log('Email sent:', info.response);
    } catch (error) {
        // Log errors for debugging
        console.error('Error sending mail:', error);
    }
}

module.exports = { sendMail };
