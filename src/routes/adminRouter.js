const express = require('express');
const adminRouter = express.Router();
const User = require('../models/User');
const Issue = require('../models/Issue');
const userAuth = require('../middlewares/userAuth');
const adminAuth = require('../middlewares/adminAuth');
const triggerNotification = require('../utils/notificationService');

adminRouter.get('/admin/issues', userAuth, adminAuth, async (req, res) => {
    try {
        const { status, state, city, pinCode } = req.query;
        const query = {};
        if (status) query.status = status.toUpperCase();
        if (state) query['location.state'] = { $regex: state, $options: 'i' };
        if (city) query['location.city'] = { $regex: city, $options: 'i' };
        if (pinCode) query['location.pinCode'] = pinCode;

        const issues = await Issue.find(query)
            .sort({ createdAt: -1 })
            .populate('reportedBy', 'name userName email civilScore');

        return res.status(200).json(
            {
                success: true,
                message: 'Got all the issues',
                count: issues.length,
                data: issues
            }
        )
    }
    catch (err) {
        console.log('Server Error : error in getting all the issues');
        return res.status(500).json(
            {
                success: false,
                message: "Server Error : Can't get all the issues"
            }
        )
    }
})

adminRouter.patch('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const io = req.app.get('io');
        const status = req.body.status.toUpperCase();
        const officialRemark = req.body.officialRemark;
        const validStatus = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'];
        if (!validStatus.includes(status)) {
            return res.status(400).json(
                {
                    success: false,
                    message: "Invalid status update requested."
                }
            )
        }
        const updatedIssue = await Issue.findOneAndUpdate(
            { _id: id },
            {
                $set: {
                    status: status,
                    adminRemark: officialRemark || "",
                    updatedAt: Date.now()
                },
                $push: {
                    statusHistory: {
                        status: status,
                        changedBy: userId,
                        changedAt: Date.now(),
                        remark: officialRemark || 'Status updated by Admin'
                    }
                }
            },
            {
                new: true // Return the updated document
            }
        );
        if (!updatedIssue) {
            return res.json(
                {
                    success: false,
                    message: "Issue not found"
                }
            )
        }
        try {
            let notificationType = null;
            if (status === 'RESOLVED') notificationType = 'ISSUE_RESOLVED';
            if (status === 'IN_REVIEW') notificationType = 'ISSUE_IN_REVIEW';
            if (status === 'REJECTED') notificationType = 'ISSUE_REJECTED'

            triggerNotification(
                {
                    recipientId: updatedIssue.reportedBy,
                    senderId: userId,
                    issueId: updatedIssue._id,
                    type: notificationType,
                    message: officialRemark
                        ? `An admin updated your issue to ${status}: "${officialRemark}"`
                        : `The status of your issue have been updated to ${status}.`,
                    io: io
                }
            )
        }
        catch (notificationError) {
            console.error("Non-fatal error triggering admin notification:", notificationError);
        }
        return res.status(200).json(
            {
                success: true,
                message: `Issue status updated to ${status}`,
                data: updatedIssue
            }
        )

    }
    catch (err) {
        console.log("Server Error in updating issue status", err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error : Could not update the issue status"
            }
        )
    }
})

adminRouter.get('/admin/users', userAuth, adminAuth, async (req, res) => {
    try {
        // Fetch all users except admin, omit passwords
        const users = await User.find({ role: { $ne: 'admin' } })
            .select('-password')
            .sort({ createdAt: -1 });
        return res.status(200).json(
            {
                success: true,
                message: "Got users successfully",
                count: users.length,
                data: users
            }
        );
    }
    catch (err) {
        console.log('Server Error : Cannot get users', err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error : Cannot get users"
            }
        )
    }
})
module.exports = adminRouter