const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getS3Client } = require('../../clients/s3Client');

class S3StorageProvider {
    constructor(client = null) {
        this.client = client;
    }

    getClient() {
        return this.client || getS3Client();
    }

    /**
     * Upload file buffer to AWS S3
     * @param {Object} params
     * @param {Object} params.file - Multer file object (buffer, originalname, mimetype)
     * @param {string} [params.folder=''] - S3 subfolder prefix
     * @returns {Promise<{ secure_url: string, public_id: string, resource_type: string }>}
     */
    async upload({ file, folder = '' }) {
        if (!file || !file.buffer) {
            throw new Error("File buffer is required for upload");
        }

        const ext = path.extname(file.originalname) || '';
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '');
        const key = folder ? `${folder}/${base}-${uuidv4()}${ext}` : `${base}-${uuidv4()}${ext}`;
        const bucketName = process.env.AWS_BUCKET_NAME;
        const region = process.env.AWS_REGION;

        const upload = new Upload({
            client: this.getClient(),
            params: {
                Bucket: bucketName,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }
        });

        await upload.done();

        return {
            secure_url: `https://${bucketName}.s3.${region}.amazonaws.com/${key}`,
            public_id: key,
            resource_type: file.mimetype.startsWith('video') ? 'video' : 'image'
        };
    }

    /**
     * Delete object from AWS S3 by key
     * @param {string} key - S3 object key (public_id)
     */
    async delete(key) {
        if (!key) return;
        try {
            await this.getClient().send(new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key
            }));
        } catch (error) {
            console.error(`S3 delete error for key ${key}:`, error.message || error);
        }
    }

    /**
     * Generate pre-signed PUT URL for client-side direct upload
     * @param {Object} params
     * @param {string} params.filename - Original file name
     * @param {string} params.fileType - MIME type
     * @param {number|string} [params.fileSize] - File size in bytes
     * @param {string} [params.type] - Target type ('avatars', 'verification', 'personal', 'posts')
     */
    async generatePresignedUploadUrl({ filename, fileType, fileSize, type }) {
        if (!filename || !fileType) {
            const error = new Error("filename and fileType are required");
            error.statusCode = 400;
            throw error;
        }

        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
            'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg', 'application/pdf'
        ];

        if (!allowedTypes.includes(fileType.toLowerCase())) {
            const error = new Error("Invalid file type. Only standard images, videos, and PDF documents are allowed.");
            error.statusCode = 400;
            throw error;
        }

        if (fileSize) {
            const sizeLimit = fileType.toLowerCase().startsWith('video') ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
            if (Number(fileSize) > sizeLimit) {
                const error = new Error(`File size exceeds the limit. Maximum allowed is ${fileType.toLowerCase().startsWith('video') ? '20MB for videos' : '10MB for photos/documents'}.`);
                error.statusCode = 400;
                throw error;
            }
        }

        const ext = path.extname(filename) || '';
        const base = path.basename(filename, ext).replace(/[^a-zA-Z0-9]/g, '');

        let folder = 'posts';
        if (type === 'avatars') {
            folder = 'avatars';
        } else if (type === 'verification') {
            folder = 'verification';
        } else if (type === 'personal') {
            folder = 'personal';
        }

        const key = `${folder}/${base}-${uuidv4()}${ext}`;
        const bucketName = process.env.AWS_BUCKET_NAME;
        const region = process.env.AWS_REGION;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: fileType
        });

        // Pre-signed URL valid for 15 minutes (900 seconds)
        const uploadUrl = await getSignedUrl(this.getClient(), command, { expiresIn: 900 });
        const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

        return {
            uploadUrl,
            fileUrl,
            key,
            resource_type: fileType.startsWith('video') ? 'video' : 'image'
        };
    }
}

module.exports = S3StorageProvider;
