const cron = require('node-cron');
const TempMedia = require('../src/models/TempMedia')
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const startGarbageCollector = () => {
    console.log("🟢 Garbage Collector Service Initialized.");

    cron.schedule('0 * * * *', async () => {
        console.log(`\n========================================================`);
        console.log(`🗑️  [HOURLY CRON] Garbage Collection: ${new Date().toISOString()}`);
        console.log(`========================================================`);
        try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const junkFiles = await TempMedia.find({ createdAt: { $lt: twentyFourHoursAgo } });

            if (junkFiles.length === 0) {
                console.log("   ✅ No junk files found in R2 Temp Storage.");
                return;
            }

            console.log(`   ⚠️ Found ${junkFiles.length} abandoned temporary files. Executing purge...`);

            for (const file of junkFiles) {
                try {
                    const command = new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: file.r2Key,
                    });
                    await s3.send(command);
                    await TempMedia.findByIdAndDelete(file._id);
                    console.log(`   ☁️ Purged from R2 & DB: ${file.r2Key}`);
                } catch (err) {
                    console.error(`   ❌ Failed to purge ${file.r2Key}:`, err.message);
                }
            }
            console.log("✨ [HOURLY CRON] Garbage Collection Complete.\n");

        } catch (error) {
            console.error("❌ Garbage Collector Error:", error);
        }
    });
};

module.exports = startGarbageCollector;