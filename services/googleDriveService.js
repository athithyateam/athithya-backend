const axios = require('axios');
const { getDriveClient } = require('../clients/googleDriveClient');

// In-memory cache for folder IDs (Experiences, Momentos)
const folderCache = {
    root: null,
    experiences: null,
    momentos: null
};

/**
 * Retrieves or creates the required subfolders (Experiences, Momentos)
 * inside the parent Google Drive folder, and cleans up legacy folders.
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

    const existingRes = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    const existingFiles = existingRes.data.files || [];

    // Remove legacy "Profiles" folder if it exists
    const profilesFolder = existingFiles.find(f => f.name.toLowerCase() === 'profiles');
    if (profilesFolder) {
        try {
            await drive.files.update({
                fileId: profilesFolder.id,
                removeParents: parentFolderId
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
            folderCache.momentos = momentsFolder.id;
        } catch (e) {
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
        if (folderCache[cacheKey]) continue;

        const found = existingFiles.find(f => f.name.toLowerCase() === folderName.toLowerCase() && f.id !== momentsFolder?.id);
        if (found) {
            folderCache[cacheKey] = found.id;
        } else {
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
 * Uploads a media asset (image/video) to Google Drive in the specified category subfolder.
 * Can stream from a remote S3/CDN URL or from a Buffer / Stream directly.
 * 
 * @param {Object} options
 * @param {string} [options.url] - Remote S3 URL to stream from
 * @param {Buffer|ReadableStream} [options.data] - Direct data buffer or stream
 * @param {string} options.fileName - Destination filename
 * @param {string} [options.mimeType='image/jpeg'] - Media MIME type
 * @param {string} [options.category='experiences'] - Subfolder category ('experiences' | 'momentos')
 * @returns {Promise<{ fileId: string, webViewLink: string, webContentLink: string }|null>}
 */
async function syncMediaFromUrl({ url, data, fileName, mimeType = 'image/jpeg', category = 'experiences' }) {
    try {
        const drive = getDriveClient();
        if (!drive) return null;

        const folders = await ensureFolderStructure(drive);
        let cat = (category || 'experiences').toLowerCase();
        if (cat === 'moments') cat = 'momentos';

        const targetFolderId = folders[cat] || folders.root;

        let mediaBody = data;
        let finalMimeType = mimeType;

        if (url && !data) {
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
 * Deletes a file from Google Drive by its file ID
 * @param {string} fileId
 * @returns {Promise<boolean>}
 */
async function deleteMedia(fileId) {
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
    ensureFolderStructure,
    syncMediaFromUrl,
    deleteMedia,

    // Aliases matching legacy helper function names for drop-in compatibility
    uploadMediaToDrive: syncMediaFromUrl,
    deleteMediaFromDrive: deleteMedia
};
