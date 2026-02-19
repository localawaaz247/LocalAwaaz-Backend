const express = require('express');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const fs = require('fs');
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');

ffmpeg.setFfmpegPath(ffmpegPath);

const mediaRouter = express.Router();

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// Enforces the 150MB raw limit directly at the upload level
const upload = multer({
    dest: 'temp_uploads/',
    limits: { fileSize: 150 * 1024 * 1024 }
});

const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

const compressVideo = (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            .videoCodec('libx264')
            .videoFilters("scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2")
            .audioCodec('aac')
            .audioBitrate('128k')
            .outputOptions([
                '-preset veryfast',
                '-crf 28',
                '-maxrate 2500k',
                '-bufsize 5000k',
                '-movflags +faststart'
            ])
            .on('end', () => resolve(outputPath))
            .on('error', (err) => {
                console.error('FFmpeg compression failed:', err);
                reject(err);
            })
            .run();
    });
};

const compressImage = async (inputPath, outputPath) => {
    await sharp(inputPath)
        .resize({ width: 1280, withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toFile(outputPath);
};

mediaRouter.post("/upload-issues", userAuth, profileAuth, upload.array('issue_media', 3), async (req, res) => {
    req.setTimeout(600000);

    try {
        let files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "No media attached." });
        }

        let initialSize = files.reduce((acc, file) => acc + file.size, 0);
        let manualFinalSize = 0;

        if (initialSize > MAX_TOTAL_BYTES) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const inputPath = file.path;
                const ext = file.originalname.split('.').pop().toLowerCase();

                const isVideo = file.mimetype.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv'].includes(ext);
                const isImage = file.mimetype.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

                if (isVideo) {
                    const outputPath = `${inputPath}_compressed.mp4`;

                    try {
                        await compressVideo(inputPath, outputPath);
                        const newStats = fs.statSync(outputPath);

                        files[i].path = outputPath;
                        files[i].size = newStats.size;
                        files[i].mimetype = 'video/mp4';
                        files[i].originalname = file.originalname.replace(/\.[^/.]+$/, ".mp4");
                        manualFinalSize += newStats.size;

                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    } catch (err) {
                        manualFinalSize += file.size;
                    }
                } else if (isImage) {
                    const outputPath = `${inputPath}_compressed.jpg`;

                    try {
                        await compressImage(inputPath, outputPath);
                        const newStats = fs.statSync(outputPath);

                        files[i].path = outputPath;
                        files[i].size = newStats.size;
                        files[i].mimetype = 'image/jpeg';
                        files[i].originalname = file.originalname.replace(/\.[^/.]+$/, ".jpg");
                        manualFinalSize += newStats.size;

                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    } catch (err) {
                        manualFinalSize += file.size;
                    }
                } else {
                    manualFinalSize += file.size;
                }
            }
        } else {
            manualFinalSize = initialSize;
        }

        if (manualFinalSize > MAX_TOTAL_BYTES) {
            files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) });
            return res.status(400).json({
                success: false,
                message: `Total size exceeds the 30MB limit after processing.`
            });
        }

        const uploadedMediaData = await Promise.all(files.map(async (file) => {
            const safeName = file.originalname.replace(/\s+/g, '-');
            const uniqueFileName = `${crypto.randomUUID()}-${safeName}`;
            const fileStream = fs.createReadStream(file.path);

            const command = new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: uniqueFileName,
                Body: fileStream,
                ContentType: file.mimetype,
            });

            await s3.send(command);
            return {
                publicUrl: `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`,
                originalName: file.originalname
            };
        }));

        files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) });

        return res.status(200).json({
            success: true,
            message: "Media processed and uploaded successfully.",
            data: uploadedMediaData
        });

    } catch (error) {
        console.error("Server error during media upload:", error);

        if (req.files) {
            req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) });
        }

        // Handles the specific error thrown by Multer if the raw file is over 150MB
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: "A file exceeded the 150MB raw upload limit." });
        }

        return res.status(500).json({ success: false, message: "An internal server error occurred." });
    }
});

module.exports = mediaRouter;