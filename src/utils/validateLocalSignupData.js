const validate = require('validator');

const validateLocalSignupData = (req) => {
    const { userName, password, email, name, profilePic, gender, country, state, city, pinCode } = req.body; //mobile can also be send
    const allowedGender = ['male', 'female', 'other'];
    const userNameRegex = /^[\x21-\x7E]{4,10}$/;
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
        throw new Error('username must be 4-10 characters and cannot contain spaces or emojis.');
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
    if (!email) {
        throw new Error('Email id is required');
    }
    if (email && !validate.isEmail(email)) {
        throw new Error('Email id is not valid');
    }
    if (profilePic && !validate.isURL(profilePic)) {
        throw new Error('Select valid Profile Picture');
    }
    // if (mobile && !validate.isMobilePhone(mobile, 'any')) {
    //     throw new Error('Enter valid Mobile Number');
    // }
    // if (!country) {
    //     throw new Error('Select Country');
    // }
    // if (!state) {
    //     throw new Error('Select State');
    // }
    // if (!city) {
    //     throw new Error('Enter city');
    // }
    // if (!pinCode) {
    //     throw new Error('Enter PinCode');
    // }
    if (pinCode && !validate.isPostalCode(pinCode.toString(), 'IN')) {
        throw new Error('Enter Valid PinCode');
    }
    return true;
}
module.exports = validateLocalSignupData