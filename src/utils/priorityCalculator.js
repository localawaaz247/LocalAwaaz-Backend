// utils/priorityCalculator.js

const calculateDynamicPriority = (category, userCivilScore, isAnonymous) => {
    // 1. Base weights for categories (0-100 scale)
    const categoryWeights = {
        SAFETY: 80,
        HEALTH: 80,
        CORRUPTION: 80,
        WATER_SUPPLY: 60,
        ELECTRICITY: 60,
        EDUCATION: 60,
        SANITATION: 60,
        "ROAD_&_POTHOLES": 40,
        GARBAGE: 40,
        STREET_LIGHTS: 40,
        TRAFFIC: 40,
        DEFAULT: 20
    };

    let score = categoryWeights[category.toUpperCase()] || categoryWeights.DEFAULT;

    // 2. Trust Factor: Reporter's Reliability (Civil Score)
    // Highly trusted citizens get their issues bumped up. Spam/low score accounts get penalized.
    if (userCivilScore >= 100) score += 15;
    else if (userCivilScore >= 50) score += 5;
    else if (userCivilScore < 10) score -= 15; // Low trust threshold

    // 3. Accountability Factor
    // Anonymous reports are treated with slightly less initial urgency to prevent panic/spam
    if (isAnonymous) {
        score -= 10;
    }

    // 4. Map final score back to Enums
    if (score >= 75) return 'CRITICAL';
    if (score >= 55) return 'HIGH';
    if (score >= 35) return 'MEDIUM';
    return 'LOW';
};

module.exports = calculateDynamicPriority;