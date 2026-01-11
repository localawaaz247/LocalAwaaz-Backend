const validate = require('validator');

const validateLocalSignupData = (req) => {
    const { userName, password, email, name, profilePic, gender, mobile, country, state, district, pinCode } = req.body;
    const allowedGender = ['male', 'female', 'other'];
    const userNameRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d_@]+$/;
    if (!name || name.trim().length < 3) {
        throw new Error('Name must be at least 3 characters long');
    }
    if (!userName) {
        throw new Error("userName is required");
    }
    if (userName.trim().length < 4) {
        throw new Error('username too short');
    }
    if (!userNameRegex.test(userName)) {
        throw new Error('userName must contain at least 1 uppercase, 1 lowercase, 1 number and only _ or @ are allowed');
    }
    if (!password) {
        throw new Error('Password is required');
    }
    if (!validate.isStrongPassword(password)) {
        throw new Error('Password must be at least 8 chars and include upper, lower, number & symbol');
    }
    if (!gender) {
        throw new Error('Gender is required');
    }
    if (gender && !allowedGender.includes(gender)) {
        throw new Error('Enter valid Gender : male, female, other')
    }
    if (email && !validate.isEmail(email)) {
        throw new Error('Email is not valid');
    }
    if (profilePic && !validate.isURL(profilePic)) {
        throw new Error('Select valid Profile Picture');
    }
    if (mobile && !validate.isMobilePhone(mobile, 'any')) {
        throw new Error('Enter valid Mobile Number');
    }
    if (!country) {
        throw new Error('Select Country');
    }
    if (!state) {
        throw new Error('Select State');
    }
    if (!district) {
        throw new Error('Enter District');
    }
    if (!pinCode) {
        throw new Error('Enter PinCode');
    }
    if (!validate.isPostalCode(pinCode, 'any')) {
        throw new Error('Enter Valid PinCode');
    }
    return true;
}
module.exports = validateLocalSignupData