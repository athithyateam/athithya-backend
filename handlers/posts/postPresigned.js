const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getS3Client } = require('../../utils/s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

exports.getPresignedUrl = async (req, res) => {
    try {
        const { filename, fileType, fileSize, type } = req.query;
        if (!filename || !fileType) {
            return res.status(400).json({ success: false, message: "filename and fileType query parameters are required" });
        }

        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
            'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg', 'application/pdf'
        ];

        if (!allowedTypes.includes(fileType.toLowerCase())) {
            return res.status(400).json({ success: false, message: "Invalid file type. Only standard images, videos, and PDF documents are allowed." });
        }

        if (fileSize) {
            const sizeLimit = fileType.toLowerCase().startsWith('video') ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
            if (Number(fileSize) > sizeLimit) {
                return res.status(400).json({ 
                    success: false, 
                    message: `File size exceeds the limit. Maximum allowed is ${fileType.toLowerCase().startsWith('video') ? '20MB for videos' : '10MB for photos/documents'}.` 
                });
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

        const client = getS3Client();
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            ContentType: fileType
        });

        // Presigned URL valid for 15 minutes (900 seconds)
        const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

        const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        res.json({
            success: true,
            uploadUrl,
            fileUrl,
            key,
            resource_type: fileType.startsWith('video') ? 'video' : 'image'
        });
    } catch (error) {
        console.error("Presigned URL generation error:", error);
        res.status(500).json({ success: false, message: "Error generating presigned URL", error: error.message });
    }
};
