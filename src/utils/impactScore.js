// utils/impactScore.js

const calculateImpactScore = (issue) => {
    // 1. EXTRACT DATA
    const shareCount = issue.shareCount || 0;
    const confirmationCount = issue.confirmationCount || 0;
    const flagCount = issue.flagCount || 0;
    const priority = issue.priority || 'LOW';

    // Fallback to Date.now() for brand new issues not yet saved to DB
    const creationTime = issue.createdAt ? new Date(issue.createdAt).getTime() : Date.now();

    // 2. PRIORITY BASE SCORE (0 to 100)
    let baseScore = 20;
    switch (priority) {
        case 'CRITICAL': baseScore = 70; break;
        case 'HIGH': baseScore = 50; break;
        case 'MEDIUM': baseScore = 30; break;
        case 'LOW': baseScore = 15; break;
    }

    // 3. STRICT FLAG PENALTY
    // Flags are community moderation. If flags >= confirmations, the issue loses massive credibility.
    let flagPenaltyMultiplier = 1.0;
    if (flagCount > 0) {
        const approvalVolume = confirmationCount + (shareCount * 0.5);
        if (flagCount > approvalVolume) {
            flagPenaltyMultiplier = 0.3; // 70% reduction in total score if highly flagged
        } else {
            // Slight reduction for minor flags
            flagPenaltyMultiplier = 1 - ((flagCount / (approvalVolume || 1)) * 0.2);
        }
    }

    // 4. ACTIVITY POINTS (Linear scaling)
    // Confirms show real-world presence (highly valued). Shares are digital (lower value).
    const activityPoints = (confirmationCount * 12) + (shareCount * 4);

    // 5. TIME DECAY (The older the issue, the lower the score unless activity is huge)
    const ageInHours = (Date.now() - creationTime) / (1000 * 60 * 60);
    // Formula: e^(-0.02 * ageInHours). Halves roughly every 35 hours.
    // Minimum decay floor is 0.4 so critical issues never drop completely to zero.
    const timeDecayFactor = Math.max(0.4, Math.exp(-0.02 * ageInHours));

    // 6. FINAL MATH
    let rawScore = (baseScore + activityPoints) * timeDecayFactor * flagPenaltyMultiplier;

    // Clamp the score strictly between 1 and 100
    return Math.min(Math.max(Math.round(rawScore), 1), 100);
};

module.exports = calculateImpactScore;