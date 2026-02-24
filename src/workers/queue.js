// const { Queue } = require('bullmq');
// const Redis = require('ioredis');

// // Upstash & BullMQ Bulletproof Configuration
// const redisOptions = {
//     maxRetriesPerRequest: null, // Strictly required by BullMQ
//     enableReadyCheck: false,
//     keepAlive: 10000, // Pings Upstash every 10 seconds so it doesn't drop us
//     tls: process.env.REDIS_URL && process.env.REDIS_URL.startsWith('rediss://') 
//         ? { rejectUnauthorized: false } 
//         : undefined,
//     retryStrategy(times) {
//         // If Upstash resets the connection, automatically reconnect
//         console.warn(`⚠️ Retrying Redis connection... attempt ${times}`);
//         return Math.min(times * 50, 2000); 
//     }
// };

// const redisConnection = new Redis(process.env.REDIS_URL, redisOptions);

// redisConnection.on('error', (err) => {
//     // Only log the message so it doesn't flood your terminal with stack traces
//     console.error('❌ Redis Queue Error:', err.message); 
// });

// redisConnection.on('connect', () => {
//     console.log('✅ Queue Connected to Upstash Redis!');
// });

// const mediaQueue = new Queue('media-processing', { 
//     connection: redisConnection,
//     defaultJobOptions: {
//         removeOnComplete: true,
//         removeOnFail: false,
//     }
// });

// // Export redisOptions so the worker file can use the exact same secure settings
// module.exports = { mediaQueue, redisConnection, redisOptions };