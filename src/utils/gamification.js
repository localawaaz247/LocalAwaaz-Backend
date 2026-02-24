// utils/gamification.js
const User = require("../models/User");

const RANKS = [
    { name: "Citizen", threshold: 0 },
    { name: "Activist", threshold: 100, icon: "🔥" },
    { name: "Community Leader", threshold: 500, icon: "⭐" },
    { name: "Civic Hero", threshold: 1000, icon: "🏅" },
    { name: "Legend", threshold: 5000, icon: "👑" }
];

/**
 * Checks and updates a user's rank based on their civil score.
 * Call this function AFTER adding points to a user.
 */
const checkAndAssignRank = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) return;

        const currentScore = user.civilScore;
        let newRank = "Citizen";
        let earnedBadge = null;

        // 1. Determine the highest rank they qualify for
        for (let i = RANKS.length - 1; i >= 0; i--) {
            if (currentScore >= RANKS[i].threshold) {
                newRank = RANKS[i].name;
                earnedBadge = RANKS[i]; // Store metadata for the badge
                break;
            }
        }

        // 2. If their rank has changed (Level Up!)
        if (user.rank !== newRank) {
            console.log(`[Gamification] 🆙 User ${user.name} leveled up to ${newRank}!`);

            user.rank = newRank;

            // 3. Add the Badge to history if they don't have it yet
            const alreadyHasBadge = user.badges.some(b => b.name === newRank);
            if (!alreadyHasBadge) {
                user.badges.push({
                    name: newRank,
                    description: `Reached ${currentScore} Civil Points`,
                    icon: earnedBadge.icon || "🏆",
                    earnedAt: new Date()
                });
            }

            await user.save();
            return { leveledUp: true, newRank: newRank };
        }

        return { leveledUp: false };

    } catch (error) {
        console.error("Error in Gamification System:", error);
    }
};

module.exports = { checkAndAssignRank };