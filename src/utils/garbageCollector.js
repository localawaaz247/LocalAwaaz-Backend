const cron = require('node-cron');
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const TempMedia = require('../models/TempMedia'); // Make sure this path matches your folder structure

// Initialize the Cloudflare R2 Client specifically for the cleaner
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const startGarbageCollector = () => {
    // Schedule to run every night at 3:00 AM
    cron.schedule('0 3 * * *', async () => {
        console.log("Running Nightly Garbage Collection for Orphaned Files...");

        try {
            // Find all temp media older than 2 hours
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

            // Note: Ensure your TempMedia schema doesn't have an automatic TTL index 
            // that deletes documents before this script can read the R2 keys!
            const orphanedFiles = await TempMedia.find({ createdAt: { $lt: twoHoursAgo } });

            if (orphanedFiles.length === 0) {
                console.log("No orphaned files found to clean.");
                return;
            }

            console.log(`Found ${orphanedFiles.length} orphaned files. Starting deletion...`);

            // Delete each orphaned file from Cloudflare R2
            for (const file of orphanedFiles) {
                const command = new DeleteObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: file.r2Key,
                });

                await s3.send(command); // Deletes from Cloudflare
                await TempMedia.findByIdAndDelete(file._id); // Removes from MongoDB

                console.log(`Deleted orphaned file: ${file.r2Key}`);
            }

            console.log("Nightly garbage collection complete.");

        } catch (error) {
            console.error("Garbage Collection Failed:", error);
        }
    });

    console.log("Orphaned media garbage collector scheduled (Runs daily at 3:00 AM).");
};

module.exports = startGarbageCollector;