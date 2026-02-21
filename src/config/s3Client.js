// config/s3Client.js (or wherever you prefer to keep config files)
const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
    // For Cloudflare R2, the region is typically set to "auto"
    region: "auto",

    // The specific URL pointing to your Cloudflare account's storage
    endpoint: process.env.R2_ENDPOINT,

    credentials: {
        // Your public key
        accessKeyId: process.env.R2_ACCESS_KEY_ID,

        // Your highly sensitive private key
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

module.exports = s3Client;