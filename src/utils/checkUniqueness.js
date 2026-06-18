const User = require("../models/User");

const checkUniqueness = async (req) => {
    const { email } = req.body;
    if (email) {
        const record = await User.findOne({ "contact.email": email.toLowerCase() });

        if (record) {
            throw new Error("Email is already registered");
        }
    }
};

module.exports = checkUniqueness;