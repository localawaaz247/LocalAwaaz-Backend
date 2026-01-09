const otpEmailTemplate = (otp) => {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verify your identity in - LocalAwaaz</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #24292f;
      }

      .wrapper {
        width: 100%;
        padding: 24px 0;
      }

      .container {
        max-width: 480px;
        margin: 0 auto;
        padding: 0 16px;
      }

      .logo {
        text-align: center;
        margin-bottom: 24px;
      }

      .logo img {
        width: 32px;
        height: 32px;
      }

      h1 {
        font-size: 24px;
        font-weight: 300;
        text-align: center;
        margin: 0 0 24px 0;
      }

      h1 strong {
        font-weight: 600;
      }

      .box {
        border: 1px solid #d0d7de;
        border-radius: 6px;
        padding: 24px;
        font-size: 14px;
        line-height: 1.5;
      }

      .otp {
        font-size: 32px;
        font-weight: 600;
        letter-spacing: 4px;
        text-align: center;
        margin: 16px 0;
      }

      .muted {
        color: #57606a;
      }

      .bold {
        font-weight: 600;
      }

      .footer {
        margin-top: 24px;
        font-size: 12px;
        color: #57606a;
        text-align: center;
      }
    </style>
  </head>

  <body>
    <div class="wrapper">
      <div class="container">

       <!-- <div class="logo"> -->
          <!-- Replace src with your hosted logo if needed -->
        <!--  <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="Logo" /> -->
        <!-- </div> -->

        <h1>
          Please verify your identity in 
          <strong>LocalAwaaz</strong>
        </h1>

        <div class="box">
          <p>Here is your LocalAwaaz authentication code:</p>

          <div class="otp">${otp}</div>

          <p class="muted">
            This code is valid for <strong>10 minutes</strong> and can only be used once.
          </p>

          <p class="bold">
            Please don't share this code with anyone:
            <span class="muted">
              LocalAwaaz will never ask for it on the phone or via email.
            </span>
          </p>

          <p>Thanks,<br />The LocalAwaaz Team</p>
        </div>

        <div class="footer">
          You're receiving this email because a verification code was requested for your
          LocalAwaaz account. If this wasn't you, please ignore this email.
        </div>

      </div>
    </div>
  </body>
</html>
  `;
};

module.exports = otpEmailTemplate;
