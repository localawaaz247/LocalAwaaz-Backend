const nodemailer = require("nodemailer");
const otpEmailTemplate = require("./otpEmailTemplate");
require("dotenv").config();

/**
 * ============================
 * SENDGRID SMTP TRANSPORTER
 * ============================
 */
const transporter = nodemailer.createTransport({
  host: "smtp.sendgrid.net",
  port: 2525,
  secure: false, // TLS
  auth: {
    user: "apikey", // ⚠️ ALWAYS literally "apikey"
    pass: process.env.SENDGRID_API_KEY
  }
});

/**
 * ============================
 * SEND OTP EMAIL
 * ============================
 */
async function sendMail({ email, generatedOtp }) {
  try {
    const info = await transporter.sendMail({
      from: `"LocalAwaaz" <${process.env.SENDGRID_FROM_EMAIL}>`,
      to: email,
      subject: "Email Verification OTP",
      html: otpEmailTemplate(generatedOtp)
    });

    console.log("Email sent:", info.response);
  } catch (error) {
    console.error("Error sending mail:", error);
  }
}

module.exports = { sendMail };
