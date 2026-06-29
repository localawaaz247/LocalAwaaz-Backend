const cron = require('node-cron');

const startAwakeJob = () => {
    // Schedule to run every 14 minutes
    cron.schedule('* * * * *', async () => {
        try {
            // Target URL based on environment
            const targetUrl = process.env.NODE_ENV === 'production'
                ? 'https://localawaaz-backend.onrender.com/ping'
                : `http://localhost:${process.env.PORT || 1111}/ping`;

            const response = await fetch(targetUrl);

            if (response.ok) {
                console.log(`[AwakeJob] 🟢 Successfully pinged server at ${new Date().toLocaleTimeString()}`);
            } else {
                console.log(`[AwakeJob] 🟡 Ping responded with status: ${response.status}`);
            }
        } catch (error) {
            console.error(`[AwakeJob] 🔴 Failed to ping server:`, error.message);
        }
    });

    console.log('[AwakeJob] ⏰ 14-minute wake-up cron initialized.');
};

module.exports = startAwakeJob;