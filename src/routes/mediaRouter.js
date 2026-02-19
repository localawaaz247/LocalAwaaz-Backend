const express = require('express');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');
const Issue = require('../models/Issue');

const mediaRouter = express.Router();
// 1. Initialize Cloudflare R2 Client
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// 2. Endpoint to generate the Presigned URL
mediaRouter.post("/get-upload-url", userAuth, profileAuth, async (req, res) => {
    try {
        const { fileType, originalName } = req.body;

        // Safety check
        if (!fileType || !originalName) {
            return res.status(400).json({ error: "Missing file details" });
        }

        // --- NEW: Security Check for Allowed File Types ---
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
        if (!allowedTypes.includes(fileType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid file type. Only JPG, PNG, WEBP, and MP4 are allowed."
            });
        }

        // Sanitize spaces out of the filename
        const safeOriginalName = originalName.replace(/\s+/g, '-');
        const uniqueFileName = `${crypto.randomUUID()}-${safeOriginalName}`;

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: uniqueFileName,
            ContentType: fileType,
        });

        // Generate a URL that expires in 60 seconds
        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

        // The public URL where the file will live (requires R2 public access enabled)
        const publicUrl = `${process.env.R2_PUBLIC_URL}${uniqueFileName}`;

        return res.json({ success: true, data: { uploadUrl, publicUrl } });
    } catch (error) {
        console.log("Predesigned URL Error", error);
        return res.status(500).json({ success: false, message: "Failed to generate upload URL" });
    }
});


module.exports = mediaRouter