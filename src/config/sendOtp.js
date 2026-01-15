const sgMail = require('@sendgrid/mail');
require('dotenv').config();
const otpEmailTemplate = require('./otpEmailTemplate');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendMail({ email, generatedOtp }) {
    try {
        const msg = {
            to: email,
            from: process.env.SENDER_EMAIL,  // Verified sender in SendGrid
            subject: 'Email Authentication',
            html: otpEmailTemplate(generatedOtp)
        };

        await sgMail.send(msg);
        console.log('Email sent successfully via SendGrid');
    } catch (err) {
        console.error('SendGrid email error:', err);
        throw new Error("Failed to send OTP email");
    }
}

module.exports = { sendMail };
