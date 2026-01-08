const otpEmailTemplate = (otp) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>LocalAwaaz OTP</title>
      <style>
        body, html {
          margin: 0;
          padding: 0;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #047481, #116466);
          color: #333333;
        }

        .container {
          max-width: 600px;
          margin: 40px auto;
          background: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.15);
          border: 1px solid #e0e0e0;
        }

        .header {
          background: linear-gradient(90deg, #047481, #116466);
          color: #ffffff;
          text-align: center;
          padding: 30px 20px;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .logo {
          font-size: 36px;
          font-weight: bold;
          letter-spacing: 2px;
          color: #ffffff;
          margin-bottom: 8px;
        }

        .content {
          padding: 40px 30px;
          text-align: center;
        }

        .content p {
          font-size: 16px;
          line-height: 1.6;
          color: #555555;
          margin-bottom: 30px;
        }

        .otp-box {
          display: inline-block;
          background-color: #e0f7fa;
          padding: 20px 40px;
          border-radius: 12px;
          font-size: 36px;
          font-weight: 700;
          letter-spacing: 12px;
          color: #047481;
          box-shadow: 0 4px 20px rgba(4, 116, 129, 0.3);
          margin-bottom: 25px;
        }

        .note {
          font-size: 14px;
          color: #777777;
          line-height: 1.5;
          margin-top: 20px;
        }

        .footer {
          background-color: #f0f4f7;
          padding: 20px;
          text-align: center;
          font-size: 13px;
          color: #999999;
        }

        @media only screen and (max-width: 600px) {
          .container {
            margin: 20px;
          }
          .otp-box {
            font-size: 28px;
            padding: 15px 30px;
            letter-spacing: 8px;
          }
        }
      </style>
    </head>

    <body>
      <div class="container">
        <div class="header">
          <div class="logo">LocalAwaaz</div>
          OTP Verification
        </div>

        <div class="content">
          <p>We received a request to verify your account. Use the OTP below to continue.</p>

          <div class="otp-box">${otp}</div>

          <p class="note">
            This OTP is valid for <b>10 minutes</b>.<br />
            Do not share this code with anyone. LocalAwaaz will never ask for your OTP.
          </p>
        </div>

        <div class="footer">
          © ${new Date().getFullYear()} LocalAwaaz. All rights reserved.
        </div>
      </div>
    </body>
  </html>
  `;
};

module.exports = otpEmailTemplate;
