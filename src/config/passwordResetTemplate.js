const passwordResetTemplate = (otp) => {
  // Split OTP into individual digits
  const otpArray = otp.toString().split('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalAwaaz Password Reset</title>
  <style>
    /* Reset & Base */
    body { margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-spacing: 0; width: 100%; }
    td { padding: 0; }
    img { border: 0; }

    /* Container */
    .wrapper { width: 100%; table-layout: fixed; background-color: #f4f6f8; padding-bottom: 40px; }
    .main-card { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 500px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

    /* Header - Slightly darker gradient for security action */
    .header { 
      background: linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%); 
      padding: 30px 20px; 
      text-align: center; 
    }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
    .header-subtitle { color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 5px; font-weight: 400; }

    /* Body Content */
    .content { padding: 30px 20px; text-align: center; }
    
    /* Secure Badge - Changed to Red/Orange tone for alert */
    .secure-badge { 
      background-color: #FEF2F2; 
      color: #DC2626; 
      display: inline-block; 
      padding: 4px 12px; 
      border-radius: 20px; 
      font-size: 12px; 
      font-weight: 600; 
      margin-bottom: 20px;
    }

    /* Headlines */
    .h2 { color: #1F2937; font-size: 20px; font-weight: 700; margin: 0 0 10px; }
    .subtext { color: #6B7280; font-size: 14px; line-height: 1.5; margin: 0 0 25px; }

    /* OTP Section */
    .otp-container {
      background-color: #F9FAFB;
      border: 2px dashed #E5E7EB;
      border-radius: 12px;
      padding: 20px 5px; /* Reduced padding for mobile safety */
      margin-bottom: 24px;
    }
    
    /* Default (Desktop) OTP Digit Style */
    .otp-digit {
      display: inline-block;
      width: 40px;
      height: 48px;
      line-height: 48px;
      background-color: #ffffff;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      font-size: 24px;
      font-weight: 700;
      color: #1E3A8A; /* Darker text */
      margin: 0 3px; /* Reduced margin */
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      text-align: center;
    }

    /* Mobile Responsive Tweaks */
    @media only screen and (max-width: 480px) {
      .otp-digit {
        width: 32px !important;    /* Force smaller width */
        height: 40px !important;   /* Force smaller height */
        line-height: 40px !important;
        font-size: 18px !important; /* Smaller font */
        margin: 0 2px !important;  /* Tighter spacing */
      }
      .content {
        padding: 20px 15px !important;
      }
      .header {
        padding: 20px 15px !important;
      }
    }

    .expiry-text { color: #6B7280; font-size: 13px; margin-top: 15px; }

    /* Security Notice Box - Elevated warning */
    .security-notice {
      background-color: #FEF2F2;
      border-left: 4px solid #DC2626;
      border-radius: 4px;
      padding: 12px;
      text-align: left;
      margin-top: 25px;
    }
    .notice-title { color: #991B1B; font-size: 12px; font-weight: 700; margin-bottom: 4px; display: block; }
    .notice-body { color: #991B1B; font-size: 12px; margin: 0; line-height: 1.4; }

    /* Footer */
    .footer { text-align: center; padding-top: 30px; color: #9CA3AF; font-size: 11px; line-height: 1.5; }
    .footer strong { color: #6B7280; }
    .footer-links a { color: #6B7280; text-decoration: none; margin: 0 5px; }
  </style>
</head>
<body>

<div class="wrapper">
  <br>
  <table class="main-card" align="center">
    
    <tr>
      <td class="header">
        <div style="margin-bottom: 10px;">
           <span style="background: rgba(255,255,255,0.2); border-radius: 12px; padding: 8px 12px; display: inline-block;">
             <span style="font-size: 24px; line-height: 1;">🔐</span>
           </span>
        </div>
        <h1>LocalAwaaz</h1>
        <div class="header-subtitle">Account Security Alert</div>
      </td>
    </tr>

    <tr>
      <td class="content">
        
        <div class="secure-badge">
          ⚠ Password Reset Request
        </div>

        <div class="h2">Reset Your Password</div>
        <div class="subtext">
          We received a request to reset the password for your LocalAwaaz account. Enter this code to proceed.
        </div>

        <div class="otp-container">
          ${otpArray.map(digit => `<span class="otp-digit">${digit}</span>`).join('')}
          
          <div class="expiry-text">
            This code expires in <strong>10 minutes</strong>
          </div>
        </div>

        <div class="security-notice">
          <span class="notice-title">🛡 Urgent Security Notice</span>
          <p class="notice-body">
            If you did <strong>not</strong> request a password reset, please ignore this email. Your password will remain unchanged. Never share this code with anyone.
          </p>
        </div>

      </td>
    </tr>
  </table>

  <div class="footer">
    <strong>LocalAwaaz • Community Voice Platform</strong><br>
    India<br><br>
    <div class="footer-links">
      <a href="#">Privacy Policy</a> • <a href="#">Terms of Service</a> • <a href="#">Support</a>
    </div>
  </div>

</div>

</body>
</html>
  `;
};

module.exports = passwordResetTemplate;