const express = require('express');
const multer = require('multer');
const crypto = require("crypto");
const fs = require('fs');
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
const TempMedia = require('../models/TempMedia');
const statusAuth = require('../middlewares/statusAuth');

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
// AVATAR UPLOAD (Kept untouched because Multer is fine for small 1-off images)
// ============================================================================

const uploadAvatar = multer({
    dest: 'temp_uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for avatar
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("FILE_TYPE_NOT_SUPPORTED"), false);
        }
    }
});

const uploadAvatarMiddleware = uploadAvatar.single('file');

mediaRouter.post("/upload-avatar", userAuth, statusAuth, (req, res, next) => {
    uploadAvatarMiddleware(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: "Image exceeds the maximum allowed size." });
            }
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            if (err.message === "FILE_TYPE_NOT_SUPPORTED") {
                return res.status(400).json({ success: false, message: "Only image files (JPG, PNG, WEBP, GIF) are allowed." });
            }
            return res.status(500).json({ success: false, message: "An unexpected error occurred during upload." });
        }
        next();
    });
}, async (req, res) => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: "No file uploaded." });
        }

        console.log(`🚀 Starting Direct Upload for Avatar...`);

        const fileStream = fs.createReadStream(file.path);
        const uniqueFileName = `avatar-${crypto.randomUUID()}-${file.originalname.replace(/\s+/g, '-')}`;

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: uniqueFileName,
            Body: fileStream,
            ContentType: file.mimetype,
        });

        await s3.send(command);

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`;
        console.log(`✅ Avatar Uploaded: ${uniqueFileName}`);

        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        return res.status(200).json({
            success: true,
            message: "Profile picture uploaded successfully.",
            publicUrl: publicUrl
        });

    } catch (error) {
        console.error("Avatar Upload Error:", error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({
            success: false,
            message: "A network issue occurred while saving your image."
        });
    }
});

module.exports = mediaRouter;