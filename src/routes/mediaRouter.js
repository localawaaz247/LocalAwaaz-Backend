const express = require('express');
const multer = require('multer');
const crypto = require("crypto");
const userAuth = require('../middlewares/userAuth');
const profileAuth = require('../middlewares/profileAuth');
const { mediaQueue } = require('../workers/queue');
const Issue = require('../models/Issue');

const mediaRouter = express.Router();

const upload = multer({
    dest: 'temp_uploads/',
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB raw limit per file
});

const uploadMiddleware = upload.array('issue_media', 3);

mediaRouter.post("/upload-issues", userAuth, profileAuth, (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: "A file exceeds the 100MB raw upload limit." });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ success: false, message: "Maximum 3 media files allowed." });
            }
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        let files = req.files;

        // --- Enforce Minimum 1 File ---
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: "At least one media file is required." });
        }

        // --- Generate the Token ---
        const uploadToken = crypto.randomUUID();

        const filesData = files.map(file => ({
            path: file.path,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        }));

        // --- Queue the Job ---
        await mediaQueue.add('compress-and-upload', {
            uploadToken: uploadToken,
            userId: req.userId,
            files: filesData
        });

        // --- Return Token Instantly ---
        return res.status(200).json({
            success: true,
            message: "Media received and processing in the background.",
            uploadToken: uploadToken // Frontend must send this to /create-issue
        });

    } catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// --- RE-UPLOAD FAILED MEDIA ROUTE ---
mediaRouter.post('/reupload-media/:id', userAuth, upload.array('issue_media', 5), async (req, res) => {
    try {
        const issueId = req.params.id;

        // 1. Find the failed issue
        const issue = await Issue.findById(issueId);
        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found." });
        }

        // 2. Security Check: Did it actually fail?
        if (!issue.mediaFailed) {
            return res.status(400).json({ success: false, message: "This issue does not need a media re-upload." });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No new media provided for re-upload." });
        }

        // 3. Prepare files for the worker
        const filesToProcess = req.files.map(file => ({
            path: file.path,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        }));

        // 4. Reset the database flags immediately
        issue.mediaProcessing = true;
        issue.mediaFailed = false;
        await issue.save();

        // 5. Throw it back into BullMQ using the ORIGINAL token!
        await mediaQueue.add('media-processing', {
            uploadToken: issue.uploadToken,
            userId: issue.reportedBy || req.user?.id, // Fallback if you have auth
            files: filesToProcess
        });

        console.log(`♻️ Re-upload triggered for Issue: ${issue._id}`);

        res.status(200).json({
            success: true,
            message: "Media queued for processing.",
            issueId: issue._id
        });

    } catch (error) {
        console.error("Re-upload Error:", error);
        res.status(500).json({ success: false, message: "Server error during re-upload." });
    }
});

module.exports = mediaRouter;