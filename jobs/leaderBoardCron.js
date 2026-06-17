const cron = require('node-cron');
const User = require('../src/models/User'); // Adjust path to your User model
const LeaderBoard = require('../src/models/LeaderBoard'); // Adjust path to your Leaderboard model
const triggerNotification = require('../src/utils/notificationService'); // Adjust path

/**
 * 🏆 THE LEADERBOARD ENGINE
 * Runs every Monday at 8:00 PM IST to freeze the ranks and notify the district.
 */
const startLeaderboardCron = (io) => {
    // Cron string: '0 20 * * 1' -> 20:00 (8 PM) on Monday (Day 1)
    cron.schedule('0 20 * * 1', async () => {
        console.log(`\n========================================================`);
        console.log(`🏆 [LEADERBOARD CRON] Compiling Weekly Ranks: ${new Date().toISOString()}`);
        console.log(`========================================================`);

        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        try {
            // =========================================================================
            // 1. CALCULATE TOP CITIZENS
            // =========================================================================
            const topCitizens = await User.find({ role: 'user', accountStatus: 'ACTIVE' })
                .sort({ civilScore: -1, issuesResolved: -1 }) // Tie-breaker is issues resolved
                .limit(100)
                .lean();

            const formattedCitizens = topCitizens.map((user, index) => ({
                userId: user._id,
                rank: index + 1,
                csi: user.civilScore || 0,
                activeScore: user.issuesReported || 0, // Using reported issues as activity metric
                isHero: index === 0 // #1 Citizen is the Hero
            }));

            // =========================================================================
            // 2. CALCULATE TOP AUTHORITIES & NGOs
            // =========================================================================
            const topAuthorities = await User.find({
                role: { $in: ['official', 'ngo'] },
                accountStatus: 'ACTIVE'
            })
                .sort({ 'authorityProfile.csiScore': -1, 'authorityProfile.jobsCompleted': -1 })
                .limit(100)
                .lean();

            const formattedAuthorities = topAuthorities.map((user, index) => ({
                userId: user._id,
                rank: index + 1,
                csi: user.authorityProfile?.csiScore || 0,
                activeScore: user.authorityProfile?.jobsCompleted || 0,
                isHero: index === 0 // #1 Authority is the Hero
            }));

            // =========================================================================
            // 3. SAVE THE SNAPSHOT
            // =========================================================================
            const newLeaderboard = new LeaderBoard({
                periodStart: oneWeekAgo,
                periodEnd: now,
                type: 'WEEKLY',
                citizens: formattedCitizens,
                authorities: formattedAuthorities
            });

            await newLeaderboard.save();
            console.log(`   ✅ Snapshot Saved! Citizens: ${formattedCitizens.length} | Authorities: ${formattedAuthorities.length}`);

            // =========================================================================
            // 4. DISTRICT-WIDE NOTIFICATIONS
            // =========================================================================
            console.log(`   📢 Broadcasting real-time alerts to the district...`);

            // We fetch just the IDs of active users to keep memory usage extremely low
            const allActiveUsers = await User.find({ accountStatus: 'ACTIVE' }).select('_id');

            let notifiedCount = 0;
            for (const user of allActiveUsers) {
                try {
                    await triggerNotification({
                        recipientId: user._id,
                        senderId: user._id, // Passing self as sender to bypass 'sender missing' DB errors if it's a required field, or use a system Admin ID
                        issueId: null, // No specific issue attached
                        type: 'SYSTEM_BROADCAST',
                        message: '🏆 The new Weekly District Leaderboard is live! Check your current ranking now.',
                        io: io
                    });
                    notifiedCount++;
                } catch (err) {
                    console.error(`   ❌ Failed to notify user ${user._id}:`, err.message);
                }
            }

            console.log(`   🚀 Successfully notified ${notifiedCount} users.`);
            console.log(`========================================================\n`);

        } catch (error) {
            console.error('❌ [LEADERBOARD CRON] Critical error generating snapshot:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Guarantees 8 PM IST regardless of server location
    });

    console.log("🟢 LocalAwaaz Leaderboard Engine initialized. Awaiting Monday 8 PM IST.");
};

module.exports = startLeaderboardCron;