import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
const drive = require("../services/googleDriveService");
const {
    GoogleDriveService,
    googleDriveService,
    syncMediaItems,
    syncMediaFromUrl,
    uploadMediaToDrive,
    deleteMedia,
    deleteMediaFromDrive,
    ensureFolderStructure
} = require("../services/googleDriveService");

describe("GoogleDriveService & Export Shadowing Infinite Recursion Guard", () => {
    it("googleDriveService instance syncMediaItems does not trigger RangeError: Maximum call stack size exceeded", async () => {
        const items = [
            { url: "https://example.com/photo1.jpg" },
            { url: "https://example.com/photo2.png", googleDriveFileId: "already-synced-123" }
        ];

        await assert.doesNotReject(async () => {
            const modified = await googleDriveService.syncMediaItems(items, "EXP_Test_photo", "experiences");
            assert.strictEqual(typeof modified, "boolean");
        });
    });

    it("standalone syncMediaItems does not trigger RangeError: Maximum call stack size exceeded", async () => {
        const items = [
            { url: "https://example.com/video1.mp4" }
        ];

        await assert.doesNotReject(async () => {
            const modified = await syncMediaItems(items, "EXP_Test_video", "experiences", "video/mp4");
            assert.strictEqual(typeof modified, "boolean");
        });
    });

    it("standalone syncMediaFromUrl and uploadMediaToDrive operate without recursion", async () => {
        await assert.doesNotReject(async () => {
            const res1 = await syncMediaFromUrl("https://example.com/test.jpg", "test.jpg", "experiences");
            const res2 = await uploadMediaToDrive("https://example.com/test2.jpg", "test2.jpg", "experiences");
            // If drive client is uninitialized, returns null safely
            assert.strictEqual(res1, null);
            assert.strictEqual(res2, null);
        });
    });

    it("standalone deleteMedia and deleteMediaFromDrive operate without recursion", async () => {
        await assert.doesNotReject(async () => {
            const res1 = await deleteMedia("fake-file-id-1");
            const res2 = await deleteMediaFromDrive("fake-file-id-2");
            assert.strictEqual(typeof res1, "boolean");
            assert.strictEqual(typeof res2, "boolean");
        });
    });

    it("successfully syncs media items when mock drive client is supplied", async () => {
        const mockDrive = {
            files: {
                list: async () => ({
                    data: {
                        files: [
                            { id: "exp-folder-123", name: "Experiences" },
                            { id: "mom-folder-456", name: "Momentos" }
                        ]
                    }
                }),
                create: async (params: any) => ({
                    data: {
                        id: `drive-file-${Date.now()}`,
                        webViewLink: "https://drive.google.com/view/123",
                        webContentLink: "https://drive.google.com/download/123"
                    }
                }),
                delete: async () => ({ data: {} }),
                update: async () => ({ data: {} })
            }
        };

        const mockHttpClient: any = async (config: any) => ({
            data: Buffer.from("fake-binary-image"),
            headers: { "content-type": "image/jpeg" }
        });
        mockHttpClient.get = async () => ({
            data: Buffer.from("fake-binary-image"),
            headers: { "content-type": "image/jpeg" }
        });

        const originalFactory = googleDriveService.driveClientFactory;
        const originalHttp = googleDriveService.httpClient;
        const originalFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        try {
            process.env.GOOGLE_DRIVE_FOLDER_ID = "root-mock-folder";
            googleDriveService.driveClientFactory = () => mockDrive;
            googleDriveService.httpClient = mockHttpClient;

            const items = [{ url: "https://bucket.s3.amazonaws.com/test.jpg" }];
            const modified = await googleDriveService.syncMediaItems(items, "EXP_Custom_photo", "experiences");

            assert.strictEqual(modified, true);
            assert.ok(items[0].googleDriveFileId);
            assert.match(items[0].googleDriveFileId, /^drive-file-/);
        } finally {
            googleDriveService.driveClientFactory = originalFactory;
            googleDriveService.httpClient = originalHttp;
            process.env.GOOGLE_DRIVE_FOLDER_ID = originalFolderId;
        }
    });
});
