import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
const storage = require("../services/storageService");
const { generatePresignedUploadUrl, upload, deleteFile, StorageService } = require("../services/storageService");

describe("StorageService & Presigned URL Infinite Recursion Guard", () => {
    let mockProvider: any;

    beforeEach(() => {
        mockProvider = {
            generatePresignedUploadUrl: async (name: any, type: any, size: any, category: any) => ({
                uploadUrl: "https://bucket.s3.amazonaws.com/upload",
                fileUrl: "https://bucket.s3.amazonaws.com/file",
                key: `test/${name}`,
                resource_type: "image"
            }),
            upload: async (file: any, folder: any) => ({
                secure_url: "https://bucket.s3.amazonaws.com/file",
                public_id: "test/key",
                resource_type: "image"
            }),
            delete: async (key: any) => {}
        };
        storage.setProvider(mockProvider);
    });

    it("standalone generatePresignedUploadUrl does not trigger RangeError: Maximum call stack size exceeded", async () => {
        const result = await generatePresignedUploadUrl("image.png", "image/png", 397059, "experiences");
        assert.ok(result);
        assert.strictEqual(result.uploadUrl, "https://bucket.s3.amazonaws.com/upload");
        assert.strictEqual(result.key, "test/image.png");
    });

    it("storageService instance generatePresignedUploadUrl does not trigger RangeError: Maximum call stack size exceeded", async () => {
        const result = await storage.generatePresignedUploadUrl("image.png", "image/png", 397059, "experiences");
        assert.ok(result);
        assert.strictEqual(result.uploadUrl, "https://bucket.s3.amazonaws.com/upload");
    });

    it("standalone upload function does not trigger RangeError: Maximum call stack size exceeded", async () => {
        const result = await upload({ originalname: "image.png", buffer: Buffer.from("test") }, "experiences");
        assert.ok(result);
        assert.strictEqual(result.public_id, "test/key");
    });

    it("standalone deleteFile function operates safely", async () => {
        await assert.doesNotReject(async () => {
            await deleteFile("test/key");
        });
    });
});
