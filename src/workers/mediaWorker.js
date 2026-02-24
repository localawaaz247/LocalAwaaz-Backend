// const { Worker } = require('bullmq');
// const Redis = require('ioredis');
// const { redisOptions } = require('./queue'); // Import the bulletproof Upstash options
// const fs = require('fs');
// const crypto = require("crypto");
// const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
// const Issue = require('../models/Issue');
// const TempMedia = require('../models/TempMedia');
// const ffmpeg = require('fluent-ffmpeg');
// const ffmpegPath = require('ffmpeg-static');
// const sharp = require('sharp');

// ffmpeg.setFfmpegPath(ffmpegPath);

// const s3 = new S3Client({
//     region: "auto",
//     endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
//     credentials: {
//         accessKeyId: process.env.R2_ACCESS_KEY_ID,
//         secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
//     },
// });

// const compressVideo = (inputPath, outputPath) => {
//     return new Promise((resolve, reject) => {
//         ffmpeg(inputPath)
//             .output(outputPath)
//             .videoCodec('libx264')
//             .videoFilters("scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2")
//             .audioCodec('aac')
//             .audioBitrate('128k')
//             .outputOptions(['-preset veryfast', '-crf 28', '-maxrate 2500k', '-bufsize 5000k', '-movflags +faststart'])
//             .on('end', () => resolve(outputPath))
//             .on('error', (err) => reject(err))
//             .run();
//     });
// };

// const compressImage = async (inputPath, outputPath) => {
//     await sharp(inputPath).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(outputPath);
// };

// // Wrap in a function to receive Socket.io instance
// module.exports = function (io) {
//     console.log("🚀 Initializing Media Worker...");

//     // VERY IMPORTANT: Create a dedicated connection just for this worker so Upstash doesn't close it!
//     const workerConnection = new Redis(process.env.REDIS_URL, redisOptions);

//     workerConnection.on('error', (err) => console.error("❌ Worker Redis Connection Error:", err.message));

//     const worker = new Worker('media-processing', async job => {
//         const { uploadToken, userId, files } = job.data;
//         const uploadedUrls = [];
//         const filesToUpload = [];
//         const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB
//         let finalTotalSize = 0;
//         let workerError = null;

//         console.log(`\n📥 [WORKER] Job ${job.id} picked up for Token: ${uploadToken}`);

//         // --- 1. COMPRESS ---
//         for (const file of files) {
//             let finalPath = file.path;
//             let finalMime = file.mimetype;
//             let finalName = file.originalname;

//             try {
//                 console.log(`⚙️ Compressing: ${file.originalname}...`);
//                 if (file.mimetype.startsWith('video/')) {
//                     finalPath = `${file.path}_compressed.mp4`;
//                     await compressVideo(file.path, finalPath);
//                     finalMime = 'video/mp4';
//                     finalName = file.originalname.replace(/\.[^/.]+$/, ".mp4");
//                 } else if (file.mimetype.startsWith('image/')) {
//                     finalPath = `${file.path}_compressed.jpg`;
//                     await compressImage(file.path, finalPath);
//                     finalMime = 'image/jpeg';
//                     finalName = file.originalname.replace(/\.[^/.]+$/, ".jpg");
//                 }

//                 const stats = fs.statSync(finalPath);
//                 finalTotalSize += stats.size;

//                 filesToUpload.push({ originalPath: file.path, finalPath, finalMime, finalName });
//                 console.log(`✅ Compressed ${file.originalname} -> Final Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
//             } catch (err) {
//                 console.error(`❌ Failed to process ${file.originalname}:`, err);
//             }
//         }

//         // --- 2. SIZE CHECK ---
//         if (finalTotalSize > MAX_TOTAL_BYTES) {
//             console.log(`⚠️ Combined size (${(finalTotalSize / 1024 / 1024).toFixed(2)} MB) exceeds 30MB limit. Aborting.`);
//             workerError = true;

//             // Cleanup local temp files
//             filesToUpload.forEach(f => {
//                 if (fs.existsSync(f.originalPath)) fs.unlinkSync(f.originalPath);
//                 if (fs.existsSync(f.finalPath)) fs.unlinkSync(f.finalPath);
//             });
//             filesToUpload.length = 0; // Empty the array to skip R2 upload
//         }

//         // --- 3. UPLOAD TO R2 ---
//         if (!workerError) {
//             console.log(`☁️ Uploading ${filesToUpload.length} files to Cloudflare R2...`);
//             for (const fileObj of filesToUpload) {
//                 try {
//                     const uniqueFileName = `${crypto.randomUUID()}-${fileObj.finalName.replace(/\s+/g, '-')}`;
//                     const command = new PutObjectCommand({
//                         Bucket: process.env.R2_BUCKET_NAME,
//                         Key: uniqueFileName,
//                         Body: fs.createReadStream(fileObj.finalPath),
//                         ContentType: fileObj.finalMime,
//                     });

//                     await s3.send(command);
//                     uploadedUrls.push(`${process.env.R2_PUBLIC_URL}/${uniqueFileName}`);
//                     console.log(`✅ Uploaded to R2: ${uniqueFileName}`);
//                 } catch (err) {
//                     console.error(`❌ Upload failed for ${fileObj.finalName}:`, err);
//                 } finally {
//                     if (fs.existsSync(fileObj.originalPath)) fs.unlinkSync(fileObj.originalPath);
//                     if (fileObj.finalPath !== fileObj.originalPath && fs.existsSync(fileObj.finalPath)) fs.unlinkSync(fileObj.finalPath);
//                 }
//             }
//         }

//         // --- 4. RACE CONDITION & DATABASE UPDATE ---
//         console.log(`💾 Syncing with Database for Token: ${uploadToken}...`);
//         const existingIssue = await Issue.findOne({ uploadToken });

//         if (existingIssue) {
//             console.log(`🔗 Found existing Issue ${existingIssue._id}. Attaching media!`);

//             // Format strings into objects: [{ url: "link1" }, { url: "link2" }]
//             const formattedMedia = uploadedUrls.map(link => ({ url: link }));

//             await Issue.findByIdAndUpdate(existingIssue._id, {
//                 $push: { media: { $each: formattedMedia } }, // Push the formatted objects
//                 mediaProcessing: false,
//                 mediaFailed: workerError || false
//             });

//             if (io) {
//                 if (workerError) {
//                     io.to(userId.toString()).emit('media_failed_reupload', {
//                         issueId: existingIssue._id,
//                         message: "The media was too large to process. Please select smaller files."
//                     });
//                 } else {
//                     io.to(userId.toString()).emit('media_processing_complete', {
//                         issueId: existingIssue._id,
//                         media: uploadedUrls
//                     });
//                 }
//             }
//         } else {
//             console.log(`⏳ Issue not created yet. Parking media in TempMedia.`);
//             if (workerError) {
//                 await TempMedia.create({ uploadToken, mediaFailed: true });
//             } else if (uploadedUrls.length > 0) {
//                 // Save individual URLs to TempMedia to be collected later
//                 const tempRecords = uploadedUrls.map(url => ({
//                     uploadToken: uploadToken,
//                     url: url,
//                     r2Key: url.split('/').pop() // Extract the filename for the R2 key
//                 }));
//                 await TempMedia.insertMany(tempRecords);
//             }
//         }

//         console.log(`🎉 [WORKER] Finished Job ${job.id}`);

//     }, { connection: workerConnection });

//     worker.on('ready', () => console.log("✅ [WORKER] Ready and listening for jobs on Upstash!"));
//     worker.on('error', (err) => console.error("❌ [WORKER] BullMQ Error:", err.message));
//     worker.on('failed', (job, err) => console.error(`❌ [WORKER] Job ${job.id} failed:`, err.message));
// };