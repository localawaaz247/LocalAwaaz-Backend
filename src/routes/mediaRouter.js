const express = require('express');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');

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
mediaRouter.post("/get-upload-urls", userAuth, profileAuth, async (req, res) => {
    try {
        const { files } = req.body; // Expecting an array: [{ fileType: "...", originalName: "..." }]

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ success: false, message: "No files provided" });
        }
        if (files.length > 3) {
            return res.status(400).json({ success: false, message: "Only 3 media is allowed" });
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

        // We use Promise.all to generate all URLs concurrently (makes it super fast)
        const uploadData = await Promise.all(files.map(async (file) => {
            if (!allowedTypes.includes(file.fileType)) {
                throw new Error(`Invalid file type: ${file.fileType}`);
            }

            const safeOriginalName = file.originalName.replace(/\s+/g, '-');
            const uniqueFileName = `${crypto.randomUUID()}-${safeOriginalName}`;

            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: uniqueFileName,
                ContentType: file.fileType,
            });

            const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
            const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`;

            return { uploadUrl, publicUrl, originalName: file.originalName };
        }));

        return res.status(200).json({ success: true, message: "Upload data sent", data: uploadData });
    } catch (error) {
        console.error("Presigned URLs Error", error);
        return res.status(500).json({ success: false, message: "Failed to generate URLs" });
    }
});

module.exports = mediaRouter