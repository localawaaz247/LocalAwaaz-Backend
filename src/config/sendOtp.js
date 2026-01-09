const nodemailer = require('nodemailer');
const otpEmailTemplate = require('./otpEmailTemplate');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_APP_PASS
    }
});

async function sendMail({ email, generatedOtp }) {
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL,
            to: email,
            subject: "Email Authentication",
            html: otpEmailTemplate(generatedOtp)
        });

        console.log('Email sent:', info.response);
    } catch (error) {
        console.error('Error sending mail:', error);
    }
}


module.exports = { sendMail } 
