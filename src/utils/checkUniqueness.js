const User = require("../models/User");

const checkUniqueness = async (req) => {
    const { userName, email, mobile } = req.body;
    if (userName) {
        const record = await User.findOne({ userName });
        if (record) {
            throw new Error("Username already taken")
        }
    }
    if (email) {
        const record = await User.findOne({ email });
        if (record) {
            throw new Error("Email is already registered");
        }
    }
    if (mobile) {
        const record = await User.findOne({ mobile })
        if (record) {
            throw new Error("Mobile number is already registered");
        }
    }
    if (mobile && mobile.toString().length !== 10) {
        throw new Error("Mobile must be of 10 digits");
    }

}
module.exports = checkUniqueness