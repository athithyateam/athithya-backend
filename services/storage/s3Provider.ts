import path from "path";
import { v4 as uuidv4 } from "uuid";
import { BadRequestError } from "../../errors";
const { DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { getS3Client } = require("../../clients/s3Client");

export interface StorageUploadResult {
    secure_url: string;
    public_id: string;
    resource_type: string;
}

export interface PresignedUrlResult {
    uploadUrl: string;
    fileUrl: string;
    key: string;
    resource_type: string;
}

export interface StorageProvider {
    upload(file: any, folder?: string): Promise<StorageUploadResult>;
    delete(key: string): Promise<void>;
    generatePresignedUploadUrl?(
        filenameOrOptions: string | { filename: string; fileType: string; fileSize?: number | string; type?: string },
        fileType?: string,
        fileSize?: number | string,
        type?: string
    ): Promise<PresignedUrlResult>;
}

export class S3StorageProvider implements StorageProvider {
    private client: any;

    constructor(client: any = null) {
        this.client = client;
    }

    private getClient(): any {
        return this.client || getS3Client();
    }

    /**
     * Upload file buffer to AWS S3
     * Clean positional arguments: (file, folder)
     */
    public async upload(
        fileOrParams: any,
        folder: string = ""
    ): Promise<StorageUploadResult> {
        let file: any;
        let destFolder: string = folder;

        if (fileOrParams && fileOrParams.file) {
            file = fileOrParams.file;
            if (fileOrParams.folder !== undefined) destFolder = fileOrParams.folder;
        } else {
            file = fileOrParams;
        }

        if (!file || !file.buffer) {
            throw new Error("File buffer is required for upload");
        }

        const ext = path.extname(file.originalname) || "";
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "");
        const key = destFolder ? `${destFolder}/${base}-${uuidv4()}${ext}` : `${base}-${uuidv4()}${ext}`;
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
            resource_type: file.mimetype && file.mimetype.startsWith("video") ? "video" : "image"
        };
    }

    /**
     * Delete object from AWS S3 by key
     */
    public async delete(key: string): Promise<void> {
        if (!key) return;
        try {
            await this.getClient().send(new DeleteObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key
            }));
        } catch (error: any) {
            console.error(`S3 delete error for key ${key}:`, error.message || error);
        }
    }

    /**
     * Generate pre-signed PUT URL for client-side direct upload
     * Primary positional parameters: (filename, fileType, fileSize, type)
     */
    public async generatePresignedUploadUrl(
        filenameOrOptions: string | { filename: string; fileType: string; fileSize?: number | string; type?: string },
        fileType?: string,
        fileSize?: number | string,
        type?: string
    ): Promise<PresignedUrlResult> {
        let name: string;
        let mime: string;
        let size: number | string | undefined = fileSize;
        let targetType: string | undefined = type;

        if (typeof filenameOrOptions === "object" && filenameOrOptions !== null) {
            name = filenameOrOptions.filename;
            mime = filenameOrOptions.fileType;
            size = filenameOrOptions.fileSize;
            targetType = filenameOrOptions.type;
        } else {
            name = filenameOrOptions as string;
            mime = fileType || "";
        }

        if (!name || !mime) {
            throw new BadRequestError("filename and fileType are required");
        }

        const allowedTypes = [
            "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
            "video/mp4", "video/webm", "video/quicktime", "video/ogg", "application/pdf"
        ];

        if (!allowedTypes.includes(mime.toLowerCase())) {
            throw new BadRequestError("Invalid file type. Only standard images, videos, and PDF documents are allowed.");
        }

        if (size) {
            const sizeLimit = mime.toLowerCase().startsWith("video") ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
            if (Number(size) > sizeLimit) {
                throw new BadRequestError(`File size exceeds the limit. Maximum allowed is ${mime.toLowerCase().startsWith("video") ? "20MB for videos" : "10MB for photos/documents"}.`);
            }
        }

        const ext = path.extname(name) || "";
        const base = path.basename(name, ext).replace(/[^a-zA-Z0-9]/g, "");

        let folder = "posts";
        if (targetType === "avatars") {
            folder = "avatars";
        } else if (targetType === "verification") {
            folder = "verification";
        } else if (targetType === "personal") {
            folder = "personal";
        }

        const key = `${folder}/${base}-${uuidv4()}${ext}`;
        const bucketName = process.env.AWS_BUCKET_NAME;
        const region = process.env.AWS_REGION;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: mime
        });

        // Pre-signed URL valid for 15 minutes (900 seconds)
        const uploadUrl = await getSignedUrl(this.getClient(), command, { expiresIn: 900 });
        const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

        return {
            uploadUrl,
            fileUrl,
            key,
            resource_type: mime.startsWith("video") ? "video" : "image"
        };
    }
}

export default S3StorageProvider;

module.exports = S3StorageProvider;
module.exports.S3StorageProvider = S3StorageProvider;
module.exports.default = S3StorageProvider;
