// utils/gamification.js
const User = require("../models/User");

// 1. EXPONENTIAL SCALING
// Notice how the gap between ranks gets aggressively larger.
const RANKS = [
    { level: 1, name: "Citizen", threshold: 0, icon: "👤", privilege: "Basic Reporting" },
    { level: 2, name: "Activist", threshold: 50, icon: "🔥", privilege: "Flagging Rights" },
    { level: 3, name: "Community Leader", threshold: 300, icon: "⭐", privilege: "Verification Weight x2" },
    { level: 4, name: "Civic Hero", threshold: 1200, icon: "🏅", privilege: "Dispute Official Rulings" },
    { level: 5, name: "Legend", threshold: 5000, icon: "👑", privilege: "Direct Authority Escalation" }
];

/**
 * Checks and updates a user's rank based on their current civil score.
 * Handles both Leveling Up AND Demotions.
 */
const checkAndAssignRank = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) return;

        const currentScore = user.civilScore;
        let targetRank = RANKS[0];

        // Find the highest rank they currently qualify for
        for (let i = RANKS.length - 1; i >= 0; i--) {
            if (currentScore >= RANKS[i].threshold) {
                targetRank = RANKS[i];
                break;
            }
        }

        // 2. DETECT RANK CHANGES (Up or Down)
        if (user.rank !== targetRank.name) {
            const currentRankIndex = RANKS.findIndex(r => r.name === user.rank);
            const newRankIndex = RANKS.findIndex(r => r.name === targetRank.name);

            if (newRankIndex > currentRankIndex) {
                // 🟢 PROMOTION
                console.log(`[Gamification] 🆙 User ${user.name} leveled up to ${targetRank.name}!`);

                // Add the Badge to history if they don't have it yet
                const alreadyHasBadge = user.badges.some(b => b.name === targetRank.name);
                if (!alreadyHasBadge) {
                    user.badges.push({
                        name: targetRank.name,
                        description: `Reached ${currentScore} Civil Points`,
                        icon: targetRank.icon || "🏆",
                        earnedAt: new Date()
                    });
                }
            } else {
                // 🔴 DEMOTION
                console.log(`[Gamification] 🔻 User ${user.name} demoted to ${targetRank.name} due to score drop.`);
                // Note: We usually let them keep the badge in their array as a "historical achievement", 
                // but their active `user.rank` is dropped so they lose the privileges.
            }

            user.rank = targetRank.name;
            await user.save();

            return {
                rankChanged: true,
                isPromotion: newRankIndex > currentRankIndex,
                newRank: targetRank.name
            };
        }

        return { rankChanged: false };

    } catch (error) {
        console.error("Error in Gamification System:", error);
    }
};

/**
 * 3. INACTIVITY DECAY SYSTEM
 * Reduces civil score for inactive users.
 * Call this function via a daily Cron Job (e.g., node-cron)
 */
const applyInactivityDecay = async () => {
    try {
        console.log("[Gamification] Running daily inactivity decay check...");
        const INACTIVITY_THRESHOLD_DAYS = 30; // Start losing points after 30 days
        const DECAY_PERCENTAGE = 0.05; // Lose 5% of your score

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_THRESHOLD_DAYS);

        // Find users whose last login was BEFORE the cutoff date AND who have a score > 10
        const inactiveUsers = await User.find({
            lastLoginAt: { $lt: cutoffDate },
            civilScore: { $gt: 10 }
        });

        for (const user of inactiveUsers) {
            // Calculate penalty (Minimum drop of 2 points, otherwise 5% of their total)
            const penalty = Math.max(2, Math.floor(user.civilScore * DECAY_PERCENTAGE));

            user.civilScore -= penalty;
            await user.save();

            // Check if this point loss results in a demotion
            await checkAndAssignRank(user._id);
        }

        console.log(`[Gamification] Applied decay penalty to ${inactiveUsers.length} inactive users.`);
    } catch (error) {
        console.error("Error in Decay System:", error);
    }
};

module.exports = { checkAndAssignRank, applyInactivityDecay, RANKS };