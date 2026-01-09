const User = require("../models/User");

const checkUniqueness = async (req) => {
    const { userName, email, mobile } = req.body;
    if (userName) {
        const record = await User.findOne({ userName });
        if (record) {
            throw new Error("userName should be unique; userName: 1 uppercase, 1 lowercase, 1 number; only _ or @ allowed.")
        }
    }
    if (email) {
        const record = await User.findOne({ email });
        if (record) {
            throw new Error("Email may exists");
        }
    }
    if (mobile) {
        const record = await User.findOne({ mobile })
        if (record) {
            throw new Error("Mobile may exists");
        }
    }
    if (mobile.toString().length !== 10) {
        throw new Error("Mobile must be of 10 digits");
    }
    
}
module.exports = checkUniqueness