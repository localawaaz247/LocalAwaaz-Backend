const validate = require('validator');

const validateCitizenSignupData = (req) => {
    const { password, email, name, gender } = req.body; //mobile can also be send
    const allowedGender = ['male', 'female', 'other'];
    if (!name || name.trim().length < 4) {
        throw new Error('Name must be at least 4 characters long');
    }
    if (!email || !validate.isEmail(email)) {
        throw new Error('Email Id is not valid');
    }
    if (!gender || !allowedGender.includes(gender)) {
        throw new Error('Enter valid Gender : male, female, other')
    }
    if (!password || !validate.isStrongPassword(password)) {
        throw new Error('Password must be at least 8 chars and include upper, lower, number & symbol');
    }
    return true;
}
module.exports = validateCitizenSignupData