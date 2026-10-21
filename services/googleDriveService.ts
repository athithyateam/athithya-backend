import axios from "axios";
const { getDriveClient } = require("../clients/googleDriveClient");

export interface FolderCache {
    root: string | null;
    experiences: string | null;
    momentos: string | null;
    [key: string]: string | null;
}

export interface GoogleDriveMediaResult {
    fileId: string;
    webViewLink: string;
    webContentLink: string;
}

export interface SyncMediaOptions {
    url?: string;
    data?: any;
    fileName: string;
    mimeType?: string;
    category?: string;
}

export class GoogleDriveService {
    private static instance: GoogleDriveService | null = null;
    private static instanceKey = Symbol("GoogleDriveServiceInstanceKey");

    private driveClientFactory: () => any;
    private httpClient: typeof axios;
    private folderCache: FolderCache;

    constructor(
        instanceKey: symbol,
        driveClientFactory: () => any = getDriveClient,
        httpClient: typeof axios = axios
    ) {
        if (instanceKey !== GoogleDriveService.instanceKey) {
            throw new Error("Please use GoogleDriveService.getInstance() to retrieve or create an instance");
        }
        this.driveClientFactory = driveClientFactory;
        this.httpClient = httpClient;
        this.folderCache = {
            root: null,
            experiences: null,
            momentos: null
        };
    }

    public static getInstance(
        driveClientFactory?: () => any,
        httpClient?: typeof axios
    ): GoogleDriveService {
        if (!this.instance) {
            this.instance = new GoogleDriveService(this.instanceKey, driveClientFactory, httpClient);
        }
        return this.instance;
    }

    private getDrive(): any {
        return this.driveClientFactory();
    }

    /**
     * Retrieves or creates the required subfolders (Experiences, Momentos)
     * inside the parent Google Drive folder, and cleans up legacy folders.
     */
    public async ensureFolderStructure(parentFolderId?: string): Promise<FolderCache> {
        let parentId = parentFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
        if (!parentId) {
            throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured in .env or arguments");
        }

        if (this.folderCache.root === parentId && this.folderCache.experiences && this.folderCache.momentos) {
            return this.folderCache;
        }

        this.folderCache.root = parentId;
        const drive = this.getDrive();
        if (!drive) {
            throw new Error("Google Drive client not initialized");
        }

        const existingRes = await drive.files.list({
            q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const existingFiles: any[] = existingRes.data.files || [];

        // Remove legacy "Profiles" folder if it exists
        const profilesFolder = existingFiles.find(f => f.name.toLowerCase() === 'profiles');
        if (profilesFolder) {
            try {
                await drive.files.update({
                    fileId: profilesFolder.id,
                    removeParents: parentId
                });
            } catch (e) {
                try {
                    await drive.files.delete({ fileId: profilesFolder.id });
                } catch (e2) {}
            }
        }

        // Rename legacy "Moments" folder to "Momentos"
        const momentsFolder = existingFiles.find(f => f.name.toLowerCase() === 'moments');
        const existingMomentos = existingFiles.find(f => f.name.toLowerCase() === 'momentos');

        if (momentsFolder && !existingMomentos) {
            try {
                await drive.files.update({
                    fileId: momentsFolder.id,
                    resource: { name: 'Momentos' }
                });
                this.folderCache.momentos = momentsFolder.id;
            } catch (e: any) {
                console.warn(`[GoogleDriveSync] Could not rename Moments folder:`, e.message);
            }
        } else if (momentsFolder && existingMomentos) {
            try {
                await drive.files.delete({ fileId: momentsFolder.id });
            } catch (e) {}
        }

        // Ensure Experiences and Momentos subfolders exist
        const requiredFolders = ['Experiences', 'Momentos'];
        for (const folderName of requiredFolders) {
            const cacheKey = folderName.toLowerCase();
            if (this.folderCache[cacheKey]) continue;

            const found = existingFiles.find(f => f.name.toLowerCase() === folderName.toLowerCase() && f.id !== momentsFolder?.id);
            if (found) {
                this.folderCache[cacheKey] = found.id;
            } else {
                const folderMetadata = {
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentId]
                };
                const created = await drive.files.create({
                    resource: folderMetadata,
                    fields: 'id'
                });
                this.folderCache[cacheKey] = created.data.id;
            }
        }

        return this.folderCache;
    }

    /**
     * Uploads a media asset (image/video) to Google Drive in the specified category subfolder.
     * Clean positional parameters: (url, fileName, category, mimeType, data)
     * Supports single options object for backward compatibility.
     */
    public async syncMediaFromUrl(
        urlOrOptions: string | SyncMediaOptions,
        fileName?: string,
        category: string = "experiences",
        mimeType: string = "image/jpeg",
        data?: any
    ): Promise<GoogleDriveMediaResult | null> {
        try {
            const drive = this.getDrive();
            if (!drive) return null;

            let sourceUrl: string | undefined;
            let destFileName: string;
            let targetCategory: string = category;
            let targetMimeType: string = mimeType;
            let mediaData: any = data;

            if (typeof urlOrOptions === "object" && urlOrOptions !== null) {
                sourceUrl = urlOrOptions.url;
                destFileName = urlOrOptions.fileName;
                if (urlOrOptions.category) targetCategory = urlOrOptions.category;
                if (urlOrOptions.mimeType) targetMimeType = urlOrOptions.mimeType;
                if (urlOrOptions.data) mediaData = urlOrOptions.data;
            } else {
                sourceUrl = urlOrOptions as string;
                destFileName = fileName || "media";
            }

            const folders = await this.ensureFolderStructure();
            let cat = (targetCategory || "experiences").toLowerCase();
            if (cat === "moments") cat = "momentos";

            const targetFolderId = folders[cat] || folders.root;

            let mediaBody = mediaData;
            let finalMimeType = targetMimeType;

            if (sourceUrl && !mediaData) {
                const response = await this.httpClient({
                    method: "GET",
                    url: sourceUrl,
                    responseType: "stream",
                    timeout: 30000
                });
                mediaBody = response.data;
                finalMimeType = (response.headers["content-type"] as string) || targetMimeType;
            }

            if (!mediaBody) {
                console.warn(`[GoogleDriveSync] No media body or valid URL provided for ${destFileName}`);
                return null;
            }

            const fileMetadata = {
                name: destFileName,
                parents: [targetFolderId]
            };

            const media = {
                mimeType: finalMimeType,
                body: mediaBody
            };

            const file = await drive.files.create({
                resource: fileMetadata,
                media,
                fields: "id, webViewLink, webContentLink"
            });

            return {
                fileId: file.data.id,
                webViewLink: file.data.webViewLink,
                webContentLink: file.data.webContentLink
            };
        } catch (error: any) {
            console.error(`[GoogleDriveSync] Upload failed:`, error?.response?.data || error.message);
            return null;
        }
    }

    /**
     * Batch sync an array of media objects (photos/videos) to Google Drive.
     * Iterates over items, checks if they need sync, streams to Google Drive, and sets googleDriveFileId.
     * @returns {Promise<boolean>} True if any items were synced/updated
     */
    public async syncMediaItems(
        items: Array<{ url?: string; googleDriveFileId?: string; [key: string]: any }>,
        namePrefix: string,
        category: string = "experiences",
        defaultMimeType: string = "image/jpeg"
    ): Promise<boolean> {
        if (!items || !Array.isArray(items)) return false;
        let modified = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item && item.url && !item.googleDriveFileId) {
                const ext = item.url.split('.').pop()?.split('?')[0] || (defaultMimeType.includes('video') ? 'mp4' : 'jpg');
                const fileName = `${namePrefix}_${i + 1}.${ext}`;
                const res = await this.syncMediaFromUrl(
                    item.url,
                    fileName,
                    category,
                    defaultMimeType
                );
                if (res?.fileId) {
                    item.googleDriveFileId = res.fileId;
                    modified = true;
                }
            }
        }
        return modified;
    }

    /**
     * Deletes a file from Google Drive by its file ID
     * Positional parameter: (fileId)
     */
    public async deleteMedia(fileId: string): Promise<boolean> {
        if (!fileId) return false;
        try {
            const drive = this.getDrive();
            if (!drive) return false;

            await drive.files.delete({ fileId });
            return true;
        } catch (error: any) {
            console.error(`[GoogleDriveSync] Delete failed for file ${fileId}:`, error?.response?.data || error.message);
            return false;
        }
    }
}

export const googleDriveService = GoogleDriveService.getInstance();
export default GoogleDriveService;

// Convenience function exports for backward compatibility
export const ensureFolderStructure = (parentFolderId?: string) => googleDriveService.ensureFolderStructure(parentFolderId);
export const syncMediaFromUrl = (
    urlOrOptions: string | SyncMediaOptions,
    fileName?: string,
    category?: string,
    mimeType?: string,
    data?: any
) => googleDriveService.syncMediaFromUrl(urlOrOptions, fileName, category, mimeType, data);
export const deleteMedia = (fileId: string) => googleDriveService.deleteMedia(fileId);
export const syncMediaItems = (
    items: Array<{ url?: string; googleDriveFileId?: string; [key: string]: any }>,
    namePrefix: string,
    category?: string,
    defaultMimeType?: string
) => googleDriveService.syncMediaItems(items, namePrefix, category, defaultMimeType);
export const uploadMediaToDrive = syncMediaFromUrl;
export const deleteMediaFromDrive = deleteMedia;

// CommonJS compatibility
module.exports = googleDriveService;
module.exports.GoogleDriveService = GoogleDriveService;
module.exports.googleDriveService = googleDriveService;
module.exports.ensureFolderStructure = ensureFolderStructure;
module.exports.syncMediaFromUrl = syncMediaFromUrl;
module.exports.syncMediaItems = syncMediaItems;
module.exports.deleteMedia = deleteMedia;
module.exports.uploadMediaToDrive = uploadMediaToDrive;
module.exports.deleteMediaFromDrive = deleteMediaFromDrive;
module.exports.default = GoogleDriveService;
