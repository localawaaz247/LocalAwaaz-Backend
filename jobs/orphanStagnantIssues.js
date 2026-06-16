const cron = require('node-cron');
const Issue = require('../src/models/Issue')
const triggerNotification = require('../src/utils/notificationService')

const startOrphanIssuesJob = (io) => {
    // Runs every night at Midnight (00:00) server time
    cron.schedule('0 0 * * *', async () => {
        console.log('⏳ [CRON] Running nightly sweep: Orphaning stagnant issues...');
        try {
            // Calculate exactly 7 days ago
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            // Find issues that are still OPEN, older than 7 days, and not deleted
            const stagnantIssues = await Issue.find({
                status: 'OPEN',
                createdAt: { $lte: sevenDaysAgo },
                isDeleted: false
            });

            if (stagnantIssues.length === 0) {
                console.log('✅ [CRON] No stagnant issues found today.');
                return;
            }

            let orphanedCount = 0;

            for (const issue of stagnantIssues) {
                try {
                    issue.status = 'ORPHANED';

                    // Log the status change
                    issue.statusHistory.push({
                        status: 'ORPHANED',
                        remark: 'System automatically flagged issue as ORPHANED due to 7 days of marketplace inactivity.'
                    });

                    // Log the backend action
                    issue.auditLog.push({
                        action: 'AUTO_ORPHANED',
                        details: '7-day inactivity threshold reached. Escalated to Admin Triage.'
                    });

                    await issue.save();
                    orphanedCount++;

                    // Fire a notification to the Citizen 
                    if (io && issue.reportedBy) {
                        triggerNotification({
                            recipientId: issue.reportedBy,
                            senderId: null, // Null senderId = System broadcast
                            issueId: issue._id,
                            type: 'SYSTEM_BROADCAST',
                            message: `Your issue "${issue.title}" has been automatically escalated to the Admin Triage Center due to local inactivity. We are prioritizing it.`,
                            io: io
                        }).catch(err => console.error('Cron Notification Error:', err));
                    }
                } catch (issueErr) {
                    console.error(`❌ [CRON] Failed to orphan issue ${issue._id}:`, issueErr);
                }
            }

            console.log(`🧹 [CRON] Sweep Complete. Successfully orphaned ${orphanedCount} issues.`);
        } catch (error) {
            console.error('❌ [CRON] Critical error in nightly orphaning job:', error);
        }
    });
};

module.exports = startOrphanIssuesJob;