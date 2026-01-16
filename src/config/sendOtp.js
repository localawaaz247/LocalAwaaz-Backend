const nodemailer = require("nodemailer");
const otpEmailTemplate = require("./otpEmailTemplate");
require("dotenv").config();

/**
 * ============================
 * BREVO SMTP TRANSPORTER
 * ============================
 */
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // MUST be false for port 587
  auth: {
    user: process.env.BREVO_SMTP_USER, // your Brevo login email
    pass: process.env.BREVO_SMTP_KEY,  // SMTP key from Brevo
  },
});

/**
 * ============================
 * SEND OTP EMAIL
 * ============================
 */
async function sendMail({ email, generatedOtp }) {
  try {
    const info = await transporter.sendMail({
      from: `"LocalAwaz" <no-reply@localawaaz.in>`,
      to: email,
      subject: "Email Verification OTP",
      html: otpEmailTemplate(generatedOtp),
    });

    console.log("Email sent:", info.messageId);
  } catch (error) {
    console.error("Error sending mail:", error);
    throw error; // important: don't silently swallow OTP failures
  }
}

module.exports = { sendMail };
