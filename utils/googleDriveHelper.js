const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');

// Path to optional service account key JSON file
const KEY_FILE_PATHS = [
    path.join(__dirname, '../config/google-drive-key.json'),
    path.join(__dirname, '../google-credentials.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS ? path.resolve(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS) : null
].filter(Boolean);

// In-memory cache for folder IDs (Experiences, Momentos)
const folderCache = {
    root: null,
    experiences: null,
    momentos: null
};

/**
 * Initializes and returns an authenticated Google Drive v3 client.
 * Supports:
 * 1. OAuth2 User Credentials via Refresh Token (Recommended for personal Gmail accounts, avoids quota errors)
 * 2. Service account JSON file (in config/google-drive-key.json, google-credentials.json, or GOOGLE_APPLICATION_CREDENTIALS)
 * 3. .env variables: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 */
function getDriveClient() {
    // 1. Check for OAuth2 Refresh Token credentials first
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:5555');
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        return google.drive({ version: 'v3', auth: oauth2Client });
    }

    // 2. Service Account Key File
    const existingKeyFile = KEY_FILE_PATHS.find(p => fs.existsSync(p));
    if (existingKeyFile) {
        const auth = new google.auth.GoogleAuth({
            keyFile: existingKeyFile,
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        return google.drive({ version: 'v3', auth });
    }

    // 3. Service Account Environment Variables
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
        const auth = new google.auth.JWT(
            process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            privateKey,
            ['https://www.googleapis.com/auth/drive']
        );
        return google.drive({ version: 'v3', auth });
    }

    return null;
}

/**
 * Retrieves or creates the required subfolders (Experiences, Momentos)
 * inside the parent Google Drive folder, and removes legacy Profiles folder.
 * 
 * @param {Object} drive - Google Drive API client
 * @param {String} [parentFolderId] - Google Drive parent folder ID
 */
async function ensureFolderStructure(drive, parentFolderId) {
    if (!parentFolderId) {
        parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    }
    if (!parentFolderId) {
        throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured in .env or arguments");
    }

    if (folderCache.root === parentFolderId && folderCache.experiences && folderCache.momentos) {
        return folderCache;
    }

    folderCache.root = parentFolderId;

    // List all existing subfolders in parent
    const existingRes = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    const existingFiles = existingRes.data.files || [];

    // 1. Remove legacy "Profiles" folder if it exists
    const profilesFolder = existingFiles.find(f => f.name.toLowerCase() === 'profiles');
    if (profilesFolder) {
        try {
            await drive.files.update({
                fileId: profilesFolder.id,
                removeParents: parentFolderId
            });
            console.log(`[GoogleDriveSync] Removed 'Profiles' folder from parent folder.`);
        } catch (e) {
            try {
                await drive.files.delete({ fileId: profilesFolder.id });
            } catch (e2) {}
        }
    }

    // 2. Check for legacy "Moments" folder -> rename to "Momentos"
    const momentsFolder = existingFiles.find(f => f.name.toLowerCase() === 'moments');
    const existingMomentos = existingFiles.find(f => f.name.toLowerCase() === 'momentos');

    if (momentsFolder && !existingMomentos) {
        try {
            await drive.files.update({
                fileId: momentsFolder.id,
                resource: { name: 'Momentos' }
            });
            folderCache.momentos = momentsFolder.id;
            console.log(`[GoogleDriveSync] Renamed 'Moments' to 'Momentos'.`);
        } catch (e) {
            console.warn(`[GoogleDriveSync] Could not rename Moments folder:`, e.message);
        }
    } else if (momentsFolder && existingMomentos) {
        try {
            await drive.files.delete({ fileId: momentsFolder.id });
        } catch (e) {}
    }

    // 3. Ensure Experiences and Momentos exist
    const requiredFolders = ['Experiences', 'Momentos'];

    for (const folderName of requiredFolders) {
        const cacheKey = folderName.toLowerCase();
        if (folderCache[cacheKey]) continue;

        // Search for existing subfolder inside parent
        const found = existingFiles.find(f => f.name.toLowerCase() === folderName.toLowerCase() && f.id !== momentsFolder?.id);
        if (found) {
            folderCache[cacheKey] = found.id;
        } else {
            // Create subfolder
            const folderMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };
            const created = await drive.files.create({
                resource: folderMetadata,
                fields: 'id'
            });
            folderCache[cacheKey] = created.data.id;
        }
    }

    return folderCache;
}

/**
 * Uploads a media asset (image/video) to the specified Google Drive subfolder.
 * Can take a stream, Buffer, or remote URL (e.g. from S3 / Cloudinary).
 * 
 * @param {Object} options
 * @param {String} [options.url] - Remote S3 or web URL to fetch and upload
 * @param {ReadableStream|Buffer} [options.data] - Direct stream or buffer
 * @param {String} options.fileName - Target file name on Google Drive
 * @param {String} [options.mimeType] - File MIME type (default 'image/jpeg')
 * @param {String} options.category - Target subfolder: 'experiences' | 'momentos'
 * @returns {Promise<{ fileId: String, webViewLink: String }|null>}
 */
async function uploadMediaToDrive({ url, data, fileName, mimeType = 'image/jpeg', category = 'experiences' }) {
    try {
        const drive = getDriveClient();
        if (!drive) {
            return null;
        }

        const folders = await ensureFolderStructure(drive);
        let cat = (category || 'experiences').toLowerCase();
        if (cat === 'moments') cat = 'momentos';

        const targetFolderId = folders[cat] || folders.root;

        let mediaBody = data;
        let finalMimeType = mimeType;

        if (url && !data) {
            // Stream directly from remote S3/CDN URL
            const response = await axios({
                method: 'GET',
                url,
                responseType: 'stream',
                timeout: 30000
            });
            mediaBody = response.data;
            finalMimeType = response.headers['content-type'] || mimeType;
        }

        if (!mediaBody) {
            console.warn(`[GoogleDriveSync] No media body or valid URL provided for ${fileName}`);
            return null;
        }

        const fileMetadata = {
            name: fileName,
            parents: [targetFolderId]
        };

        const media = {
            mimeType: finalMimeType,
            body: mediaBody
        };

        const file = await drive.files.create({
            resource: fileMetadata,
            media,
            fields: 'id, webViewLink, webContentLink'
        });

        return {
            fileId: file.data.id,
            webViewLink: file.data.webViewLink,
            webContentLink: file.data.webContentLink
        };
    } catch (error) {
        console.error(`[GoogleDriveSync] Upload failed for ${fileName}:`, error?.response?.data || error.message);
        return null;
    }
}

/**
 * Deletes a file from Google Drive by its file ID.
 * 
 * @param {String} fileId - The Google Drive file ID
 * @returns {Promise<Boolean>}
 */
async function deleteMediaFromDrive(fileId) {
    if (!fileId) return false;
    try {
        const drive = getDriveClient();
        if (!drive) return false;

        await drive.files.delete({ fileId });
        return true;
    } catch (error) {
        console.error(`[GoogleDriveSync] Delete failed for file ${fileId}:`, error?.response?.data || error.message);
        return false;
    }
}

module.exports = {
    getDriveClient,
    ensureFolderStructure,
    uploadMediaToDrive,
    deleteMediaFromDrive
};
