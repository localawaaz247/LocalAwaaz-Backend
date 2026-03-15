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

const allowedCategories = ['ROAD_&_POTHOLES', 'WATER_SUPPLY', 'ELECTRICITY', 'SANITATION', 'GARBAGE', 'DRAINAGE', 'STREET_LIGHTS', 'TRAFFIC', 'ENCROACHMENT', 'CORRUPTION', 'HEALTH', 'EDUCATION'];

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
                category: { 
                    type: "STRING",
                    enum: allowedCategories
                },
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

lokAiRouter.post('/ai/analyze-image', userAuth, profileAuth, uploadMiddleware, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: "No images uploaded" });

        const { userHint, city, state, address, lat, lng } = req.body;
        const { modelInstance } = getNextClient({ generationConfig: { responseMimeType: "application/json" } });

        const user = await User.findById(req.userId).select("preferences");
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const prompt = `
        Analyze this civic issue image for 'LocalAwaaz'.
        CONTEXT: User Hint: """${userHint || ''}""" | Location: ${address || ''} (${city || ''}, ${state || ''}) | Preferred Language: ${preferredLanguage}

        RULES:
        1. Safety: If NSFW/Irrelevant, set "is_valid": false.
        2. Language: You MUST generate the title, description, and chat_message entirely in ${preferredLanguage}, irrespective of the language the user used in their hint. IMPORTANT: DO NOT translate the 'category' value. It MUST remain in English.
        3. Title: Max 5 words in ${preferredLanguage}. Professional.
        4. Description: 10-45 words in ${preferredLanguage}. Factual. Include location context if relevant.
        5. Category: Must be EXACTLY one of: ${JSON.stringify(allowedCategories)}.
        6. Chat Message: Generate a friendly message in ${preferredLanguage} stating what issue you found. Then explicitly ask: "Do you want to report this issue anonymously?" providing two clear options exactly like this: "[Yes] / [No]". Ensure the [Yes]/[No] words inside the brackets are translated to ${preferredLanguage}. (Do not ask for location yet).

        RETURN EXACT JSON:
        { "is_valid": boolean, "rejection_reason": stringOrNull, "chat_message": string, "data": { "title": string, "description": string, "category": string, "subCategory": stringOrNull } }`;

        const imageParts = await Promise.all(req.files.map(file => fileToGenerativePart(file.path, file.mimetype)));
        const result = await modelInstance.generateContent([prompt, ...imageParts]);
        const cleanText = result.response.text().replace(/```json|```/g, '').trim();

        let aiData;
        try { aiData = JSON.parse(cleanText); }
        catch (e) { return res.status(500).json({ success: false, message: "AI Analysis failed to generate valid JSON." }); }

        if (!aiData.is_valid) return res.status(400).json({ success: false, message: aiData.rejection_reason || "Image is not a valid civic issue." });

        aiData.data.location = { address: address || "", city: city || "", state: state || "", coordinates: [parseFloat(lng || 0), parseFloat(lat || 0)], auto_detected: true };

        return res.status(200).json({ success: true, message: "Analysis successful", analysis: aiData.data, chat_message: aiData.chat_message });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Analysis Failed", error: error.message });
    } finally { cleanupFiles(req.files); }
});

lokAiRouter.post("/ai/chat", userAuth, profileAuth, lokAiLimiter, async (req, res) => {
    try {
        const { message, history, lng, lat, city } = req.body;
        const currentUserId = req.userId;

        const user = await User.findById(currentUserId).select("name contact.city civilScore preferences");

        if (!history || history.length === 0) {
            const faqAnswer = getFuzzyFAQ(message);
            if (faqAnswer) return res.json({ reply: faqAnswer, data: null, toolUsed: "fuzzy_faq" });
        }

        const userName = user?.name || "Citizen";
        const userCity = user?.contact?.city || "your city";
        const activeCity = city || userCity || "your area";
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const locationInstruction = activeCity ? `User is in: ${activeCity}. Assume this city for local queries.` : `Location unknown. Ask user to specify city for local queries.`;

        const systemInstruction = `You are LokAI, the civic brain of LocalAwaaz. 
        USER: ${userName} | LOC: ${activeCity} | LAT/LNG: ${lat},${lng} | PREFERRED LANGUAGE: ${preferredLanguage}
        ${locationInstruction}

       YOUR PERSONA, DOMAIN & RULES:
        - DO NOT SHOW YOUR THINKING ANYWHERE EVEN WHEN ASKED JUST REPLY ABOUT QUERY.
        - Be warm, encouraging, and conversational.
        - STRICT LANGUAGE RULE: You MUST communicate entirely in the user's PREFERRED LANGUAGE (${preferredLanguage}), irrespective of the language the user uses to ask you questions.
        - DOMAIN RESTRICTION: Stick strictly to civic issues, LocalAwaaz policies, privacy, and civic duties. If the user talks about out-of-domain topics, politely decline and steer them back to civic reporting.
        - FULL AUTO-DRAFTING (SILENT): NEVER ask the user to provide a "Title", "Description", or "Category". You MUST automatically and silently generate a professional Title, a detailed Description, and infer the correct Category based on their conversational input. NEVER show the list of categories to the user.

        DRAFTING FLOW RULES (FOLLOW IN STRICT ORDER):
        1. UNDERSTAND THE ISSUE: If the user hasn't described the civic problem yet, auto generate it and move the next step.
        2. AUDIO IMAGE STEP: If input is "System: Images uploaded successfully", proceed directly to the Anonymity step.
        3. ANONYMITY STEP: Once you understand the civic issue (from their text, audio, or image), ask ONLY: "Do you want to report this issue anonymously? [Yes] / [No]". (Translate the question and options into ${preferredLanguage}, keeping the square brackets e.g. [हाँ] / [नहीं]).
        4. LOCATION VALIDATION STEP: After they answer about anonymity (infer if their answer means true or false), ask ONLY for their location in this exact format: "State, City, Pincode".
           - You MUST receive exactly three parts.
           - Verify if they are real geographic locations.
           - If any part is missing, or the format is wrong, or if you detect spam, politely ask the user in ${preferredLanguage} to re-enter details exactly in the "State, City, Pincode" format.
        5. ISSUE LANDMARK STEP: Once the State, City, and Pincode are valid, ask ONLY: "Do you want to add a specific nearby landmark or street name to help locate the issue easily? [Yes] / [No]". (Translate the question and options into ${preferredLanguage}, keeping the square brackets e.g. [हाँ] / [नहीं]).
        6. ISSUE LANDMARK RESPONSE:
           - If they answer "Yes" (or the translated equivalent), ask them to type the specific landmark/street name where the issue is present.
           - If they answer "No" (or after they have provided the landmark), proceed immediately to FINALIZE.
        7. FINALIZE STEP: Execute 'finalizeReportDraft' tool. Pass your auto-generated Title (in ${preferredLanguage}), auto-generated Description (in ${preferredLanguage}), inferred Category (MUST be exactly one of: ${JSON.stringify(allowedCategories)} - DO NOT translate this value), isAnonymous (boolean), State (translated to ${preferredLanguage}), City (translated to ${preferredLanguage}), Pincode, and Address (THIS MUST BE TRANSLATED TO ${preferredLanguage} if they provided one, otherwise pass an empty string).
        
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

lokAiRouter.post('/ai/analyze-audio', userAuth, profileAuth, audioUploadMiddleware, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No audio file uploaded" });

        const { userHint, city, state, address, lat, lng } = req.body;
        const { modelInstance } = getNextClient({ generationConfig: { responseMimeType: "application/json" } });

        const user = await User.findById(req.userId).select("preferences");
        const userLangCode = user?.preferences?.language || 'en';
        const preferredLanguage = LANG_MAP[userLangCode] || 'English';

        const prompt = `
        Listen to this audio report for 'LocalAwaaz'. 
        CONTEXT: User Hint: """${userHint || ''}""" | Location: ${address || ''} (${city || ''}, ${state || ''}) | Preferred Language: ${preferredLanguage}

        RULES:
        1. Transcribe: Listen carefully to what the user says.
        2. Language: You MUST generate the title, description, and chat_message entirely in ${preferredLanguage}, irrespective of the language the user used in their hint. IMPORTANT: DO NOT translate the 'category' value. It MUST remain in English.
        3. Title: Must be within 5 words in ${preferredLanguage}. Professional.
        4. Description: Must be within 50 words in ${preferredLanguage}. Factual. Include location context if relevant.
        5. Category: Classify into EXACTLY one of: ${JSON.stringify(allowedCategories)}.
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

        aiData.data.location = { address: address || "", city: city || "", state: state || "", coordinates: [parseFloat(lng || 0), parseFloat(lat || 0)], auto_detected: true };

        return res.status(200).json({ success: true, message: "Audio analysis successful", analysis: aiData.data, chat_message: aiData.chat_message });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Analysis Failed", error: error.message });
    } finally { cleanupFiles(req.file); }
});

module.exports = lokAiRouter;