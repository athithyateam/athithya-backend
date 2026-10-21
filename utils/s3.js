/**
 * S3 Storage Compatibility Wrapper
 * Core storage service is located at services/storageService.js
 * S3 client wrapper is located at clients/s3Client.js
 */
const { getS3Client } = require('../clients/s3Client');
const { uploadToS3, deleteFromS3, storageService } = require('../services/storageService');

module.exports = {
    getS3Client,
    uploadToS3,
    deleteFromS3,
    storageService
};
