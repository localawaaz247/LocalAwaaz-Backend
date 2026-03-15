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

const SOFT_MESSAGES = {
    QUOTA: "LokAI is taking a quick breather. Please try again in a minute!",
    TIMEOUT: "I'm having trouble connecting to the database. Please try again.",
    GENERIC: "I encountered a small hiccup. How else can I help?",
    OFF_TOPIC: "I specialize in civic issues and LocalAwaaz only."
};

const LANG_MAP = {
    en: 'English', hi: 'Hindi', awa: 'Awadhi', bho: 'Bhojpuri',
    mr: 'Marathi', raj: 'Rajasthani', har: 'Haryanvi', gu: 'Gujarati',
    te: 'Telugu', ta: 'Tamil', kn: 'Kannada', bn: 'Bengali'
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
    limits: { fileSize: 30 * 1024 * 1024 }
});

const uploadMiddleware = (req, res, next) => {
    upload.array('images', 3)(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        else if (err) return res.status(500).json({ success: false, message: "Unknown upload error" });
        next();
    });
};

const audioUploadMiddleware = (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        else if (err) return res.status(500).json({ success: false, message: "Unknown upload error" });
        next();
    });
};

async function fileToGenerativePart(path, mimeType) {
    const data = await fsPromises.readFile(path);
    return { inlineData: { data: Buffer.from(data).toString("base64"), mimeType } };
}

const cleanupFiles = (files) => {
    if (!files) return;
    const fileArray = Array.isArray(files) ? files : [files];
    fileArray.forEach(file => {
        if (file && file.path) fs.unlink(file.path, (err) => { if (err) console.error(`[Cleanup] Failed:`, err); });
    });
};

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
    { name: "getUserCivilScore", description: "Get user's Civil Score and rank.", parameters: { type: "OBJECT", properties: {} } },
    {
        name: "getIssueImpact",
        description: "Get Impact Score of a report.",
        parameters: { type: "OBJECT", properties: { issueTitle: { type: "STRING" } }, required: ["issueTitle"] }
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
        parameters: { type: "OBJECT", properties: { issueTitle: { type: "STRING" } }, required: ["issueTitle"] }
    },
    { name: "getCityTrends", description: "Get top issue categories in a city.", parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] } },
    {
        name: "getIssuesNearMe",
        description: "Find issues near GPS coordinates.",
        parameters: { type: "OBJECT", properties: { lat: { type: "NUMBER" }, lng: { type: "NUMBER" }, radius: { type: "NUMBER" } }, required: ["lat", "lng"] }
    },
    { name: "getCityLeaderboard", description: "Show top citizens in a city.", parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] } },
    {
        name: "finalizeReportDraft",
        description: "Call this tool ONLY when you have gathered all location info (including optional specific address if provided) to finalize the draft.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING" },
                description: { type: "STRING" },
                category: { type: "STRING" },
                isAnonymous: { type: "BOOLEAN" },
                address: { type: "STRING" },
                city: { type: "STRING" },
                state: { type: "STRING" },
                pinCode: { type: "STRING" }
            },
            required: ["title", "description", "category", "isAnonymous", "city", "state"]
        }
    }
];

async function generateWithRetry(message, history, tools, systemInstruction, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const { modelInstance } = getNextClient({ tools: tools ? [{ functionDeclarations: tools }] : undefined, systemInstruction });
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
lokAiRouter.post('/ai/analyze-image', userAuth, profileAuth, uploadMiddleware, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: "No images uploaded" });

        const { userHint, city, state, address, lat, lng } = req.body;
        const { modelInstance } = getNextClient({ generationConfig: { responseMimeType: "application/json" } });

        const user = await User.findById(req.userId).select("preferences");
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const allowedCategories = ['ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SAFETY', 'SANITATION', 'GARBAGE', 'DRAINAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT', 'CORRUPTION', 'HEALTH', 'EDUCATION'];

        const prompt = `
        Analyze this civic issue image for 'LocalAwaaz'.
        CONTEXT: User Hint: """${userHint || ''}""" | Location: ${address || ''} (${city || ''}, ${state || ''}) | Preferred Language: ${preferredLanguage}

        RULES:
        1. Safety: If NSFW/Irrelevant, set "is_valid": false.
        2. Language: Generate the title, description, and chat_message entirely in ${preferredLanguage}.
        3. Title: Max 5 words. Professional.
        4. Description: 10-45 words. Factual. Include location context if relevant.
        5. Category: Must be one of: ${JSON.stringify(allowedCategories)}.
        6. Chat Message: Generate a friendly message in ${preferredLanguage} stating what issue you found. Then explicitly ask: "Do you want to report this issue anonymously?" providing two clear options: "[Yes] / [No]". Ensure the [Yes]/[No] words inside the brackets are translated to ${preferredLanguage}. (Do not ask for location yet).

        RETURN EXACT JSON:
        { "is_valid": boolean, "rejection_reason": stringOrNull, "chat_message": string, "data": { "title": string, "description": string, "category": string, "subCategory": stringOrNull } }`;

        const imageParts = await Promise.all(req.files.map(file => fileToGenerativePart(file.path, file.mimetype)));
        const result = await modelInstance.generateContent([prompt, ...imageParts]);
        const cleanText = result.response.text().replace(/```json|```/g, '').trim();

        let aiData;
        try { aiData = JSON.parse(cleanText); }
        catch (e) { return res.status(500).json({ success: false, message: "AI Analysis failed to generate valid JSON." }); }

        if (!aiData.is_valid) return res.status(400).json({ success: false, message: aiData.rejection_reason || "Image is not a valid civic issue." });

        aiData.data.location = { address: address || "", city: city || "", state: state || "", coordinates: [parseFloat(lng || 0), parseFloat(lat || 0)] };

        return res.status(200).json({ success: true, message: "Analysis successful", analysis: aiData.data, chat_message: aiData.chat_message });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Analysis Failed", error: error.message });
    } finally { cleanupFiles(req.files); }
});

// ============================================================================
// 🔵 ROUTE 2: CHAT BOT
// ============================================================================
lokAiRouter.post("/ai/chat", userAuth, profileAuth, lokAiLimiter, async (req, res) => {
    try {
        const { message, history, lng, lat, city } = req.body;
        const currentUserId = req.userId;

        const user = await User.findById(currentUserId).select("name contact.city civilScore preferences");
        const faqAnswer = getFuzzyFAQ(message);
        if (faqAnswer) return res.json({ reply: faqAnswer, data: null, toolUsed: "fuzzy_faq" });

        const userName = user?.name || "Citizen";
        const userCity = user?.contact?.city || "your city";
        const activeCity = city || userCity || "your area";
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const locationInstruction = activeCity ? `User is in: ${activeCity}. Assume this city for local queries.` : `Location unknown. Ask user to specify city for local queries.`;

        const systemInstruction = `You are LokAI, the civic brain of LocalAwaaz. 
        USER: ${userName} | LOC: ${activeCity} | LAT/LNG: ${lat},${lng} | PREFERRED LANGUAGE: ${preferredLanguage}
        ${locationInstruction}

       YOUR PERSONA & DOMAIN:
        - Be warm, encouraging, and conversational.
        - STRICT LANGUAGE RULE: You MUST communicate entirely in the user's PREFERRED LANGUAGE (${preferredLanguage}). This includes translating their input.
        - TRANSLATION RULE FOR REPORT DATA: The Title, Description, and Location details MUST be written in ${preferredLanguage}. DO NOT translate numeric Pincodes.
        
        DRAFTING FLOW RULES (FOLLOW IN STRICT ORDER):
        1. AUDIO IMAGE STEP: If the user input contains exactly "System: Images uploaded successfully", immediately acknowledge it and ask ONLY: "Do you want to report this issue anonymously?" providing two clear options: "[Yes] / [No]".
        2. ANONYMITY STEP: If the user answers Yes/No to the Anonymity question: Acknowledge their choice in ${preferredLanguage}, and then immediately ask them to provide their general location details (State, City, Pincode) to proceed.
        3. SPECIFIC ADDRESS STEP: When the user provides their general location (State, City, Pincode), DO NOT finalize yet. Acknowledge the location, and then explicitly ask ONLY: "Do you want to add a specific nearby address or landmark?" providing two clear options: "[Yes] / [No]". Ensure the [Yes]/[No] words inside the brackets are translated to ${preferredLanguage}.
        4. SPECIFIC ADDRESS RESPONSE:
           - If the user says "Yes" to adding a specific address, politely ask them to type it in.
           - If the user says "No" to adding a specific address, proceed immediately to the FINALIZE STEP.
        5. FINALIZE STEP: Once the user either declines to provide a specific address OR provides the specific address, you MUST execute the 'finalizeReportDraft' tool. Pass the Translated Title, Description, Category, isAnonymous boolean, State, City, Pincode, and the translated Specific Address (if provided). Do not ask for Submit/Modify in text, just execute the tool!
        
        RULES & FACTS: Use 'getPublicCivicIssues' (sortBy='IMPACT') for discovery. Keep responses structured.`;

        const { result, chat } = await generateWithRetry(message, history, toolDefinitions, systemInstruction);

        const calls = result.response.functionCalls();
        const call = (calls && calls.length > 0) ? calls[0] : null;

        if (call) {
            const toolName = call.name;

            if (toolName === "finalizeReportDraft") {
                return res.json({
                    reply: "Draft finalized.",
                    data: call.args,
                    toolUsed: toolName
                });
            }

            const handler = toolHandlers[toolName];
            if (handler) {
                let args = call.args;
                if (toolName === "getIssuesNearMe" && lat && lng) args = { ...args, lat, lng, radius: args.radius || 2000 };
                const dbData = await handler(args, currentUserId);
                const finalResult = await chat.sendMessage([{ functionResponse: { name: toolName, response: { content: dbData || "No records found." } } }]);

                return res.json({ reply: finalResult.response.text(), data: dbData, toolUsed: toolName });
            }
        }

        const latestHistory = await chat.getHistory();
        return res.json({ success: true, reply: result.response.text(), latestHistory: latestHistory });

    } catch (error) {
        const reply = error.message.includes("429") ? SOFT_MESSAGES.QUOTA : SOFT_MESSAGES.GENERIC;
        res.status(200).json({ reply });
    }
});

// ============================================================================
// 🟣 ROUTE 3: SMART AUDIO ANALYSIS
// ============================================================================
lokAiRouter.post('/ai/analyze-audio', userAuth, profileAuth, audioUploadMiddleware, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No audio file uploaded" });

        const { userHint, city, state, address, lat, lng } = req.body;
        const { modelInstance } = getNextClient({ generationConfig: { responseMimeType: "application/json" } });

        const user = await User.findById(req.userId).select("preferences");
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const allowedCategories = ['ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SAFETY', 'SANITATION', 'GARBAGE', 'DRAINAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT', 'CORRUPTION', 'HEALTH', 'EDUCATION'];

        const prompt = `
        Listen to this audio report for 'LocalAwaaz'. 
        CONTEXT: User Hint: """${userHint || ''}""" | Location: ${address || ''} (${city || ''}, ${state || ''}) | Preferred Language: ${preferredLanguage}

        RULES:
        1. Transcribe: Listen carefully to what the user says.
        2. Language: Generate the title, description, and chat_message entirely in ${preferredLanguage}.
        3. Title: Must be within 5 words. Professional.
        4. Description: Must be within 50 words. Factual. Include location context if relevant.
        5. Category: Classify into one of: ${JSON.stringify(allowedCategories)}.
        6. Chat Message: Generate a friendly message in ${preferredLanguage} stating what issue you found. Then explicitly ask the user to upload at least 1 image (up to 3) of the issue using the + icon to proceed. (Mention the combined size limit is 30MB). Do NOT ask about anonymity yet.

        RETURN EXACT JSON:
        { "is_valid": boolean, "rejection_reason": stringOrNull, "chat_message": string, "data": { "title": string, "description": string, "category": string, "subCategory": stringOrNull, "transcription": string } }`;

        const audioPart = await fileToGenerativePart(req.file.path, req.file.mimetype);
        const result = await modelInstance.generateContent([prompt, audioPart]);
        const cleanText = result.response.text().replace(/```json|```/g, '').trim();

        let aiData;
        try { aiData = JSON.parse(cleanText); }
        catch (e) { return res.status(500).json({ success: false, message: "AI Audio Analysis failed." }); }

        if (!aiData.is_valid) return res.status(400).json({ success: false, message: aiData.rejection_reason || "Audio is not a valid civic report." });

        aiData.data.location = { address: address || "", city: city || "", state: state || "", coordinates: [parseFloat(lng || 0), parseFloat(lat || 0)] };

        return res.status(200).json({ success: true, message: "Audio analysis successful", analysis: aiData.data, chat_message: aiData.chat_message });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Analysis Failed", error: error.message });
    } finally { cleanupFiles(req.file); }
});

module.exports = lokAiRouter;