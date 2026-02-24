const cron = require('node-cron');
const TempMedia = require('../models/TempMedia');
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

// Re-initialize S3 Client here (since this file runs independently)
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const startGarbageCollector = () => {
    console.log("🗑️  Garbage Collector Service Started...");

    // Run every hour: '0 * * * *'
    cron.schedule('0 * * * *', async () => {
        try {
            console.log("⏰ Running Hourly Garbage Collection...");

            // 1. Find files older than 24 hours
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const junkFiles = await TempMedia.find({ createdAt: { $lt: twentyFourHoursAgo } });

            if (junkFiles.length === 0) {
                console.log("✅ No junk files found.");
                return;
            }

            console.log(`⚠️ Found ${junkFiles.length} abandoned files. Deleting...`);

            // 2. Delete from Cloudflare R2 and Database
            for (const file of junkFiles) {
                try {
                    // Delete from R2
                    const command = new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: file.r2Key,
                    });
                    await s3.send(command);
                    console.log(`☁️  Deleted from R2: ${file.r2Key}`);

                    // Delete from MongoDB
                    await TempMedia.findByIdAndDelete(file._id);

                } catch (err) {
                    console.error(`❌ Failed to delete ${file.r2Key}:`, err.message);
                }
            }
            console.log("✨ Garbage Collection Complete.");

        } catch (error) {
            console.error("❌ Garbage Collector Error:", error);
        }
    });
};

module.exports = startGarbageCollector;