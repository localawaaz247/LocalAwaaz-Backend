const cron = require('node-cron');
const User = require('../src/models/User');
const { triggerNotification } = require('../src/utils/notificationService'); // Adjust path if needed
const Issue = require('../src/models/Issue');

/**
 * Initializes the background cron jobs for the LocalAwaaz Marketplace
 * @param {Object} io - The Socket.io instance for real-time notifications
 */
const startAccountabilityCron = (io) => {
    // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00)
    cron.schedule('0 * * * *', async () => {
        console.log("🕒 Running Accountability Cron Job...");
        const now = new Date();

        try {
            // ==========================================
            // TASK 1: AUTO-DISPUTE (No Bids in 24h)
            // ==========================================
            const expiredOpenIssues = await Issue.updateMany(
                {
                    status: 'OPEN',
                    'bidding.windowEndsAt': { $lte: now },
                    'bidding.winningBid': null
                },
                {
                    $set: {
                        status: 'DISPUTED',
                        adminRemark: 'Auto-escalated: No bids received within 24 hours.'
                    }
                }
            );

            if (expiredOpenIssues.modifiedCount > 0) {
                console.log(`⚠️ Escalated ${expiredOpenIssues.modifiedCount} ignored issues to Admin.`);
            }

            // ==========================================
            // TASK 2: PENALIZE FAILED COMMITMENTS
            // ==========================================
            const failedIssues = await Issue.find({
                status: { $in: ['LOCKED', 'IN_PROGRESS'] },
                'workCycle.commitmentDeadline': { $lte: now }
            });

            for (let issue of failedIssues) {
                const authorityId = issue.bidding.winningBid.authorityId;

                // 1. Strip the job from the authority and open it back up
                issue.status = 'OPEN';
                issue.bidding.winningBid = null;
                issue.workCycle.commitmentDeadline = null;

                issue.auditLog.push({
                    action: "SYSTEM_FAILED_JOB",
                    performedBy: null, // System Action
                    details: "Authority failed to meet the deadline. Job released and penalized."
                });

                await issue.save();

                // 2. Deduct CSI Points and log the failure
                await User.findByIdAndUpdate(authorityId, {
                    $inc: {
                        'authorityProfile.jobsFailed': 1,
                        'authorityProfile.csiScore': -100 // Heavy penalty
                    }
                });

                // 3. Notify the Authority of their failure
                try {
                    triggerNotification({
                        recipientId: authorityId,
                        senderId: null, // System
                        issueId: issue._id,
                        type: 'JOB_FAILED',
                        message: `You missed the deadline for issue: "${issue.title}". Your CSI score has been penalized by 100 points and the job was released back to the marketplace.`,
                        io: io
                    });
                } catch (notificationError) {
                    console.error(`Failed to send penalty notification to ${authorityId}:`, notificationError);
                }

                console.log(`❌ Penalized Authority ${authorityId} for missing deadline on Issue ${issue._id}`);
            }

        } catch (err) {
            console.error("Accountability Cron Job Error:", err);
        }
    });

    console.log("✅ Accountability Cron Job initialized.");
};

module.exports = startAccountabilityCron;