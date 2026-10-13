// AWS SDK will be required dynamically to prevent cold-start timeouts
const { v4: uuidv4 } = require('uuid');
const path = require('path');

let s3ClientInstance = null;

const getS3Client = () => {
    if (!s3ClientInstance) {
        const { S3Client } = require('@aws-sdk/client-s3');
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

/**
 * Handle file uploads to S3
 * @param {Object} file - The file from multer (must have buffer, originalname, mimetype)
 * @param {string} folder - Optional folder name
 * @returns {Promise<Object>} - Object with secure_url and public_id
 */
const uploadToS3 = async (file, folder = '') => {
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '');
    const key = folder ? `${folder}/${base}-${uuidv4()}${ext}` : `${base}-${uuidv4()}${ext}`;

    const { Upload } = require('@aws-sdk/lib-storage');
    const upload = new Upload({
        client: getS3Client(),
        params: {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        }
    });

    await upload.done();

    return {
        secure_url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        public_id: key,
        resource_type: file.mimetype.startsWith('video') ? 'video' : 'image'
    };
};

/**
 * Delete a file from S3
 * @param {string} key - The S3 object key (public_id)
 * @returns {Promise<void>}
 */
const deleteFromS3 = async (key) => {
    if (!key) return;
    try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await getS3Client().send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key
        }));
    } catch (error) {
        console.error(`S3 delete error for key ${key}:`, error);
    }
};

module.exports = {
    getS3Client,
    uploadToS3,
    deleteFromS3
};
