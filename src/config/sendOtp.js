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
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false, // TLS
    auth: {
        user: process.env.BREVO_SMTP_USER, // Brevo login email
        pass: process.env.BREVO_SMTP_KEY   // SMTP key from Brevo
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
            from: `"LocalAwaaz" <${process.env.BREVO_SMTP_USER}>`,          // Sender email
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
