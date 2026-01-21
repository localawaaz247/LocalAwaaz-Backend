const calculateImpactScore = (issue) => {
    const shareCount = issue.shareCount || 0;
    const confirmationCount = issue.confirmationCount || 0;
    const flagCount = issue.flagCount || 0;

    const kShare = 5;
    const kConfirm = 7;
    const kFlag = 6;

    // Diminishing returns (0.0 to 1.0)
    const shareScore = shareCount / (shareCount + kShare);
    const confirmScore = confirmationCount / (confirmationCount + kConfirm);
    const flagScore = flagCount / (flagCount + kFlag);

    const wShare = 0.2;
    const wConfirm = 0.4;
    const wFlag = 0.3;

    // Calculate Weighted Sum
    let weightedSum = (wShare * shareScore) + (wConfirm * confirmScore) - (wFlag * flagScore);

    // Normalize: Divide by sum of positive weights (0.6)
    const maxPositiveWeight = wShare + wConfirm; 
    let normalizedScore = weightedSum / maxPositiveWeight;

    // Clamp between 0 and 1
    normalizedScore = Math.min(Math.max(normalizedScore, 0), 1);

    // Scale to 0-100
    // Simply multiply by 100. Much cleaner.
    return Math.round(normalizedScore * 100);
};
module.exports = calculateImpactScore