const calculateImpactScore = (issue) => {
    // 1. EXTRACT DATA
    const shareCount = issue.shareCount || 0;
    const confirmationCount = issue.confirmationCount || 0;
    const flagCount = issue.flagCount || 0;
    const priority = issue.priority || 'LOW';

    // 2. CONSTANTS
    const kShare = 5;
    const kConfirm = 7;
    const kFlag = 6;

    // 3. DIMINISHING RETURNS (0.0 to 1.0)
    // Maps count 0 -> 0, count k -> 0.5, count infinity -> 1.0
    const shareScore = shareCount / (shareCount + kShare);
    const confirmScore = confirmationCount / (confirmationCount + kConfirm);
    const flagScore = flagCount / (flagCount + kFlag);

    // 4. WEIGHTS
    const wShare = 0.2;
    const wConfirm = 0.4;
    const wFlag = 0.3;

    // 5. CALCULATE SOCIAL SCORE (Normalized 0 to 1)
    // We subtract flags because in your model, flags = spam/fake.
    let weightedSum = (wShare * shareScore) + (wConfirm * confirmScore) - (wFlag * flagScore);

    // Normalize by max positive potential (0.6)
    const maxPositiveWeight = wShare + wConfirm;
    let socialScore = weightedSum / maxPositiveWeight;

    // Clamp Social Score between 0 and 1
    socialScore = Math.min(Math.max(socialScore, 0), 1);

    // 6. PRIORITY BASE SCORE (0 to 100)
    // Critical issues get a head start regardless of social activity
    let priorityBase = 0;
    switch (priority) {
        case 'CRITICAL': priorityBase = 80; break; // Starts very high
        case 'HIGH': priorityBase = 60; break;
        case 'MEDIUM': priorityBase = 40; break;
        case 'LOW': priorityBase = 20; break;
        default: priorityBase = 20;
    }

    // 7. FINAL BLEND
    // Formula: Base Priority + (Remaining Room * SocialScore)
    // E.g. Critical (80) has 20 points of "room" to grow via social proof.
    // E.g. Low (20) has 80 points of "room" to grow if it goes viral.

    const remainingRoom = 100 - priorityBase;
    const finalScore = priorityBase + (remainingRoom * socialScore);

    return Math.round(finalScore);
};

module.exports = calculateImpactScore;