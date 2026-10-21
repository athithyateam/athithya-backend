/**
 * Google Drive Compatibility Wrapper
 * Core google drive service is located at services/googleDriveService.js
 * Client is located at clients/googleDriveClient.js
 */
const { getDriveClient } = require('../clients/googleDriveClient');
const { ensureFolderStructure, uploadMediaToDrive, deleteMediaFromDrive, syncMediaFromUrl, deleteMedia } = require('../services/googleDriveService');

module.exports = {
    getDriveClient,
    ensureFolderStructure,
    uploadMediaToDrive,
    deleteMediaFromDrive,
    syncMediaFromUrl,
    deleteMedia
};
