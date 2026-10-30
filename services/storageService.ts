import S3StorageProvider, { StorageProvider, StorageUploadResult, PresignedUrlResult } from "./storage/s3Provider";

export { StorageProvider, StorageUploadResult, PresignedUrlResult, S3StorageProvider };

export class StorageService {
    private static instance: StorageService | null = null;
    private static instanceKey = Symbol("StorageServiceInstanceKey");

    private provider: StorageProvider;

    constructor(instanceKey: symbol, provider: StorageProvider = new S3StorageProvider()) {
        if (instanceKey !== StorageService.instanceKey) {
            throw new Error("Please use StorageService.getInstance() to retrieve or create an instance");
        }
        this.provider = provider;
    }

    public static getInstance(provider?: StorageProvider): StorageService {
        if (!this.instance) {
            this.instance = new StorageService(this.instanceKey, provider);
        }
        return this.instance;
    }

    /**
     * Set or swap underlying storage provider at runtime
     */
    public setProvider(provider: StorageProvider): void {
        this.provider = provider;
    }

    /**
     * Upload file via active storage provider
     * Positional parameters: (file, folder)
     */
    public async upload(file: any, folder: string = ""): Promise<StorageUploadResult> {
        return await this.provider.upload(file, folder);
    }

    /**
     * Delete file by key via active storage provider
     * Positional parameter: (key)
     */
    public async delete(key: string): Promise<void> {
        return await this.provider.delete(key);
    }

    /**
     * Generate pre-signed upload URL (if provider supports it)
     * Positional parameters: (filename, fileType, fileSize, type)
     */
    public async generatePresignedUploadUrl(
        filenameOrOptions: string | { filename: string; fileType: string; fileSize?: number | string; type?: string },
        fileType?: string,
        fileSize?: number | string,
        type?: string
    ): Promise<PresignedUrlResult> {
        if (!this.provider.generatePresignedUploadUrl || typeof this.provider.generatePresignedUploadUrl !== "function") {
            const error: any = new Error("Current storage provider does not support pre-signed upload URLs");
            error.statusCode = 501;
            throw error;
        }
        return await this.provider.generatePresignedUploadUrl(filenameOrOptions, fileType, fileSize, type);
    }
}

export const storageService = StorageService.getInstance();
export default StorageService;

// Convenience function exports for backward compatibility
export const upload = (file: any, folder: string = "") => storageService.upload(file, folder);
export const deleteFile = (key: string) => storageService.delete(key);
export const generatePresignedUploadUrl = (
    filenameOrOptions: string | { filename: string; fileType: string; fileSize?: number | string; type?: string },
    fileType?: string,
    fileSize?: number | string,
    type?: string
) => storageService.generatePresignedUploadUrl(filenameOrOptions, fileType, fileSize, type);

export const uploadToS3 = (file: any, folder: string = "") => storageService.upload(file, folder);
export const deleteFromS3 = (key: string) => storageService.delete(key);
export const getPresignedUploadUrl = generatePresignedUploadUrl;

// CommonJS compatibility
module.exports = storageService;
module.exports.StorageService = StorageService;
module.exports.S3StorageProvider = S3StorageProvider;
module.exports.storageService = storageService;
module.exports.upload = upload;
module.exports.deleteFile = deleteFile;
module.exports.generatePresignedUploadUrl = generatePresignedUploadUrl;
module.exports.getPresignedUploadUrl = generatePresignedUploadUrl;
module.exports.uploadToS3 = uploadToS3;
module.exports.deleteFromS3 = deleteFromS3;
module.exports.default = StorageService;
