const express = require("express");
const lokAiRouter = express.Router();
const rateLimit = require('express-rate-limit');
const userAuth = require("../middlewares/userAuth");
const toolHandlers = require("../utils/lokAITools");
const { getNextClient } = require("../utils/geminiClient");
const User = require("../models/User"); // ✅ Import your model
const { getFuzzyFAQ } = require("../utils/faqEngine");
const profileAuth = require("../middlewares/profileAuth");

const SOFT_MESSAGES = {
    QUOTA: "LokAI is taking a quick breather after helping so many citizens. Please try again in a minute!",
    TIMEOUT: "I'm having a bit of trouble connecting to the civic database. Could you try your request again?",
    GENERIC: "I encountered a small hiccup while processing that. How else can I help you with LocalAwaaz?",
    OFF_TOPIC: "I'd love to chat, but I'm specialized in civic issues and LocalAwaaz. How can I help you improve your city today?"
};

const lokAiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    handler: (req, res) => res.status(429).json({ reply: SOFT_MESSAGES.QUOTA })
});

// ... (Keep your toolDefinitions array exactly as it was) ...
const toolDefinitions = [
    {
        name: "getUserReports",
        description: "Fetch reports created by the user. Supports status filters AND text search (e.g., 'my water reports').",
        parameters: {
            type: "OBJECT",
            properties: {
                searchQuery: {
                    type: "STRING",
                    description: "A keyword or phrase to filter reports (e.g., 'pothole', 'broken light', 'water')."
                },
                status: { type: "STRING", enum: ["OPEN", "IN_REVIEW", "RESOLVED"] },
                category: { type: "STRING" },
                timeRange: { type: "STRING", enum: ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS"] }
            }
        }
    },
    {
        name: "getUserCivilScore",
        description: "Get the user's total Civil Score and rank.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "getIssueImpact",
        description: "Get the Impact Score of a specific report. Accepts vague descriptions or titles.",
        parameters: {
            type: "OBJECT",
            properties: {
                issueTitle: {
                    type: "STRING",
                    description: "The title OR a descriptive hint of the report (e.g., 'that water issue')."
                }
            },
            required: ["issueTitle"]
        }
    },
    {
        name: "getPublicCivicIssues",
        description: "Search public issues by city, landmark, or general keywords.",
        parameters: {
            type: "OBJECT",
            properties: {
                city: { type: "STRING", description: "The city name" },
                landmark: { type: "STRING", description: "Specific address hint" },
                searchQuery: {
                    type: "STRING",
                    description: "General keywords or description hints (e.g., 'dirty water', 'accident zone')."
                },
                category: { type: "STRING" },
                status: { type: "STRING", enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] },
                sortBy: { type: "STRING", enum: ["NEWEST", "IMPACT", "SUPPORT"] }
            },
            required: ["city"]
        }
    },
    {
        name: "getIssueStats",
        description: "Get confirmations/flags for a specific issue using a flexible search.",
        parameters: {
            type: "OBJECT",
            properties: {
                issueTitle: {
                    type: "STRING",
                    description: "The keyword, title, category, or description hint (e.g., 'water', 'street light')."
                }
            },
            required: ["issueTitle"]
        }
    },
    // ... (Keep getCityTrends, getIssuesNearMe, getCityLeaderboard exactly as they were) ...
    {
        name: "getCityTrends",
        description: "Get top issue categories in a city.",
        parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] }
    },
    {
        name: "getIssuesNearMe",
        description: "Find civic issues within a specific radius of the user's GPS coordinates.",
        parameters: {
            type: "OBJECT",
            properties: {
                lat: { type: "NUMBER" },
                lng: { type: "NUMBER" },
                radius: { type: "NUMBER", description: "Search radius in meters (e.g. 1000 for 1km)" }
            },
            required: ["lat", "lng"]
        }
    },
    {
        name: "getCityLeaderboard",
        description: "Show the top-ranked citizens in a specific city based on Civil Score.",
        parameters: {
            type: "OBJECT",
            properties: {
                city: { type: "STRING", description: "The city name (e.g. Sultanpur)" }
            },
            required: ["city"]
        }
    }
];

// --- Failover Logic ---
async function generateWithRetry(message, history, tools, systemInstruction, attempts = 6) {
    for (let i = 0; i < attempts; i++) {
        try {
            const { modelInstance, modelName, keyID } = getNextClient({
                tools: [{ functionDeclarations: tools }],
                systemInstruction: systemInstruction
            });

            console.log(`[LokAI] 🟢 Attempt ${i + 1}: Using Key (${keyID}) on ${modelName}`);

            const chat = modelInstance.startChat({
                history: history || []
            });

            const result = await chat.sendMessage(message);
            return { result, chat };

        } catch (error) {
            console.warn(`[LokAI] ⚠️ Attempt ${i + 1} failed: ${error.message}`);
            if (i === attempts - 1) throw error;
        }
    }
}

// --- Main Route ---
lokAiRouter.post("/chat/bot", userAuth, profileAuth, lokAiLimiter, async (req, res) => {
    try {
        const { message, history, lng, lat, city: incomingCity } = req.body;
        const currentUserId = req.userId;

        // 1. Fetch User Context (UPDATED FOR YOUR SCHEMA)
        // We select 'contact' because city is inside it.
        const user = await User.findById(currentUserId).select("name contact.city civilScore");

        // 🟢 THE GATEKEEPER: Check for FAQ first
        const faqAnswer = getFuzzyFAQ(message);

        if (faqAnswer) {
            console.log(`[LokAI] ⚡ Fuzzy FAQ Match found. Skipping AI.`);
            return res.json({
                reply: faqAnswer,
                data: null,
                toolUsed: "fuzzy_faq"
            });
        }

        const userName = user?.name || "Citizen";
        // ✅ FIX: Access city via user.contact.city
        const userCity = user?.contact?.city || "your city";
        const currentScore = user?.civilScore || 0;
        const activeCity = incomingCity || user?.contact?.city || "your area";

        let locationInstruction = "";
        if (activeCity) {
            locationInstruction = `The user is currently in: ${activeCity}. Assume they mean this city for all local queries.`;
        } else {
            locationInstruction = `The user's location is unknown. If they ask about "my area" or local reports, politely ask them to specify their city.`;
        }

        // 2. Build Context-Aware System Instruction
        const systemInstruction = `You are LokAI, the civic brain of LocalAwaaz.LocalAwaaz is an independent platform where citizens can report local issues, track their resolution, and earn recognition badges for making a difference in their community.

        USER CONTEXT:
        - User Name: ${userName}
        - Current Lat: ${lat || "Unknown"} 
        - Current Lng: ${lng || "Unknown"}
        - ${locationInstruction}

       GAMIFICATION RULES (Memorize This):
        - Rank 1: "Citizen" (0 - 99 Points)
        - Rank 2: "Activist" (100 - 499 Points)
        - Rank 3: "Community Leader" (500 - 999 Points)
        - Rank 4: "Civic Hero" (1000+ Points)
        - CORE RULE: If a user asks about their rank progress, ALWAYS call 'getUserCivilScore' to get the exact reports needed. Do not guess.

        CONTEXTUAL INSTRUCTIONS:
        1. "MY AREA" / "LOCAL": If the user asks about "my area", "here", or "local issues" without naming a city, AUTOMATICALLY use "${userCity}".
        2. PRONOUNS ("THIS", "IT"): If the user asks "What is the score of *this*?" or "Tell me more about *it*", look at the PREVIOUS tool response in the chat history to find the Issue Title.
        3. GREETING: Greet the user by name (${userName}) at the start of a conversation.

        CORE RESPONSIBILITIES:
        - TRACKING: Help users check status. Explain WHY using 'latestUpdate'.
        - DISCOVERY: Use 'getPublicCivicIssues' with sortBy='IMPACT' or 'SUPPORT' for top issues.
        - INSIGHTS: Use 'getCityTrends' for city-wide summaries.
        
        STRICT BOUNDARIES:
        - Do not hallucinate reports. If you can't find an issue, say so.
        - Be concise, professional, and encouraging.`;

        // 3. Call AI
        const { result, chat } = await generateWithRetry(
            message,
            history,
            toolDefinitions,
            systemInstruction
        );

        const call = result.response.functionCalls()?.[0];

        if (call) {
            const toolName = call.name;
            const handler = toolHandlers[toolName];

            if (handler) {
                let args = call.args;
                if (toolName === "getIssuesNearMe" && lat && lng) {
                    args = {
                        ...call.args,
                        lat: lat || call.args.lat, // Prioritize the actual GPS data from the request body
                        lng: lng || call.args.lng,
                        radius: call.args.radius || 2000 // Default to 2km if AI doesn't specify
                    };
                }

                console.log(`[LokAI] 🛠️ Executing ${toolName} with args:`, args);
                // 4. Execute DB Tool
                const dbData = await handler(args, currentUserId);

                // 5. Return DB Data to AI
                const finalResult = await chat.sendMessage([
                    {
                        functionResponse: {
                            name: toolName,
                            response: { content: dbData || "No records found." }
                        }
                    }
                ]);

                return res.json({
                    reply: finalResult.response.text(),
                    data: dbData,
                    toolUsed: toolName
                });
            }
        }

        return res.json({ reply: result.response.text() });

    } catch (error) {
        console.error("LokAI Fatal Error:", error);
        const reply = error.message.includes("429") ? SOFT_MESSAGES.QUOTA : SOFT_MESSAGES.GENERIC;
        res.status(200).json({ reply });
    }
});

module.exports = lokAiRouter;