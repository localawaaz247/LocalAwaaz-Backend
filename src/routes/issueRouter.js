const express = require('express');
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');
const checkIssueDetails = require('../utils/checkIssueDetails');
const Issue = require('../models/Issue');
const User = require('../models/User');
const issueRouter = express.Router();

issueRouter.post('/create/issue', userAuth, profileAuth, async (req, res) => {
    try {

        const userId = req.userId;
        const { title, category, description, location, media } = req.body;
        checkIssueDetails(req);
        const user = await User.findOne({ _id: userId })
        if (!user) {
            return res.status(400).json({ success: false, message: 'User not Found' });
        }
        if (!user.isVerified) {
            return res.status(400).json({ success: false, message: "Verify your email before Posting" });
        }
        const newIssue = await Issue.create({
            userId,
            title,
            category,
            description,
            location: {
                country: location.country || "India",
                state: location.state,
                city: location.city,
                pincode: location.pincode,
                geoData: {
                    type: "Point",
                    coordinates: location.geoData.coordinates
                }
            },
            media: media || [],
            status: "OPEN",
            statusHistory: [{
                status: "OPEN",
                changedBy: userId,
                note: "Issue reported by user"
            }]
        });
        return res.status(200).json({ success: true, message: "Your Issue has been recorded" })
    }
    catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }


})



module.exports = issueRouter