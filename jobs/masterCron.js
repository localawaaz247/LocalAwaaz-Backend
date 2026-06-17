const cron = require('node-cron');
const Issue = require('../src/models/Issue')
const User = require('../src/models/User');
const { triggerNotification } = require('../src/utils/notificationService');

/**
 * 🚀 THE MASTER STATE ENGINE
 * Runs every minute to enforce auctions, deadlines, handovers, and escrows.
 */
const startMasterCron = (io) => {
    cron.schedule('* * * * *', async () => {
        console.log(`\n========================================================`);
        console.log(`⏱️  [MASTER CRON] Heartbeat Initiated: ${new Date().toISOString()}`);
        console.log(`========================================================`);
        const now = new Date();

        try {
            // =========================================================================
            // TASK 1: THE ORPHAN SWEEPER (7-Day Stagnation)
            // =========================================================================
            console.log(`🔍 [TASK 1] Sweeping for unbidded issues older than 7 days...`);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            const stagnantIssues = await Issue.find({
                status: 'OPEN',
                createdAt: { $lte: sevenDaysAgo },
                'bidding.auctionStartsAt': { $exists: false }
            });

            if (stagnantIssues.length > 0) {
                console.log(`   🚨 Found ${stagnantIssues.length} issues to ORPHAN.`);
                for (const issue of stagnantIssues) {
                    try {
                        issue.status = 'ORPHANED';
                        issue.statusHistory.push({ status: 'ORPHANED', remark: 'System escalated to Admin Triage (7 days inactive).' });
                        issue.auditLog.push({ action: 'AUTO_ORPHANED', details: 'No bids received in 7 days.' });
                        await issue.save();
                        console.log(`   ➡️  Issue [${issue._id}] moved to ORPHANED.`);

                        if (io && issue.reportedBy) {
                            triggerNotification({
                                recipientId: issue.reportedBy,
                                type: 'SYSTEM_BROADCAST',
                                message: `Your issue "${issue.title}" has been escalated to the Admin Triage Center due to local inactivity.`,
                                io
                            });
                        }
                    } catch (err) { console.error(`   ❌ Error orphaning issue ${issue._id}:`, err); }
                }
            } else {
                console.log(`   ✅ No stagnant issues found.`);
            }

            // =========================================================================
            // TASK 2: THE AUCTION CLOSER (Locking the 24h Window)
            // =========================================================================
            console.log(`🔍 [TASK 2] Checking for expired 24h auctions...`);
            const closingAuctions = await Issue.find({
                status: 'OPEN',
                'bidding.auctionEndsAt': { $lte: now }
            });

            if (closingAuctions.length > 0) {
                console.log(`   🔨 Closing ${closingAuctions.length} active auctions.`);
                for (const issue of closingAuctions) {
                    try {
                        const winnerId = issue.bidding.winningBid.authorityId;
                        const commitHours = issue.bidding.winningBid.commitmentTimeHours;

                        issue.status = 'LOCKED';
                        issue.workCycle.commitmentDeadline = new Date(now.getTime() + commitHours * 60 * 60 * 1000);
                        issue.statusHistory.push({ status: 'LOCKED', remark: 'Auction closed. Official allotted.' });
                        issue.auditLog.push({ action: 'AUCTION_WON', performedBy: winnerId, details: `Won with ${commitHours}h bid.` });

                        await issue.save();
                        console.log(`   🏆 Auction [${issue._id}] LOCKED. Winner: ${winnerId} (${commitHours}h)`);

                        if (io) {
                            triggerNotification({
                                recipientId: winnerId,
                                type: 'JOB_ALLOTTED',
                                message: `You won the auction for "${issue.title}"! You have ${commitHours} hours to resolve it.`,
                                io
                            });
                        }
                    } catch (err) { console.error(`   ❌ Error closing auction ${issue._id}:`, err); }
                }
            } else {
                console.log(`   ✅ No auctions to close.`);
            }

            // =========================================================================
            // TASK 3: THE DEADLINE ENFORCER (Timeout -> Awaiting Handover)
            // =========================================================================
            console.log(`🔍 [TASK 3] Auditing active job deadlines...`);
            const missedDeadlines = await Issue.find({
                status: 'LOCKED',
                'workCycle.commitmentDeadline': { $lte: now },
                'workCycle.isClockPaused': false
            });

            if (missedDeadlines.length > 0) {
                console.log(`   ⚠️ Found ${missedDeadlines.length} missed deadlines! Executing penalties.`);
                for (const issue of missedDeadlines) {
                    try {
                        const authorityId = issue.bidding.winningBid.authorityId;

                        issue.status = 'AWAITING_HANDOVER';
                        issue.workCycle.ghostTimerExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                        issue.statusHistory.push({ status: 'AWAITING_HANDOVER', remark: 'Official missed deadline.' });

                        await issue.save();

                        await User.findByIdAndUpdate(authorityId, {
                            $inc: { 'authorityProfile.csiScore': -50, 'authorityProfile.jobsFailed': 1 }
                        });

                        console.log(`   📉 Penalized official [${authorityId}] -50 CSI for issue [${issue._id}]. Handover timer started.`);

                        if (io) {
                            triggerNotification({
                                recipientId: authorityId,
                                type: 'URGENT',
                                message: `Deadline MISSED for "${issue.title}". You lost 50 CSI points. You MUST submit a Handover Report to unlock your account.`,
                                io
                            });
                        }
                    } catch (err) { console.error(`   ❌ Error enforcing deadline ${issue._id}:`, err); }
                }
            } else {
                console.log(`   ✅ All active jobs are within deadlines.`);
            }

            // =========================================================================
            // TASK 4: THE GHOST PROTOCOL (Ignored Handover -> Massive Penalty)
            // =========================================================================
            console.log(`🔍 [TASK 4] Scanning for ignored handover reports (Ghost Protocol)...`);
            const ghosts = await Issue.find({
                status: 'AWAITING_HANDOVER',
                'workCycle.ghostTimerExpiresAt': { $lte: now }
            });

            if (ghosts.length > 0) {
                console.log(`   💣 DETONATING GHOST PROTOCOL ON ${ghosts.length} ISSUES.`);
                for (const issue of ghosts) {
                    try {
                        const authorityId = issue.bidding.winningBid.authorityId;

                        await User.findByIdAndUpdate(authorityId, {
                            $inc: {
                                'authorityProfile.csiScore': -100,
                                'authorityProfile.activeJobsCount': -1,
                                'authorityProfile.jobsFailed': 1
                            }
                        });

                        issue.status = 'OPEN';
                        issue.bidding = { auctionStartsAt: null, auctionEndsAt: null, bids: [], winningBid: null };
                        issue.workCycle = {};
                        issue.statusHistory.push({ status: 'OPEN', remark: 'Previous official abandoned job. Returned to auction.' });
                        issue.auditLog.push({ action: 'GHOST_ABANDONMENT', performedBy: authorityId, details: 'Failed to submit handover report.' });

                        await issue.save();
                        console.log(`   💀 Official [${authorityId}] ghosted. -100 CSI. Issue [${issue._id}] returned to open market.`);

                        if (io) {
                            triggerNotification({
                                recipientId: authorityId,
                                type: 'CRITICAL',
                                message: `GHOST PROTOCOL ACTIVATED: You abandoned a failed job. You have been penalized 100 CSI points.`,
                                io
                            });
                        }
                    } catch (err) { console.error(`   ❌ Error executing ghost protocol ${issue._id}:`, err); }
                }
            } else {
                console.log(`   ✅ No ghosting detected.`);
            }

            // =========================================================================
            // TASK 5: THE ESCROW RELEASER (Auto-Verify after 72 Hours)
            // =========================================================================
            console.log(`🔍 [TASK 5] Checking for matured CSI Escrows...`);
            const ripeEscrows = await Issue.find({
                status: 'RESOLVED',
                'workCycle.escrow.isEscrowActive': true,
                'workCycle.escrow.autoReleaseAt': { $lte: now },
                'workCycle.escrow.citizenVerdict': 'PENDING'
            });

            if (ripeEscrows.length > 0) {
                console.log(`   💰 Releasing ${ripeEscrows.length} Escrows to officials.`);
                for (const issue of ripeEscrows) {
                    try {
                        const authorityId = issue.bidding.winningBid.authorityId;
                        const escrowPoints = issue.workCycle.escrow.pointsHolding;

                        await User.findByIdAndUpdate(authorityId, {
                            $inc: {
                                'authorityProfile.csiScore': escrowPoints,
                                'authorityProfile.csiInEscrow': -escrowPoints
                            }
                        });

                        issue.workCycle.escrow.isEscrowActive = false;
                        issue.workCycle.escrow.citizenVerdict = 'ACCEPTED';
                        issue.auditLog.push({ action: 'ESCROW_RELEASED', details: `72h expired. ${escrowPoints} points auto-released.` });

                        await issue.save();
                        console.log(`   💸 Released ${escrowPoints} points to Official [${authorityId}] for Issue [${issue._id}].`);

                        if (io) {
                            triggerNotification({
                                recipientId: authorityId,
                                type: 'REWARD',
                                message: `Escrow Cleared: ${escrowPoints} CSI points have been credited to your account for "${issue.title}".`,
                                io
                            });
                        }
                    } catch (err) { console.error(`   ❌ Error releasing escrow ${issue._id}:`, err); }
                }
            } else {
                console.log(`   ✅ No escrows ready for release.`);
            }

            console.log(`========================================================\n`);

        } catch (masterError) {
            console.error('❌ [CRON] Critical error in Master State Engine:', masterError);
        }
    });

    console.log("🟢 LocalAwaaz Master State Engine initialized. Monitoring all timelines.");
};

module.exports = startMasterCron;