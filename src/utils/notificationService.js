// utils/notificationService.js
const { sendMail } = require('../config/sendOtp');
const Notification = require('../models/Notification'); // We will create this schema next
const User = require('../models/User');

/**
 * Core Engine for Routing Notifications
 */
const triggerNotification = async ({ recipientId, senderId, issueId, type, message, io }) => {
    try {
        // 1. Prevent users from notifying themselves (e.g., commenting on their own issue)
        if (recipientId.toString() === senderId.toString()) return;

        // 2. ALWAYS save to the Database FIRST so they have a history for the Bell Icon
        const newNotification = await Notification.create({
            recipient: recipientId,
            sender: senderId,
            issue: issueId,
            type: type,
            message: message
        });

        // 3. Check the User's Master Valve Settings
        const user = await User.findById(recipientId).select('preferences contact.email');
        if (!user || user.preferences?.globalNotifications === false) {
            // Notifications are explicitly muted by this user. Stop here.
            return;
        }

        // 4. The Online Presence Check via Socket.io
        let isOnline = false;
        if (io) {
            // .fetchSockets() looks inside the user's private room to see if they are active
            const userSockets = await io.in(recipientId.toString()).fetchSockets();
            isOnline = userSockets.length > 0;
        }

        // 5. The Routing Logic (Socket vs. Email)
        if (isOnline) {
            // ONLINE: Only push the red badge to the UI. DO NOT send an email.
            io.to(recipientId.toString()).emit('receive_notification', newNotification);
            console.log(`[SOCKET] Real-time alert sent to online user: ${recipientId}`);
        } else {
            // OFFLINE: Evaluate for Brevo Email
            const highPriorityEmailTypes = [
                'ISSUE_CONFIRMED',
                'ISSUE_RESOLVED',
                'ISSUE_REJECTED',
                'ISSUE_IN_REVIEW',
                'NEW_COMMENT',
                'COMMENT_REPLY',
                'SYSTEM_BROADCAST',
                'ISSUE_FLAGGED',
                'ACCOUNT_SUSPENDED',
                'ACCOUNT_BANNED',
                'ACCOUNT_RESTORED'
            ];

            if (highPriorityEmailTypes.includes(type)) {
                // TODO: Hook up your Brevo API function here
                // await sendBrevoEmail(user.email, "New Update on LocalAwaaz", message);
                const targetEmail = user.contact?.email;
                if (targetEmail) {
                    await sendMail({
                        email: targetEmail,
                        purpose: "NOTIFICATION",
                        notificationData: { type, message, issueId }
                    });
                    console.log(`[EMAIL] Brevo triggered for offline user: ${targetEmail}`);
                }
                else {
                    console.log(`[Email] Brevo triggered for offline user: ${targetEmail}`);
                }
            }
        }
    } catch (error) {
        console.error("Failed to trigger notification in Engine:", error);
    }
};

module.exports = triggerNotification;