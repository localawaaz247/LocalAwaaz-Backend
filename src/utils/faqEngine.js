const Fuse = require('fuse.js');

const FAQ_LIST = [
    // --- CATEGORY: ONBOARDING ---
    {
        questions: [
            "how to report",
            "submit issue",
            "report problem",
            "post a photo",
            "new report",
            "how do i post" // Added
        ],
        answer: "To report an issue: 1. Click 'Report Issue' on your dashboard. 2. Upload a photo. 3. Tag the location. 4. Describe the problem. LokAI will take it from there!"
    },
    {
        questions: ["is it free", "do i have to pay", "cost", "subscription", "price"],
        answer: "LocalAwaaz is 100% free for citizens. Our mission is to empower your voice to improve your city."
    },

    // --- CATEGORY: GAMIFICATION ---
    {
        questions: [
            "civil score",
            "my points",
            "how to earn points",
            "increase score",
            "increase points",        // Added
            "how can i increase my points", // Added specific user query
            "get more points",        // Added
            "points calculation"
        ],
        answer: "Earn points by being active: +10 for a report, +5 for confirming others' issues, and +50 when your reported issue is marked as 'Resolved' by admins!"
    },
    {
        questions: ["badges", "ranks", "activist", "leader", "hero", "level up", "how to rank up"],
        answer: "Ranks are: Citizen (Basic), Activist (100 pts), Community Leader (500 pts), and Civic Hero (1000 pts). Each rank unlocks a new profile badge!"
    },

    // --- CATEGORY: TECHNICAL/PRIVACY ---
    {
        questions: ["anonymous", "hide my name", "private reporting", "will people see me", "can i post anonymously"],
        answer: "Yes! When reporting, toggle the 'Report Anonymously' switch. Your identity will be hidden from the public feed, but the issue will still be tracked."
    },
    {
        questions: ["delete report", "remove issue", "edit post", "can i delete"],
        answer: "You can edit or delete a report only while its status is 'OPEN'. Once an authority starts reviewing it, changes are restricted to ensure data integrity."
    },

    // --- CATEGORY: CIVIC IMPACT ---
    {
        questions: ["who fixes this", "government", "authority", "official action", "when will it be fixed"],
        answer: "LocalAwaaz aggregates reports to show authorities where the most help is needed. While we don't fix issues ourselves, we provide the data to local bodies to speed up action."
    },
    {
        questions: ["impact score", "priority", "why some issues are on top", "what is impact score"],
        answer: "The Impact Score is calculated based on confirmations, flags, and the category's severity. High-impact issues get more visibility for authorities."
    },

    // --- CATEGORY: GREETINGS ---
    {
        questions: ["hi", "hello", "hey", "namaste", "good morning", "yo"],
        answer: "Hello! I'm LokAI. I can help you find local issues, check your civil score, or show you the city leaderboard. What's on your mind today?"
    }
];

const options = {
    keys: ['questions'],
    // ⬇️ RELAXED THRESHOLD: 0.0 is exact match, 1.0 is match anything.
    // 0.4 allows for typos and extra words like "can i" or "please".
    threshold: 0.4,
    distance: 100,
    ignoreLocation: true
};

const fuse = new Fuse(FAQ_LIST, options);

const getFuzzyFAQ = (query) => {
    // Basic sanitization
    if (!query) return null;

    const results = fuse.search(query);

    // Logging for debugging (Check your console to see the Score!)
    if (results.length > 0) {
        console.log(`[LokAI FAQ] Matched: "${query}" -> "${results[0].item.questions[0]}" (Score: ${results[0].score})`);
        return results[0].item.answer;
    }

    return null;
};

module.exports = { getFuzzyFAQ };