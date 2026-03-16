const express = require('express');
const multer = require('multer');
const crypto = require("crypto");
const fs = require('fs');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');
const TempMedia = require('../models/TempMedia');
const statusAuth = require('../middlewares/statusAuth');

const mediaRouter = express.Router();

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const upload = multer({
    dest: 'temp_uploads/', // 🟢 Reverted back to your original setup
    limits: {
        fileSize: 30 * 1024 * 1024, // Max size per individual file (allows flexibility for the combined limit)
        files: 3 // Max 3 files
    },
    fileFilter: (req, file, cb) => {
        // Strict whitelist prevents malicious SVG uploads
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("FILE_TYPE_NOT_SUPPORTED"), false);
        }
    }
});

const uploadMiddleware = upload.array('issue_media', 3);

mediaRouter.post("/upload-issues", userAuth, statusAuth, profileAuth, (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: "One of your files exceeds the 30MB limit." });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ success: false, message: "You can only upload a maximum of 3 images." });
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
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded." });
        }

        // Enforce COMBINED 30MB limit
        const MAX_TOTAL_SIZE = 30 * 1024 * 1024;
        const totalSize = files.reduce((acc, file) => acc + file.size, 0);

        if (totalSize > MAX_TOTAL_SIZE) {
            console.log(`⚠️ Upload rejected. Total size ${totalSize} exceeds 30MB.`);
            files.forEach(f => {
                if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
            });
            return res.status(400).json({
                success: false,
                message: "Total combined file size exceeds the 30MB limit. Please compress your images."
            });
        }

        const uploadedUrls = [];
        console.log(`🚀 Starting Direct Upload for ${files.length} images...`);

        for (const file of files) {
            try {
                const fileStream = fs.createReadStream(file.path);
                const uniqueFileName = `${crypto.randomUUID()}-${file.originalname.replace(/\s+/g, '-')}`;

                const command = new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: uniqueFileName,
                    Body: fileStream,
                    ContentType: file.mimetype,
                });

                await s3.send(command);

                const publicUrl = `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`;
                uploadedUrls.push(publicUrl);

                await TempMedia.create({
                    url: publicUrl,
                    r2Key: uniqueFileName
                });

                console.log(`✅ Uploaded & Tracked: ${uniqueFileName}`);

                // Clean up local temp file immediately after success
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

            } catch (uploadErr) {
                console.error(`❌ Failed to upload ${file.originalname} to Cloudflare:`, uploadErr);
                // Throwing the error here breaks the loop immediately (Fail-Fast)
                throw new Error("CLOUDFLARE_UPLOAD_FAILED");
            }
        }

        return res.status(200).json({
            success: true,
            message: "Images uploaded successfully.",
            media: uploadedUrls
        });

    } catch (error) {
        console.error("Upload Process Error:", error);

        // Guarantee ALL remaining local files in temp_uploads/ are cleaned up if the process aborted
        if (req.files) {
            req.files.forEach(f => {
                if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
            });
        }

        // Send the user-friendly error to try again
        if (error.message === "CLOUDFLARE_UPLOAD_FAILED") {
            return res.status(500).json({
                success: false,
                message: "A network issue occurred while saving your images. Please try uploading them one more time."
            });
        }

        return res.status(500).json({ success: false, message: "Server error during upload." });
    }
});

const uploadAvatarMiddleware = upload.single('file');

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
        // Prefix with 'avatar-' for easier organization in your R2 bucket
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

        // Clean up local temp file immediately after success
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        // Send back the publicUrl exactly as the frontend expects
        return res.status(200).json({
            success: true,
            message: "Profile picture uploaded successfully.",
            publicUrl: publicUrl
        });

    } catch (error) {
        console.error("Avatar Upload Error:", error);

        // Guarantee cleanup if upload fails
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.status(500).json({
            success: false,
            message: "A network issue occurred while saving your image."
        });
    }
});

module.exports = mediaRouter;