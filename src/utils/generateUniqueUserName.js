const User = require("../models/User");

const generateUniqueUserName = async (email) => {
    let baseName = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');

    baseName = baseName.substring(0, 3);

    if (!baseName) baseName = 'usr';
    let isUnique = false;
    let finalUserName = '';

    while (!isUnique) {
        const randomDigits = Math.floor(100 + Math.random() * 900);
        finalUserName = `${baseName}_${randomDigits}`;
        const existingUser = await User.findOne({ userName: finalUserName });
        if (!existingUser) {
            isUnique = true;
        }
    }
    
    return finalUserName;
};

module.exports = generateUniqueUserName