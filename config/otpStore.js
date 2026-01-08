const otpStore = {};

function saveOtp(email, otp) {
  otpStore[email] = {
    otp,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
}

function verifyOtp(email, enteredOtp) {
  const record = otpStore[email];
  if (!record) throw new Error('No OTP found for this email');

  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    throw new Error('OTP has expired');
  }

  if (enteredOtp !== record.otp) throw new Error('OTP is incorrect');
 
  delete otpStore[email];
  return true;
}

module.exports = { saveOtp, verifyOtp };
