const cron = require('node-cron');
const Issue = require('../src/models/Issue')
const { triggerNotification } = require('../src/utils/notificationService')

const startOrphanIssuesJob = (io) => {
    cron.schedule('0 0 * * *', async () => {
        console.log('\n========================================================');
        console.log(`⏳ [NIGHTLY CRON] Running Orphaning Sweep: ${new Date().toISOString()}`);
        console.log('========================================================');
        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const stagnantIssues = await Issue.find({
                status: 'OPEN',
                createdAt: { $lte: sevenDaysAgo },
                isDeleted: false
            });

            if (stagnantIssues.length === 0) {
                console.log('   ✅ No stagnant issues found today.');
                return;
            }

            console.log(`   ⚠️ Found ${stagnantIssues.length} issues to orphan.`);
            let orphanedCount = 0;

            for (const issue of stagnantIssues) {
                try {
                    issue.status = 'ORPHANED';
                    issue.statusHistory.push({ status: 'ORPHANED', remark: 'System automatically flagged issue as ORPHANED.' });
                    issue.auditLog.push({ action: 'AUTO_ORPHANED', details: '7-day inactivity threshold reached. Escalated to Admin.' });

                    await issue.save();
                    orphanedCount++;

                    if (io && issue.reportedBy) {
                        triggerNotification({
                            recipientId: issue.reportedBy,
                            senderId: null,
                            issueId: issue._id,
                            type: 'SYSTEM_BROADCAST',
                            message: `Your issue "${issue.title}" has been escalated to Admin Triage.`,
                            io: io
                        }).catch(err => console.error('Cron Notification Error:', err));
                    }
                } catch (issueErr) {
                    console.error(`   ❌ Failed to orphan issue ${issue._id}:`, issueErr);
                }
            }

            console.log(`🧹 [NIGHTLY CRON] Sweep Complete. Orphaned ${orphanedCount} issues.\n`);
        } catch (error) {
            console.error('❌ [NIGHTLY CRON] Critical error:', error);
        }
    });
    console.log("🟢 Nightly Orphan Sweeper initialized.");
};

module.exports = startOrphanIssuesJob;