const generateNotificationEmail = (type, message, issueId) => {
  // 1. Dynamic Content Based on Notification Type
  let heading = "New Update on LocalAwaaz";
  let icon = "🔔";
  let badgeText = "New Update";
  let buttonText = "View in App"; // Default button text

  if (type === 'ISSUE_CONFIRMED') {
    heading = "People are supporting your issue!";
    icon = "👍";
    badgeText = "Gaining Support";
  } else if (type === 'ISSUE_RESOLVED') {
    heading = "Your issue has been fixed!";
    icon = "✅";
    badgeText = "Resolved";
  } else if (type === 'ISSUE_IN_REVIEW') {
    heading = "Officials are looking at your issue.";
    icon = "🔍";
    badgeText = "In Review";
  } else if (type === 'ISSUE_REJECTED') {
    heading = "Your issue was closed or rejected.";
    icon = "❌";
    badgeText = "Rejected";
  } else if (type === 'NEW_COMMENT' || type === 'COMMENT_REPLY') {
    heading = "Someone left a comment!";
    icon = "💬";
    badgeText = "New Comment";
  } else if (type === 'SYSTEM_BROADCAST') {
    heading = "Important Community Update";
    icon = "📢";
    badgeText = "Official Broadcast";
  } else if (type === 'ISSUE_FLAGGED') {
    heading = "Your issue has been flagged.";
    icon = "⚠️";
    badgeText = "Needs Attention";
    buttonText = "Review Guidelines";
  } else if (type === 'ACCOUNT_SUSPENDED') {
    heading = "Your account has been suspended.";
    icon = "🛑";
    badgeText = "Account Suspended";
    buttonText = "Review Guidelines";
  } else if (type === 'ACCOUNT_BANNED') {
    heading = "Your account has been banned.";
    icon = "🚫";
    badgeText = "Account Banned";
    buttonText = "Review Guidelines";
  } else if (type === 'ACCOUNT_RESTORED') {
    heading = "Your account has been restored.";
    icon = "🎉";
    badgeText = "Account Active";
  }

  // 2. Generate the Base URLs
  const frontendUrl = process.env.NODE_ENV === 'production'
    ? 'https://localawaaz.in'
    : 'http://localhost:5173';

  // 3. Dynamic Button Link Logic
  let buttonLink = issueId ? `${frontendUrl}/issue/${issueId}` : frontendUrl;

  // If the user is penalized, redirect them to the terms instead of the app feed
  if (type === 'ACCOUNT_SUSPENDED' || type === 'ACCOUNT_BANNED' || type === 'ISSUE_FLAGGED') {
    buttonLink = `${frontendUrl}/terms`;
  }

  // 4. The HTML Template
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalAwaaz Notification</title>
  <style>
    /* Reset & Base */
    body { margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-spacing: 0; width: 100%; }
    td { padding: 0; }
    img { border: 0; }

    /* Container */
    .wrapper { width: 100%; table-layout: fixed; background-color: #f4f6f8; padding-bottom: 40px; }
    .main-card { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 500px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

    /* Header */
    .header { 
      background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); 
      padding: 30px 20px; 
      text-align: center; 
    }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
    .header-subtitle { color: rgba(255,255,255,0.9); font-size: 14px; margin-top: 5px; font-weight: 400; }

    /* Body Content */
    .content { padding: 30px 20px; text-align: center; }
    
    /* Secure Badge (Repurposed for Notification Type) */
    .type-badge { 
      background-color: #EFF6FF; 
      color: #2563EB; 
      display: inline-block; 
      padding: 4px 12px; 
      border-radius: 20px; 
      font-size: 12px; 
      font-weight: 600; 
      margin-bottom: 20px;
    }

    /* Headlines */
    .h2 { color: #1F2937; font-size: 20px; font-weight: 700; margin: 0 0 10px; }
    .subtext { color: #4B5563; font-size: 15px; line-height: 1.6; margin: 0 0 25px; }

    /* Message Box */
    .message-container {
      background-color: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      text-align: left;
      font-style: italic;
      color: #374151;
      border-left: 4px solid #3B82F6;
    }

    /* CTA Button */
    .cta-button {
      background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
      color: #ffffff !important;
      text-decoration: none;
      display: inline-block;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
      transition: all 0.2s;
    }

    /* Notice Box (Repurposed for Settings tip) */
    .tip-notice {
      background-color: #F3F4F6;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
      margin-top: 25px;
    }
    .notice-body { color: #6B7280; font-size: 12px; margin: 0; line-height: 1.4; }

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
             <span style="font-size: 24px; line-height: 1;">${icon}</span>
           </span>
        </div>
        <h1>LocalAwaaz</h1>
        <div class="header-subtitle">Your Voice, Your Community</div>
      </td>
    </tr>

    <tr>
      <td class="content">
        
        <div class="type-badge">
          ${badgeText}
        </div>

        <div class="h2">${heading}</div>
        
        <div class="message-container">
          "${message}"
        </div>

        <div>
          <a href="${buttonLink}" class="cta-button">${buttonText}</a>
        </div>

        <div class="tip-notice">
          <p class="notice-body">
            You are receiving this email because you opted into notifications. You can turn these off anytime in your LocalAwaaz profile settings.
          </p>
        </div>

      </td>
    </tr>
  </table>

  <div class="footer">
    <strong>LocalAwaaz • Community Voice Platform</strong><br>
    India<br><br>
    <div class="footer-links">
      <a href="${frontendUrl}/privacy">Privacy Policy</a> • <a href="${frontendUrl}/terms">Terms of Service</a>
    </div>
  </div>

</div>

</body>
</html>
  `;
};

module.exports = { generateNotificationEmail };