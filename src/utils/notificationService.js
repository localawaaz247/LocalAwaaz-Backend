// utils/notificationService.js
const { sendMail } = require('../config/sendOtp');
const Notification = require('../models/Notification');
const User = require('../models/User');
const admin = require('../config/firebaseAdmin');

/**
 * Core Engine for Routing Notifications
 */
const triggerNotification = async ({ recipientId, senderId, issueId, type, message, io }) => {
    try {
        // 1. Prevent users from notifying themselves
        if (recipientId.toString() === senderId.toString()) return;

        // 2. ALWAYS save to the Database FIRST 
        // This ensures they always have a written record in the in-app notification section
        const newNotification = await Notification.create({
            recipient: recipientId,
            sender: senderId,
            issue: issueId,
            type: type,
            message: message
        });

        // 3. Fetch User Details
        // NOTE: We removed the globalNotifications check from here because 
        // it only applies to Emails, not In-App or FCM pushes.
        const user = await User.findById(recipientId).select('preferences contact.email fcmToken');
        if (!user) return;

        // 4. Check Online Presence FIRST via Socket.io
        let isOnline = false;
        if (io) {
            const userSockets = await io.in(recipientId.toString()).fetchSockets();
            isOnline = userSockets.length > 0;
        }

        // 5. The Routing Logic
        if (isOnline) {
            // SCENARIO 1: ONLINE. Only push to the UI. Do NOT send FCM or Email.
            io.to(recipientId.toString()).emit('receive_notification', newNotification);
            console.log(`[SOCKET] Real-time alert sent to online user: ${recipientId}.`);
            return; // Stops execution here.
        }

        // SCENARIO 2: OFFLINE. Try FCM First.
        let fcmSuccess = false;

        if (user.fcmToken) {
            try {
                const fcmMessage = {
                    notification: { title: "LocalAwaaz Update", body: message },
                    token: user.fcmToken,
                    android: {
                        notification: {
                            channelId: 'localawaaz_custom_alerts', // Must match frontend ID
                            sound: 'ting', // IMPORTANT: No .mp3 extension here!
                        }
                    }
                };

                // We AWAIT the FCM call to guarantee we know if it succeeded or failed
                await admin.messaging().send(fcmMessage);
                console.log(`[FCM-SUCCESS] Push sent to offline user: ${user._id}`);
                fcmSuccess = true; // FCM worked, flip the flag

            } catch (err) {
                console.error(`[FCM-FAILURE] Push failed: ${err.message}`);
                fcmSuccess = false; // FCM failed
            }
        } else {
            console.log(`[FCM-SKIP] No FCM token found for user: ${user._id}`);
        }

        // SCENARIO 3: FCM FAILED / NO TOKEN. Fallback to Email.
        if (!fcmSuccess) {
            // Master valve check ONLY for emails
            if (user.preferences?.globalNotifications === false) {
                console.log(`[EMAIL-SKIP] Email notifications disabled by user: ${user._id}`);
                return;
            }

            const highPriorityEmailTypes = [
                'ISSUE_CONFIRMED',
                'ISSUE_LOCKED',
                'ISSUE_RESOLVED',
                'ISSUE_REJECTED',
                'ISSUE_DISPUTED',
                'ISSUE_ORPHANED',
                'ISSUE_IN_REVIEW',
                'ISSUE_REJECTED',
                'NEW_COMMENT',
                'COMMENT_REPLY',
                'SYSTEM_BROADCAST',
                'ISSUE_FLAGGED',
                'ACCOUNT_SUSPENDED',
                'ACCOUNT_BANNED',
                'ACCOUNT_RESTORED',
                'AUTHORITY_APPROVED',
                'AUTHORITY_REJECTED',
                'AUTHORITY_REVERTED',
                'NEW_AUTHORITY_APPLICATION'
            ];

            if (highPriorityEmailTypes.includes(type)) {
                const targetEmail = user.contact?.email;
                if (targetEmail) {
                    await sendMail({
                        email: targetEmail,
                        purpose: "NOTIFICATION",
                        notificationData: { type, message, issueId }
                    });
                    console.log(`[EMAIL-FALLBACK] Brevo triggered for offline user: ${targetEmail}`);
                } else {
                    console.log(`[EMAIL-SKIP] Missing email address for offline user: ${user._id}`);
                }
            }
        }

    } catch (error) {
        console.error("Failed to trigger notification in Engine:", error);
    }
};

module.exports = triggerNotification;