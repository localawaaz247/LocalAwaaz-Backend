const express = require('express');
const crypto = require("crypto");
const path = require('path');
const {
    S3Client,
    PutObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');
const statusAuth = require('../middlewares/statusAuth');
const uploadAuth = require('../middlewares/uploadAuth');
const TempMedia = require('../models/TempMedia');

const mediaRouter = express.Router();

// --- S3 / CLOUDFLARE R2 CLIENT ---
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const getISTDateString = () => {
    const date = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffset);
    return istDate.toISOString().split('T')[0];
};

// ============================================================================
// UPPY DIRECT-TO-CLOUD MULTIPART UPLOAD ENDPOINTS (For Issues: max 5 files, 300MB)
// ============================================================================

// 1. Initiate Multipart Upload
mediaRouter.post('/multipart/create', userAuth, statusAuth, profileAuth, async (req, res) => {
    try {
        const { filename, type, metadata } = req.body;
        if (!filename) throw new Error("Filename is missing from frontend payload");

        // Smart Naming Convention
        const safeCategory = (metadata?.category || "Issue").replace(/[^a-zA-Z0-9]/g, '-');
        const safeCity = (metadata?.location?.city || "Unknown-City").replace(/[^a-zA-Z0-9]/g, '-');
        const dateStr = getISTDateString();

        const fileExtension = path.extname(filename) || '.mp4';
        const uniqueString = crypto.randomBytes(3).toString('hex');

        // Example: issues/user123/ROAD-POTHOLES-Mumbai-2026-04-06-a1b2c3.mp4
        const smartFileName = `${safeCategory}-${safeCity}-${dateStr}-${uniqueString}${fileExtension}`;
        const key = `issues/${req.userId}/${smartFileName}`;

        const command = new CreateMultipartUploadCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            ContentType: type
        });

        const upload = await s3.send(command);
        res.status(200).json({ uploadId: upload.UploadId, key: key });

    } catch (error) {
        console.error("🔥 CRASH IN /multipart/create:", error);
        res.status(500).json({ error: "Failed to initiate upload." });
    }
});

// 2. Sign Individual Chunks
mediaRouter.post('/multipart/sign', userAuth, statusAuth, profileAuth, async (req, res) => {
    try {
        const { uploadId, key, partNumber } = req.body;

        const command = new UploadPartCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
        });

        // Generate a pre-signed URL valid for 1 hour for this specific chunk
        const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
        res.status(200).json({ url });

    } catch (error) {
        console.error("🔥 CRASH IN /multipart/sign:", error);
        res.status(500).json({ error: "Failed to sign part" });
    }
});

// 3. Complete and Stitch Files
mediaRouter.post('/multipart/complete', userAuth, statusAuth, profileAuth, async (req, res) => {
    try {
        const { uploadId, key, parts } = req.body;

        // CRITICAL: Cloudflare R2 requires parts to be strictly sorted numerically
        const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);

        const command = new CompleteMultipartUploadCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: sortedParts }
        });

        await s3.send(command);

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
        res.status(200).json({ location: publicUrl });

    } catch (error) {
        console.error("🔥 CRASH IN /multipart/complete:", error);
        res.status(500).json({ error: "Failed to complete upload" });
    }
});

// 4. Abort on Cancellation
mediaRouter.post('/multipart/abort', userAuth, statusAuth, profileAuth, async (req, res) => {
    try {
        const { uploadId, key } = req.body;

        const command = new AbortMultipartUploadCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            UploadId: uploadId
        });

        await s3.send(command);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error("🔥 CRASH IN /multipart/abort:", error);
        res.status(500).json({ error: "Failed to abort" });
    }
});

// ============================================================================
// PRE-SIGNED URL FOR DOCUMENTS (ID Proofs and single documents)
// ============================================================================

mediaRouter.get("/document/presign", uploadAuth, async (req, res) => {
    try {
        const { fileType = "application/pdf" } = req.query;
        const uniqueKey = `documents/doc-${crypto.randomUUID()}`;

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: uniqueKey,
            ContentType: fileType
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueKey}`;

        // 👇 LOG THIS FILE IN TEMP MEDIA BEFORE RESPONDING
        await TempMedia.create({
            r2Key: uniqueKey,
            url: publicUrl
        });

        return res.status(200).json({ success: true, uploadUrl, publicUrl });
    } catch (error) {
        console.error("Document Presign Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate secure upload link." });
    }
});

// ============================================================================
// PRE-SIGNED URL FOR AVATARS 
// ============================================================================

mediaRouter.get("/avatar/presign", userAuth, statusAuth, async (req, res) => {
    try {
        const { fileType = "image/jpeg" } = req.query;
        const userId = req.userId;
        const uniqueKey = `avatars/${userId}-${crypto.randomUUID()}`;

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: uniqueKey,
            ContentType: fileType
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueKey}`;

        // 👇 LOG THIS FILE IN TEMP MEDIA BEFORE RESPONDING
        await TempMedia.create({
            r2Key: uniqueKey,
            url: publicUrl
        });

        return res.status(200).json({ success: true, uploadUrl, publicUrl });
    } catch (error) {
        console.error("Avatar Presign Error:", error);
        return res.status(500).json({ success: false, message: "Failed to generate secure upload link." });
    }
});

module.exports = mediaRouter;