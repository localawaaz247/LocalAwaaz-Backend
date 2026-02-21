const nodemailer = require("nodemailer");
const otpRegisterTemplate = require("./otpRegisterTemplate");
const passwordResetTemplate = require("./passwordResetTemplate");
const { generateNotificationEmail } = require("./emailNotificationTemplate");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 2525, // Or 587
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

// 2. Add 'notificationData' to the destructured arguments
async function sendMail({ email, generatedOtp, purpose = "REGISTER", notificationData = {} }) {
  try {
    let emailSubject = '';
    let emailHtml = '';

    switch (purpose) {
      case "PASSWORD_RESET":
        emailSubject = "LocalAwaaz - Password Reset Request";
        emailHtml = passwordResetTemplate(generatedOtp);
        break;

      // ==========================================
      // 3. ADD THE NEW NOTIFICATION CASE
      // ==========================================
      case "NOTIFICATION":
        const { type, message, issueId } = notificationData;

        // Set dynamic subject
        emailSubject = "New Update on LocalAwaaz";
        if (type === 'ISSUE_CONFIRMED') emailSubject = "Someone confirmed your issue!";
        if (type === 'ISSUE_RESOLVED') emailSubject = "An issue you follow was resolved!";
        if (type === 'NEW_COMMENT' || type === 'COMMENT_REPLY') emailSubject = "New comment on your issue";

        // Generate the HTML
        emailHtml = generateNotificationEmail(type, message, issueId);
        break;
      // ==========================================

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

    console.log(`[${purpose}] Email sent:`, info.messageId);
  } catch (error) {
    console.error("Error sending mail:", error);
    // Don't throw error for notifications so it doesn't crash the engine, 
    // but DO throw for OTPs so the user knows registration failed.
    if (purpose !== "NOTIFICATION") throw error;
  }
}

module.exports = { sendMail };