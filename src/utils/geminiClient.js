const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. Load Your Cluster of 6 Keys
const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7
].filter(key => key); 

// 2. Global Counter for Round-Robin Rotation
let currentKeyIndex = 0;

// 3. GEMINI 2.5 MODELS (Based on your account tier)
const primaryModel = "gemini-2.5-flash"; 
const fallbackModel = "gemini-2.5-flash-lite";

const getNextClient = (config = {}) => {
    // A. Round Robin Logic: Always pick the NEXT key in the list
    const activeKey = apiKeys[currentKeyIndex];
    
    // Increment for next time (Loop back to 0 if at end)
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    // B. Initialize Client
    const client = new GoogleGenerativeAI(activeKey);
    
    // C. Model Selection
    const modelInstance = client.getGenerativeModel({ 
        model: primaryModel,
        systemInstruction: config.systemInstruction, 
        tools: config.tools 
    });
    
    return {
        modelInstance,
        modelName: primaryModel,
        keyID: "..." + activeKey.slice(-4) // Log the last 4 digits for debugging
    };
};

module.exports = { getNextClient };