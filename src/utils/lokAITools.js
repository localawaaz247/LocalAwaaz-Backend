const Issue = require("../models/Issue");
const User = require("../models/User");

// 🧠 UNIVERSAL SMART SEARCH HELPER
// Looks inside Title, Description, Category, and Address
const buildSmartQuery = (searchTerm) => {
    if (!searchTerm) return {};
    // Ensure searchTerm is a string to prevent regex errors
    const term = String(searchTerm);
    return {
        $or: [
            { title: { $regex: term, $options: "i" } },
            { description: { $regex: term, $options: "i" } },
            { category: { $regex: term, $options: "i" } },
            { "location.address": { $regex: term, $options: "i" } }
        ]
    };
};

const toolHandlers = {

    // 1. CIVIL SCORE (User Level)
    getUserCivilScore: async (args, userId) => {
        const stats = await Issue.aggregate([
            {
                $match: {
                    reportedBy: userId,
                    isDeleted: false,
                    status: { $ne: "REJECTED" }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCivilScore: { $sum: "$impactScore" },
                    reportsCount: { $sum: 1 }
                }
            }
        ]);

        if (!stats.length) {
            return {
                totalCivilScore: 0,
                rank: "Citizen",
                nextRank: "Activist",
                pointsToNextRank: 100,
                reportsToNextRank: 10
            };
        }

        const score = stats[0].totalCivilScore;
        let rank = "Citizen";
        let nextRank = "Activist";
        let pointsNeeded = 100 - score;

        if (score >= 100 && score < 500) {
            rank = "Activist"; nextRank = "Community Leader"; pointsNeeded = 500 - score;
        } else if (score >= 500 && score < 1000) {
            rank = "Community Leader"; nextRank = "Civic Hero"; pointsNeeded = 1000 - score;
        } else if (score >= 1000) {
            rank = "Civic Hero"; nextRank = "Legend"; pointsNeeded = 0;
        }

        return {
            totalCivilScore: score,
            totalReports: stats[0].reportsCount,
            rank: rank,
            nextRank: nextRank,
            pointsToNextRank: pointsNeeded,
            reportsToNextRank: Math.ceil(pointsNeeded / 10)
        };
    },

    // 2. IMPACT SCORE (Specific Report)
    // Now handles ambiguity if user has multiple similar reports
    getIssueImpact: async (args, userId) => {
        try {
            const smartSearch = buildSmartQuery(args.issueTitle);

            const issues = await Issue.find({
                reportedBy: userId,
                isDeleted: false,
                ...smartSearch
            }).select("title impactScore status confirmationCount location.city");

            if (!issues || issues.length === 0) {
                return `I couldn't find a report in YOUR history matching "${args.issueTitle}".`;
            }

            // Ambiguity Check
            if (issues.length > 1) {
                const candidates = issues.map(i =>
                    `- "${i.title}" (${i.status}, in ${i.location.city})`
                ).join("\n");
                return `I found multiple reports in your history matching that description. Which one?\n${candidates}`;
            }

            const issue = issues[0];
            return {
                title: issue.title,
                impactScore: issue.impactScore,
                confirmations: issue.confirmationCount,
                status: issue.status
            };
        } catch (error) {
            return "Error retrieving your report details.";
        }
    },

    // 3. USER REPORTS (My History)
    
    getUserReports: async (args, userId) => {
        let textQuery = {};
        if (args.searchQuery) textQuery = buildSmartQuery(args.searchQuery);

        // Handle "Today" filter safely
        let dateFilter = {};
        if (args.timeRange === "TODAY") {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            // Fallback: If createdAt exists, use it. If not, this filter might miss old "dateless" items.
            dateFilter = { createdAt: { $gte: startOfDay } };
        }

        const reports = await Issue.find({
            reportedBy: userId,
            isDeleted: false,
            ...textQuery,
            ...(args.status && { status: args.status.toUpperCase() }),
            ...dateFilter
        })
            .select("title status category createdAt statusHistory")
            .sort({ _id: -1 }) // Sort by _id (which is time-based) instead of createdAt to be safe
            .limit(5);

        if (!reports.length) return "You haven't submitted any reports matching that description.";

        return reports.map(r => {
            // 🛡️ SAFETY CHECK: Use createdAt if it exists, otherwise extract date from _id
            const dateObj = r.createdAt || r._id.getTimestamp();
            const dateString = dateObj ? dateObj.toDateString() : "Unknown Date";

            return {
                title: r.title,
                status: r.status,
                date: dateString, // ✅ No more crash
                latestNote: r.statusHistory?.length ? r.statusHistory[r.statusHistory.length - 1].note : "No updates."
            };
        });
    },

    // 4. PUBLIC ISSUES (City/Locality Search)
    getPublicCivicIssues: async (args) => {
        const query = {
            isPublic: true,
            isDeleted: false
        };

        if (args.city) {
            query['location.city'] = { $regex: args.city, $options: "i" };
        }

        if (args.searchQuery) {
            const smartSearch = buildSmartQuery(args.searchQuery);
            query.$or = smartSearch.$or;
        }

        let sortOption = { createdAt: -1 };
        if (args.sortBy === 'IMPACT') sortOption = { impactScore: -1 };
        else if (args.sortBy === 'SUPPORT') sortOption = { confirmationCount: -1 };

        const issues = await Issue.find(query)
            .select("title category status location.city location.address impactScore")
            .sort(sortOption)
            .limit(5);

        if (!issues.length) return `No public issues found in ${args.city || "this area"}.`;

        return issues;
    },

    // 5. ISSUE STATS (For checking specific public issues)
    // ✅ UPDATE: Added 'isPublic: true' for security
    getIssueStats: async (args, userId) => {
        try {
            console.log(`[LokAI] 🔍 Smart-Searching for: "${args.issueTitle}"`);

            const query = {
                isDeleted: false,
                isPublic: true, // 🛑 SECURITY: Only search public issues
                ...buildSmartQuery(args.issueTitle)
            };

            const issues = await Issue.find(query)
                .select("title description category status confirmations flags location.address location.city")
                .limit(3);

            if (!issues || issues.length === 0) {
                return `I couldn't find any public reports matching "${args.issueTitle}".`;
            }

            if (issues.length > 1) {
                const candidates = issues.map(i =>
                    `- "${i.title}" (${i.status}, near ${i.location.address}, ${i.location.city})`
                ).join("\n");
                return `I found multiple issues matching that description. Which one did you mean?\n${candidates}`;
            }

            const issue = issues[0];
            return JSON.stringify({
                foundMatch: true,
                title: issue.title,
                confirmations: issue.confirmations ? issue.confirmations.length : 0,
                flags: issue.flags ? issue.flags.length : 0,
                status: issue.status,
                category: issue.category,
                snippet: issue.description.substring(0, 100) + "..."
            });

        } catch (error) {
            console.error("Tool Error (getIssueStats):", error);
            return `System Error: ${error.message}`;
        }
    },

    // 6. CITY TRENDS
    getCityTrends: async (args) => {
        return await Issue.aggregate([
            {
                $match: {
                    'location.city': { $regex: args.city, $options: "i" },
                    isDeleted: false
                }
            },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 3 }
        ]);
    },

    // 7. ISSUES NEARBY
    getIssuesNearMe: async (args, userId) => {
        const { lat, lng, radius = 2000 } = args;
        return await Issue.find({
            "location.geoData": {
                $nearSphere: {
                    $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: radius
                }
            },
            isDeleted: false,
            isPublic: true, // 🛑 SECURITY
            status: { $ne: "REJECTED" }
        })
            .limit(10)
            .select("title category impactScore status location.address");
    },

    // 8. LEADERBOARD
    getCityLeaderboard: async (args) => {
        return await User.aggregate([
            { $match: { "contact.city": new RegExp(args.city, "i"), role: "user" } },
            { $project: { name: 1, civilScore: 1, rank: 1, profilePic: 1 } },
            { $sort: { civilScore: -1 } },
            { $limit: 10 }
        ]);
    }
};

module.exports = toolHandlers;