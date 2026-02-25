const express = require("express");
const lokAiRouter = express.Router();
const rateLimit = require('express-rate-limit');
const userAuth = require("../middlewares/userAuth");
const profileAuth = require("../middlewares/profileAuth");
const toolHandlers = require("../utils/lokAITools");
const { getNextClient } = require("../utils/geminiClient");
const User = require("../models/User");
const { getFuzzyFAQ } = require("../utils/faqEngine");
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs').promises;

// --- CONFIGURATION ---
const SOFT_MESSAGES = {
    QUOTA: "LokAI is taking a quick breather. Please try again in a minute!",
    TIMEOUT: "I'm having trouble connecting to the database. Please try again.",
    GENERIC: "I encountered a small hiccup. How else can I help?",
    OFF_TOPIC: "I specialize in civic issues and LocalAwaaz only."
};

const lokAiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    handler: (req, res) => res.status(429).json({ reply: SOFT_MESSAGES.QUOTA })
});

const uploadDir = 'uploads/lokai_vision_temp/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 30 * 1024 * 1024 } // 30 MB limit
});

// Helper: Handle Multer errors gracefully
const uploadMiddleware = (req, res, next) => {
    upload.array('images', 3)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ success: false, message: "Unknown upload error" });
        }
        next();
    });
};

async function fileToGenerativePart(path, mimeType) {
    const data = await fsPromises.readFile(path);
    return {
        inlineData: {
            data: data.toString("base64"),
            mimeType
        },
    };
}

// Helper: Clean up files safely
const cleanupFiles = (files) => {
    if (!files) return;
    files.forEach(file => {
        fs.unlink(file.path, (err) => { if (err) console.error("Cleanup error:", err); });
    });
};

// --- TOOL DEFINITIONS ---
const toolDefinitions = [
    {
        name: "getUserReports",
        description: "Fetch reports created by the user.",
        parameters: {
            type: "OBJECT",
            properties: {
                searchQuery: { type: "STRING" },
                status: { type: "STRING", enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] },
                category: { type: "STRING" },
                timeRange: { type: "STRING", enum: ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS"] }
            }
        }
    },
    {
        name: "getUserCivilScore",
        description: "Get user's Civil Score and rank.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "getIssueImpact",
        description: "Get Impact Score of a report.",
        parameters: {
            type: "OBJECT",
            properties: { issueTitle: { type: "STRING" } },
            required: ["issueTitle"]
        }
    },
    {
        name: "getPublicCivicIssues",
        description: "Search public issues.",
        parameters: {
            type: "OBJECT",
            properties: {
                city: { type: "STRING" },
                landmark: { type: "STRING" },
                searchQuery: { type: "STRING" },
                category: { type: "STRING" },
                status: { type: "STRING", enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] },
                sortBy: { type: "STRING", enum: ["NEWEST", "IMPACT", "SUPPORT"] }
            },
            required: ["city"]
        }
    },
    {
        name: "getIssueStats",
        description: "Get stats for a specific issue.",
        parameters: {
            type: "OBJECT",
            properties: { issueTitle: { type: "STRING" } },
            required: ["issueTitle"]
        }
    },
    {
        name: "getCityTrends",
        description: "Get top issue categories in a city.",
        parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] }
    },
    {
        name: "getIssuesNearMe",
        description: "Find issues near GPS coordinates.",
        parameters: {
            type: "OBJECT",
            properties: {
                lat: { type: "NUMBER" },
                lng: { type: "NUMBER" },
                radius: { type: "NUMBER" }
            },
            required: ["lat", "lng"]
        }
    },
    {
        name: "getCityLeaderboard",
        description: "Show top citizens in a city.",
        parameters: {
            type: "OBJECT",
            properties: { city: { type: "STRING" } },
            required: ["city"]
        }
    }
];

async function generateWithRetry(message, history, tools, systemInstruction, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const { modelInstance } = getNextClient({
                tools: tools ? [{ functionDeclarations: tools }] : undefined,
                systemInstruction
            });
            const chat = modelInstance.startChat({ history: history || [] });
            const result = await chat.sendMessage(message);
            return { result, chat };
        } catch (error) {
            if (i === attempts - 1) throw error;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// ============================================================================
// 🟢 ROUTE 1: SMART IMAGE ANALYSIS
// ============================================================================
// Note: We are using 'uploadMiddleware' here to handle upload errors properly
lokAiRouter.post('/ai/analyze-image', userAuth, profileAuth, uploadMiddleware, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: "No images uploaded" });

        const { userHint, city, state, address, lat, lng } = req.body;
        const { modelInstance } = getNextClient({
            // ENABLE JSON MODE
            generationConfig: { responseMimeType: "application/json" }
        });

        const allowedCategories = [
            'ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SAFETY',
            'SANITATION', 'GARBAGE', 'DRAINAGE', 'STREET_LIGHTS',
            'TRAFFIC', 'ENCROACHMENT', 'CORRUPTION', 'HEALTH', 'EDUCATION'
        ];

        const prompt = `
        Analyze this civic issue image for 'LocalAwaaz'.
        
        CONTEXT:
        - User Hint: """${userHint ? userHint.replace(/"/g, "'") : 'None'}"""
        - Location: ${address || ''} (${city || ''}, ${state || ''})
        (Use the hint/location to improve accuracy. If the user prompt in other language or mix language like Hinglish, understand it, translate in English language for JSON data.
        If hint contradicts visual evidence, trust image.)

        RULES:
        1. **Safety**: If NSFW/Irrelevant, set "is_valid": false.
        2. **Title**: Max 5     words. Professional.
        3. **Description**: 10-45 words. Factual. Include location context if relevant.
        4. **Category**: Must be one of: ${JSON.stringify(allowedCategories)}.
        5. **SubCategory**: Specific detail (e.g. "Streetlight").

        RETURN EXACT JSON:
        {
            "is_valid": boolean,
            "rejection_reason": stringOrNull,
            "data": {
                "title": string,
                "description": string,
                "category": string,
                "subCategory": stringOrNull
            }
        }`;

        const imageParts = await Promise.all(req.files.map(file =>
            fileToGenerativePart(file.path, file.mimetype)
        ));

        const result = await modelInstance.generateContent([prompt, ...imageParts]);
        const responseText = result.response.text();
        
        let aiData;
        try {
            aiData = JSON.parse(responseText);
        } catch (e) {
            cleanupFiles(req.files);
            return res.status(500).json({ success: false, message: "AI Analysis failed to generate valid data." });
        }

        cleanupFiles(req.files);

        if (!aiData.is_valid) {
            return res.status(400).json({
                success: false,
                message: aiData.rejection_reason || "Image is not a valid civic issue."
            });
        }

        // Return AI data merged with the location data sent by frontend
        aiData.data.location = {
            address: address || "Location not provided",
            city: city || "Unknown",
            state: state || "Unknown",
            coordinates: [parseFloat(lng || 0), parseFloat(lat || 0)],
            auto_detected: true
        };

        return res.status(200).json({
            success: true,
            message: "Analysis successful",
            analysis: aiData.data
        });

    } catch (error) {
        if (req.files) cleanupFiles(req.files);
        console.error("AI Analysis Error:", error);
        return res.status(500).json({ success: false, message: "Analysis Failed", error: error.message });
    }
});

// ============================================================================
// 🔵 ROUTE 2: CHAT BOT
// ============================================================================
lokAiRouter.post("/ai/chat", userAuth, profileAuth, lokAiLimiter, async (req, res) => {
    try {
        const { message, history, lng, lat, city } = req.body;
        const currentUserId = req.userId;

        const user = await User.findById(currentUserId).select("name contact.city civilScore");
        const faqAnswer = getFuzzyFAQ(message);

        if (faqAnswer) {
            return res.json({ reply: faqAnswer, data: null, toolUsed: "fuzzy_faq" });
        }

        const userName = user?.name || "Citizen";
        const userCity = user?.contact?.city || "your city";
        const activeCity = city || userCity || "your area";
        const locationInstruction = activeCity
            ? `User is in: ${activeCity}. Assume this city for local queries.`
            : `Location unknown. Ask user to specify city for local queries.`;

        const systemInstruction = `You are LokAI, the civic brain of LocalAwaaz. LocalAwaaz is an independent platform where citizens can report local issues,
        track their resolution, and earn recognition badges for making a difference in their community.
        USER: ${userName} | LOC: ${activeCity} | LAT/LNG: ${lat},${lng}
        ${locationInstruction}

        RULES:
        1. Ranks: Citizen(0-99), Activist(100-499), Community Leader(500-999), Civic Hero(1000+).
        2. Always use 'getUserCivilScore' for rank queries.
        3. If user says "my area", use "${userCity}".
        4. If user says "this" or "it", check previous tool response for context.
        5. Use 'getPublicCivicIssues' (sortBy='IMPACT') for discovery.
        6. If the user prompts in other language or mix of languages like Hinglish, then reply him in that language.
        6. Be concise and professional.`;

        const { result, chat } = await generateWithRetry(message, history, toolDefinitions, systemInstruction);
        
        // Use Gemini SDK method to get function calls safely
        const calls = result.response.functionCalls();
        const call = (calls && calls.length > 0) ? calls[0] : null;

        if (call) {
            const toolName = call.name;
            const handler = toolHandlers[toolName];
            if (handler) {
                let args = call.args;
                if (toolName === "getIssuesNearMe" && lat && lng) {
                    args = { ...args, lat, lng, radius: args.radius || 2000 };
                }

                console.log(`[LokAI] Calling Tool: ${toolName}`);
                const dbData = await handler(args, currentUserId);
                
                // Send tool output back to Gemini to generate final natural language response
                const finalResult = await chat.sendMessage([{
                    functionResponse: {
                        name: toolName,
                        response: { content: dbData || "No records found." }
                    }
                }]);

                return res.json({
                    reply: finalResult.response.text(),
                    data: dbData,
                    toolUsed: toolName
                });
            }
        }

        // Return standard text response if no tool was called
        const latestHistory = await chat.getHistory();
        return res.json({
            success: true,
            reply: result.response.text(),
            latestHistory: latestHistory
        });

    } catch (error) {
        console.error("LokAI Chat Error:", error);
        const reply = error.message.includes("429") ? SOFT_MESSAGES.QUOTA : SOFT_MESSAGES.GENERIC;
        res.status(200).json({ reply });
    }
});

module.exports = lokAiRouter;