const express = require('express');
const adminRouter = express.Router();
const User = require('../models/User');
const Issue = require('../models/Issue');
const userAuth = require('../middlewares/userAuth');
const adminAuth = require('../middlewares/adminAuth');
const triggerNotification = require('../utils/notificationService');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Inquiry = require('../models/Inquiry');

// Issue Controlling Routes
// Get all the issues 
adminRouter.get('/admin/issues', userAuth, adminAuth, async (req, res) => {
    try {
        const { status, state, city, pinCode, page = 1, limit = 20 } = req.query;

        const query = {};
        if (status && typeof status === 'string') query.status = status.toUpperCase();
        if (state) query['location.state'] = { $regex: state, $options: 'i' };
        if (city) query['location.city'] = { $regex: city, $options: 'i' };
        if (pinCode) query['location.pinCode'] = pinCode;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [issues, total] = await Promise.all([
            Issue.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('reportedBy', 'name userName email civilScore'),
            Issue.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            message: 'Got all the issues',
            data: {
                issues,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalIssues: total,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Server Error : error in getting all the issues', err);
        return res.status(500).json({ success: false, message: "Server Error : Can't get all the issues" });
    }
});

// Update the issue
adminRouter.patch('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId; // The Admin making the change
        const io = req.app.get('io');

        // Clone the body so we can safely manipulate it
        const updateData = { ...req.body };

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue ID" });
        }

        // 1. Protect immutable fields from accidental overwrites
        delete updateData._id;
        delete updateData.reportedBy;

        let isStatusUpdated = false;
        let newStatus = null;
        let officialRemark = updateData.adminRemark || "";
        let pushQuery = {};

        // 2. Check if the status is part of the update request
        if (updateData.status) {
            newStatus = updateData.status.toUpperCase();
            const validStatus = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'];

            if (!validStatus.includes(newStatus)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Allowed values: ${validStatus.join(', ')}`
                });
            }

            // Lock in the validated status
            updateData.status = newStatus;
            isStatusUpdated = true;

            // Prepare the history log
            pushQuery = {
                statusHistory: {
                    status: newStatus,
                    changedBy: userId,
                    changedAt: Date.now(),
                    remark: officialRemark || 'Status updated by Admin'
                }
            };
        }

        // 3. Build the Mongoose update object dynamically
        const mongooseUpdate = { $set: updateData };
        if (isStatusUpdated) {
            mongooseUpdate.$push = pushQuery;
        }

        // 4. Execute the update
        const updatedIssue = await Issue.findByIdAndUpdate(
            id,
            mongooseUpdate,
            { new: true, runValidators: true }
        );

        if (!updatedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        // 5. Trigger Notification Engine ONLY if status changed
        if (isStatusUpdated) {
            try {
                let notificationType = null;
                if (newStatus === 'RESOLVED') notificationType = 'ISSUE_RESOLVED';
                if (newStatus === 'IN_REVIEW') notificationType = 'ISSUE_IN_REVIEW';
                if (newStatus === 'REJECTED') notificationType = 'ISSUE_REJECTED';

                // We only trigger if it maps to an active notification type
                if (notificationType) {
                    // Note: No 'await' here. We let the notification run in the background.
                    triggerNotification({
                        recipientId: updatedIssue.reportedBy,
                        senderId: userId,
                        issueId: updatedIssue._id,
                        type: notificationType,
                        message: officialRemark
                            ? `An admin updated your issue to ${newStatus}: "${officialRemark}"`
                            : `The status of your issue has been updated to ${newStatus}.`,
                        io: io
                    }).catch(err => console.error("Background notification error:", err));
                }
            } catch (notificationError) {
                console.error("Non-fatal error checking admin notification triggers:", notificationError);
            }
        }

        // 6. Return success to the admin dashboard
        return res.status(200).json({
            success: true,
            message: isStatusUpdated ? `Issue status updated to ${newStatus}` : "Issue updated successfully",
            data: updatedIssue
        });

    } catch (err) {
        console.error("Server Error in updating issue:", err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Could not update the issue",
            error: err.message
        });
    }
});

// Get a particular issue
adminRouter.get('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue id" });
        }
        const issue = await Issue.findById(id);
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }
        return res.status(200).json({
            success: true,
            message: "Issue found for admin",
            data: issue
        })
    }
    catch (err) {
        console.log('Server Error: Cannot get the issue for admin', err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error: Cannot get the issue for admin"
            }
        )
    }
})

// Delete an issue
adminRouter.delete('/admin/issue/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Issue id" });
        }

        const deletedIssue = await Issue.findByIdAndDelete(id);

        if (!deletedIssue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        await User.updateMany(
            { savedIssues: id },
            { $pull: { savedIssues: id } }
        );

        return res.status(200).json({
            success: true,
            message: "Issue successfully deleted"
        });

    } catch (err) {
        console.log('Server Error: Cannot delete the issue', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot delete the issue"
        });
    }
});


// User Controlling Routes
// Get all the users 
adminRouter.get('/admin/users', userAuth, adminAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;

        // Base query: don't fetch admins
        const query = { role: { $ne: 'admin' } };

        // Optional: Allow admin to search users by name or email
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { 'contact.email': { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            message: "Got users successfully",
            data: {
                users,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalUsers: total,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (err) {
        console.error('Server Error : Cannot get users', err);
        return res.status(500).json({ success: false, message: "Server Error : Cannot get users" });
    }
});

// Update user role (Promote/Demote)
adminRouter.patch('/admin/user/:id/role', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User Id" });
        }

        // Define allowed roles based on your application logic. 
        // Update these based on what you actually need in LocalAwaaz.
        const validRoles = ['user', 'admin', 'moderator', 'official'];

        if (!validRoles.includes(role?.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: `Invalid role. Allowed roles are: ${validRoles.join(', ')}`
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            id,
            { $set: { role: role.toLowerCase() } },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: `User role updated to ${role}`,
            data: updatedUser
        });
    } catch (err) {
        console.error('Server Error: Cannot update user role', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Could not update user role"
        });
    }
});

// Get everything about a specific user and their history
adminRouter.get('/admin/user/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User Id" });
        }
        const user = await User.findById(id).select("-password");
        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }

        //Fetch all the issues
        const userIssues = await Issue.find({ reportedBy: id })
            .sort({ createdAt: -1 })
            .select('title category status location.city location.pinCode createdAt');

        return res.status(200).json(
            {
                success: true,
                message: "User details fetched successfully",
                data: {
                    user,
                    recentIssues: userIssues,
                    totalIssuesReported: userIssues.length
                }
            }
        )
    }
    catch (err) {
        console.log("Server Error in getting user profile for admin", err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error in getting profile of user for admin"
            }
        )
    }
})

// Update user account status (Suspend, Ban, Reactivate)
adminRouter.patch('/admin/user/:id/status', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { accountStatus } = req.body; // e.g., 'ACTIVE', 'SUSPENDED', 'BANNED'

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User Id" });
        }
        const validStatus = ['ACTIVE', 'SUSPENDED', 'BANNED'];
        if (!validStatus.includes(accountStatus?.toUpperCase())) {
            return res.json(
                {
                    success: false,
                    message: 'Invalid account status. Must be ACTIVE, SUSPENDED, or BANNED.'
                }
            )
        }

        const updatedUser = await User.findByIdAndUpdate(
            id,
            { $set: { accountStatus: accountStatus.toUpperCase() } },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(400).json(
                {
                    success: false,
                    message: "User not found"
                }
            )
        }

        return res.status(200).json(
            {
                success: true,
                message: `User status updated to ${accountStatus}`,
                data: updatedUser
            }
        );
    }
    catch (err) {
        console.log('Server Error : Cannot update the user status', err);
        return res.status(500).json({ success: false, message: "Server Error : Could not update the user status" });
    }
})

// Permanently delete a user and their associated data
adminRouter.delete('/admin/user/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User id" });
        }

        // Find a user
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json(
                {
                    success: false,
                    message: "User not found"
                }
            )
        }

        // Prevent admin from deleting themselves accidentally
        if (id === req.userId) {
            return res.json(
                {
                    success: false,
                    message: "You cannot delete your own admin account"
                }
            )
        }

        // Delete all issues reported by this user
        await Issue.deleteMany({ reportedBy: id });

        // Remove user's confirmations from other issues
        await Issue.updateMany(
            { 'confirmations.user': id },
            { $pull: { confirmations: { user: id } } }
        );

        // Delete the user
        await User.findByIdAndDelete(id);

        return res.status(200).json(
            {
                success: true,
                message: "User and their associated data have been permanently deleted"
            }
        )

    }
    catch (err) {
        console.log("Server Error: Cannot delete user", err);
        return res.status(500).json(
            {
                success: false,
                message: "Server Error: Could not delete user"
            }
        )
    }
})

// Updates any field in the user's profile
adminRouter.patch('/admin/user/:userId', userAuth, adminAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const updateData = req.body; // The fields the admin wants to change

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid User ID" });
        }

        // Prevent admin from accidentally changing the _id
        delete updateData._id;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
            success: true,
            message: "User profile updated successfully",
            data: updatedUser
        });

    } catch (err) {
        console.error('Server Error: Cannot update user profile', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot update user profile",
            error: err.message
        });
    }
});

// Fetches high-level stats for the admin dashboard
adminRouter.get('/admin/analytics/summary', userAuth, adminAuth, async (req, res) => {
    try {
        // Run all independent queries concurrently for better performance
        const [totalUsers, totalIssues, statusCounts] = await Promise.all([
            User.countDocuments(),
            Issue.countDocuments(),
            // Aggregate issues to count how many are OPEN, RESOLVED, etc.
            Issue.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        // Format the status counts into a cleaner object
        const issueStats = {
            OPEN: 0, IN_REVIEW: 0, RESOLVED: 0, REJECTED: 0
        };
        statusCounts.forEach(stat => {
            issueStats[stat._id] = stat.count;
        });

        return res.status(200).json({
            success: true,
            message: "Analytics summary fetched successfully",
            data: {
                totalUsers,
                totalIssues,
                issueStats
            }
        });

    } catch (err) {
        console.error('Server Error: Cannot fetch analytics summary', err);
        return res.status(500).json({ success: false, message: "Server Error: Analytics summary failed" });
    }
});

// Gets Data grouped by city to see where the most issues are
adminRouter.get('/admin/analytics/location', userAuth, adminAuth, async (req, res) => {
    try {
        const locationStats = await Issue.aggregate([
            {
                // Group by city
                $group: {
                    _id: "$location.city",
                    totalIssues: { $sum: 1 },
                    // Count only the open issues in this city
                    openIssues: {
                        $sum: { $cond: [{ $eq: ["$status", "OPEN"] }, 1, 0] }
                    },
                    // Count high priority issues
                    criticalIssues: {
                        $sum: { $cond: [{ $eq: ["$priority", "CRITICAL"] }, 1, 0] }
                    }
                }
            },
            { $sort: { totalIssues: -1 } } // Sort by most issues first
        ]);

        return res.status(200).json({
            success: true,
            message: "Location analytics fetched successfully",
            data: locationStats
        });

    } catch (err) {
        console.error('Server Error: Cannot fetch location analytics', err);
        return res.status(500).json({ success: false, message: "Server Error: Location analytics failed" });
    }
});


// OTHERS
// Sends a system-wide or location-specific notification via In-App and Email
adminRouter.post('/admin/broadcast', userAuth, adminAuth, async (req, res) => {
    try {
        const { title, message, targetCity } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: "Broadcast message is required" });
        }

        // 1. Find target users (we only need their IDs, the engine handles the rest)
        let userQuery = { "preferences.globalNotifications": true };
        if (targetCity) {
            userQuery["contact.city"] = targetCity;
        }

        const targetUsers = await User.find(userQuery).select('_id');

        if (targetUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: targetCity ? `No users found in ${targetCity}.` : "No users found."
            });
        }

        const finalMessage = title ? `**${title}**\n${message}` : message;

        // 2. Fetch the socket.io instance (assuming you attached it to req.app)
        const io = req.app.get('io');

        // 3. Fire the Notification Engine for every user in the background
        targetUsers.forEach(user => {
            triggerNotification({
                recipientId: user._id,
                senderId: req.userId, // The Admin's ID
                issueId: null, // Broadcasts aren't tied to a specific issue
                type: 'SYSTEM_BROADCAST',
                message: finalMessage,
                io: io
            }).catch(err => console.error(`Broadcast failed for user ${user._id}:`, err));
        });

        return res.status(200).json({
            success: true,
            message: `Broadcast is processing for ${targetUsers.length} users.`,
        });

    } catch (err) {
        console.error('Server Error: Cannot send broadcast', err);
        return res.status(500).json({ success: false, message: "Server Error: Cannot send broadcast" });
    }
});

// Fetch all inquiries from the landing page, sorted by newest first
adminRouter.get('/admin/inquiries', async (req, res) => {
    try {
        // 1. Grab optional query parameters for filtering and pagination
        // Example URL: /admin/inquiries?status=unread&page=1&limit=20
        const { status, page = 1, limit = 20 } = req.query;

        // 2. Build the database query
        const query = {};
        if (status) {
            // Ensure the admin passed a valid enum status before querying
            if (['unread', 'read', 'resolved'].includes(status)) {
                query.status = status;
            } else {
                return res.status(400).json({ success: false, message: "Invalid status filter" });
            }
        }

        // 3. Calculate how many documents to skip for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // 4. Run the queries in parallel (Fetch data + Count total for frontend math)
        const [inquiries, total] = await Promise.all([
            Inquiry.find(query)
                .sort({ createdAt: -1 }) // -1 puts the newest messages at the top
                .skip(skip)
                .limit(parseInt(limit)),
            Inquiry.countDocuments(query)
        ]);

        // 5. Send it all back
        return res.status(200).json({
            success: true,
            message: "Inquiries fetched successfully",
            data: {
                inquiries,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalInquiries: total,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (err) {
        console.error('Server Error: Cannot fetch inquiries', err);
        return res.status(500).json({
            success: false,
            message: "Server Error: Cannot fetch inquiries"
        });
    }
});

// Update Inquiry Status
adminRouter.patch('/admin/inquiry/:id', userAuth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Inquiry ID" });
        }

        const validStatuses = ['unread', 'read', 'resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status provided" });
        }

        const updatedInquiry = await Inquiry.findByIdAndUpdate(
            id,
            { $set: { status } },
            { new: true }
        );

        if (!updatedInquiry) {
            return res.status(404).json({ success: false, message: "Inquiry not found" });
        }

        return res.status(200).json({
            success: true,
            message: `Inquiry marked as ${status}`,
            data: updatedInquiry
        });

    } catch (err) {
        console.error('Server Error: Cannot update inquiry', err);
        return res.status(500).json({ success: false, message: "Server Error: Cannot update inquiry" });
    }
});

module.exports = adminRouter