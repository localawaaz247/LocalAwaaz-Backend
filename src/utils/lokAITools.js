const mongoose = require('mongoose');
const Issue = require('../models/Issue');
const User = require('../models/User');
const LeaderBoard = require('../models/LeaderBoard');

/**
 * 🤖 Helper to format issue data efficiently for the AI (Low Token Usage)
 */
const formatIssuesForAI = (issues) => {
    if (!issues || issues.length === 0) return "No issues found.";
    return issues.map(issue => ({
        id: issue._id,
        title: issue.title,
        category: issue.category,
        status: issue.status,
        priority: issue.priority,
        impactScore: issue.impactScore,
        location: `${issue.location?.city || 'Unknown'}, ${issue.location?.district || 'Unknown'}`,
        reportedAt: issue.createdAt ? issue.createdAt.toISOString().split('T')[0] : 'Unknown'
    }));
};

/**
 * 🖥️ Helper to format FULL issue data for the Frontend UI (IssueCard)
 * Retains images/media, full locations, and strictly masks Anonymous Users.
 */
const formatIssuesForUI = (issues) => {
    if (!issues || issues.length === 0) return [];
    return issues.map(issue => {
        const issueObj = issue.toObject ? issue.toObject() : issue;
        issueObj.dateOfFormation = issueObj.createdAt; // Expected by frontend

        if (issueObj.isAnonymous) {
            issueObj.reportedBy = {
                name: "Anonymous Citizen",
                userName: "active_citizen",
                civilScore: 10,
                issuesReported: 0,
                issuesConfirmed: 0,
                contact: { email: "hidden@localawaaz.in" },
                profilePic: null,
                isAnonymous: true
            };
        }
        return issueObj;
    });
};

const toolHandlers = {

    // 1. Fetch User's Own Reports
    getUserReports: async (args, userId) => {
        try {
            const query = { reportedBy: userId, isDeleted: false };

            if (args.status) query.status = args.status.toUpperCase();
            if (args.category) query.category = args.category.toUpperCase();

            if (args.timeRange) {
                const date = new Date();
                if (args.timeRange === "TODAY") date.setDate(date.getDate() - 1);
                else if (args.timeRange === "LAST_7_DAYS") date.setDate(date.getDate() - 7);
                else if (args.timeRange === "LAST_30_DAYS") date.setDate(date.getDate() - 30);
                query.createdAt = { $gte: date };
            }

            const issues = await Issue.find(query)
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('reportedBy', 'name userName profilePic civilScore contact.email isAnonymous');

            if (!issues || issues.length === 0) return "You haven't posted any issues matching this criteria.";

            return {
                uiData: formatIssuesForUI(issues),
                aiData: JSON.stringify(formatIssuesForAI(issues))
            };
        } catch (error) {
            console.error("getUserReports error:", error);
            return "Failed to fetch user reports.";
        }
    },

    // 2. Search Public Issues
    getPublicCivicIssues: async (args) => {
        try {
            const query = { isPublic: true, isDeleted: false };

            if (args.city) query['location.city'] = { $regex: new RegExp(`^${args.city}$`, 'i') };
            if (args.status) query.status = args.status.toUpperCase();
            if (args.category) query.category = args.category.toUpperCase();

            if (args.searchQuery) {
                query.$text = { $search: args.searchQuery };
            }

            let sortLogic = { createdAt: -1 }; // NEWEST default
            if (args.sortBy === "IMPACT") sortLogic = { impactScore: -1 };
            if (args.sortBy === "SUPPORT") sortLogic = { confirmationCount: -1 };

            const issues = await Issue.find(query)
                .sort(sortLogic)
                .limit(10)
                .populate('reportedBy', 'name userName profilePic civilScore contact.email isAnonymous');

            if (!issues || issues.length === 0) return "No public issues found for this criteria.";

            return {
                uiData: formatIssuesForUI(issues),
                aiData: JSON.stringify(formatIssuesForAI(issues))
            };
        } catch (error) {
            console.error("getPublicCivicIssues error:", error);
            return "Failed to fetch public issues.";
        }
    },

    // 3. Get User Civil Score & Rank
    getUserCivilScore: async (args, userId) => {
        try {
            const user = await User.findById(userId).select('name rank civilScore issuesReported issuesConfirmed issuesFlagged accountStatus');
            if (!user) return "User profile not found.";

            return JSON.stringify({
                name: user.name,
                rank: user.rank,
                civilScore: user.civilScore,
                stats: { reported: user.issuesReported, confirmed: user.issuesConfirmed, flagged: user.issuesFlagged },
                status: user.accountStatus
            });
        } catch (error) {
            return "Failed to fetch civil score.";
        }
    },

    // 4. Get Current Leaderboard
    getCurrentLeaderboard: async () => {
        try {
            const board = await LeaderBoard.findOne({ type: 'WEEKLY' })
                .sort({ createdAt: -1 })
                .populate('citizens.userId', 'name profilePic rank civilScore issuesReported')
                .populate('authorities.userId', 'name profilePic authorityProfile.departmentName authorityProfile.csiScore');

            if (!board) return JSON.stringify({ message: "No active weekly leaderboard found." });

            const topCitizens = board.citizens.slice(0, 5).map(c => ({
                rank: c.rank, name: c.userId?.name || "Unknown", title: c.userId?.rank || "Citizen", score: c.csi, profilePic: c.userId?.profilePic || null
            }));
            const topAuthorities = board.authorities.slice(0, 5).map(a => ({
                rank: a.rank, name: a.userId?.name || "Unknown", department: a.userId?.authorityProfile?.departmentName || "Official", score: a.csi, profilePic: a.userId?.profilePic || null
            }));

            return JSON.stringify({ period: "Current Week", topCitizens, topAuthorities });
        } catch (error) {
            return "Failed to fetch the leaderboard.";
        }
    },

    // 5. Get Saved Issues
    getSavedIssues: async (args, userId) => {
        try {
            const user = await User.findById(userId).populate({
                path: 'savedIssues',
                match: { isDeleted: false },
                populate: { path: 'reportedBy', select: 'name userName profilePic civilScore contact.email isAnonymous' },
                options: { limit: 10 }
            });

            if (!user || !user.savedIssues || user.savedIssues.length === 0) return "You have no saved issues.";

            return {
                uiData: formatIssuesForUI(user.savedIssues),
                aiData: JSON.stringify(formatIssuesForAI(user.savedIssues))
            };
        } catch (error) {
            return "Failed to fetch saved issues.";
        }
    },

    // 6. Get Confirmed Issues
    getConfirmedIssues: async (args, userId) => {
        try {
            const issues = await Issue.find({
                'confirmations.user': userId,
                reportedBy: { $ne: userId },
                isDeleted: false
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('reportedBy', 'name userName profilePic civilScore contact.email isAnonymous');

            if (!issues || issues.length === 0) return "You haven't confirmed any community issues yet.";

            return {
                uiData: formatIssuesForUI(issues),
                aiData: JSON.stringify(formatIssuesForAI(issues))
            };
        } catch (error) {
            return "Failed to fetch confirmed issues.";
        }
    },

    // 7. Get Issues Near GPS Coordinates
    getIssuesNearMe: async (args, userId) => {
        try {
            if (!args.lat || !args.lng) return "GPS coordinates are missing.";
            const radiusInMeters = args.radius || 3000;

            const issues = await Issue.find({
                isDeleted: false,
                isPublic: true,
                'location.geoData': {
                    $near: {
                        $geometry: { type: "Point", coordinates: [parseFloat(args.lng), parseFloat(args.lat)] },
                        $maxDistance: radiusInMeters
                    }
                }
            })
                .limit(10)
                .populate('reportedBy', 'name userName profilePic civilScore contact.email isAnonymous');

            if (!issues || issues.length === 0) return "No issues found nearby.";

            return {
                uiData: formatIssuesForUI(issues),
                aiData: JSON.stringify(formatIssuesForAI(issues))
            };
        } catch (error) {
            return "Failed to fetch nearby issues.";
        }
    },

    // 8. Get specific issue stats
    getIssueStats: async (args) => {
        try {
            const query = args.issueTitle ? { $text: { $search: args.issueTitle }, isDeleted: false } : null;
            if (!query) return "Issue title required.";

            const issue = await Issue.findOne(query).select('title status confirmationCount shareCount impactScore flagCount workCycle.finalVerdict bidding.winningBid');
            if (!issue) return "Issue not found.";

            return JSON.stringify({
                title: issue.title, status: issue.status, impactScore: issue.impactScore,
                confirmations: issue.confirmationCount, shares: issue.shareCount, flags: issue.flagCount,
                isAssigned: !!issue.bidding?.winningBid?.authorityId,
                communityVerdict: issue.workCycle?.finalVerdict || "PENDING"
            });
        } catch (error) {
            return "Failed to fetch issue stats.";
        }
    }
};

module.exports = toolHandlers;