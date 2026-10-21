const S3StorageProvider = require('./storage/s3Provider');

/**
 * Storage Service
 * Abstract storage coordinator supporting dependency injection of storage providers.
 */
class StorageService {
    constructor(provider = new S3StorageProvider()) {
        this.provider = provider;
    }

    /**
     * Set/swap underlying storage provider at runtime
     */
    setProvider(provider) {
        this.provider = provider;
    }

    /**
     * Upload file via active storage provider
     * @param {Object} file - File object with buffer and mimetype
     * @param {string} [folder=''] - Destination folder
     */
    async upload(file, folder = '') {
        return await this.provider.upload({ file, folder });
    }

    /**
     * Delete file by key via active storage provider
     * @param {string} key - File identifier / key
     */
    async delete(key) {
        return await this.provider.delete(key);
    }

    /**
     * Generate pre-signed upload URL (if provider supports it)
     * @param {Object} params - { filename, fileType, fileSize, type }
     */
    async generatePresignedUploadUrl(params) {
        if (typeof this.provider.generatePresignedUploadUrl !== 'function') {
            const error = new Error("Current storage provider does not support pre-signed upload URLs");
            error.statusCode = 501;
            throw error;
        }
        return await this.provider.generatePresignedUploadUrl(params);
    }
}

// Default singleton instance
const defaultStorageService = new StorageService();

module.exports = {
    StorageService,
    S3StorageProvider,
    storageService: defaultStorageService,

    // Standalone convenience exports
    upload: (file, folder) => defaultStorageService.upload(file, folder),
    deleteFile: (key) => defaultStorageService.delete(key),
    generatePresignedUploadUrl: (params) => defaultStorageService.generatePresignedUploadUrl(params),

    // Backward compatibility aliases
    uploadToS3: (file, folder) => defaultStorageService.upload(file, folder),
    deleteFromS3: (key) => defaultStorageService.delete(key)
};
