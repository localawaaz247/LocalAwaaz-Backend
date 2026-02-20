const nodemailer = require("nodemailer");
const otpRegisterTemplate = require("./otpRegisterTemplate");
const passwordResetTemplate = require("./passwordResetTemplate");
require("dotenv").config();

/**
 * ============================
 * BREVO SMTP TRANSPORTER
 * ============================
 */
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 2525,
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
async function sendMail({ email, generatedOtp, purpose = "REGISTER" }) {
  try {
    let emailSubject = '';
    let emailHtml = '';
    switch (purpose) {
      case "PASSWORD_RESET":
        emailSubject = "LocalAwaaz - Password Reset Request";
        emailHtml = passwordResetTemplate(generatedOtp);
        break;

      case "REGISTER":
      default:
        emailSubject = "LocalAwaaz - Email Verification OTP";
        emailHtml = otpRegisterTemplate(generatedOtp);
        break;
    }
    const info = await transporter.sendMail({
      from: `"LocalAwaaz" <no-reply@localawaaz.in>`,
      to: email,
      subject: emailSubject,
      html: emailHtml,
    });

    console.log(`[${purpose}]Email sent:`, info.messageId);
  } catch (error) {
    console.error("Error sending mail:", error);
    throw error; // important: don't silently swallow OTP failures
  }
}

module.exports = { sendMail };