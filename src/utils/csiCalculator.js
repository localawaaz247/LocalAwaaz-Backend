/**
 * Centralized Configuration for the Civil/Civic Score Index (CSI)
 * Adjust these values to rebalance the system's rewards and penalties.
 */
const CSI_RULES = {
    DEFAULT_REWARD: 50,      // Base points for resolving a standard issue
    TIMEOUT_PENALTY: -50,    // Penalty for missing a deadline
    GHOST_PENALTY: -100,     // Penalty for abandoning a job entirely
    BASE_IMPACT_MULTIPLIER: 1 // Optional: For future use if you want to multiply impact scores
};

/**
 * Calculates the reward for successfully resolving an issue.
 * @param {Number} impactScore - The impact score of the specific issue
 * @returns {Number} The calculated points to be sent to Escrow
 */
const calculateCsiReward = (impactScore) => {
    // If the issue has an impact score, use it. Otherwise, fallback to the default reward.
    return (impactScore && impactScore > 0)
        ? impactScore * CSI_RULES.BASE_IMPACT_MULTIPLIER
        : CSI_RULES.DEFAULT_REWARD;
};

/**
 * Retrieves the specific penalty value based on the infraction type.
 * @param {String} type - 'TIMEOUT' or 'GHOST'
 * @returns {Number} The negative point value
 */
const getCsiPenalty = (type) => {
    if (type === 'TIMEOUT') return CSI_RULES.TIMEOUT_PENALTY;
    if (type === 'GHOST') return CSI_RULES.GHOST_PENALTY;
    return 0;
};

module.exports = {
    CSI_RULES,
    calculateCsiReward,
    getCsiPenalty
};