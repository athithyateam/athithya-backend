const { S3Client } = require('@aws-sdk/client-s3');

let s3ClientInstance = null;

/**
 * Initializes and returns the shared AWS S3Client instance.
 */
const getS3Client = () => {
    if (!s3ClientInstance) {
        s3ClientInstance = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            },
            requestChecksumCalculation: "WHEN_REQUIRED"
        });
    }
    return s3ClientInstance;
};

module.exports = {
    getS3Client
};
