const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Paths to optional service account key JSON files
const KEY_FILE_PATHS = [
    path.join(__dirname, '../config/google-drive-key.json'),
    path.join(__dirname, '../google-credentials.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS ? path.resolve(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS) : null
].filter(Boolean);

/**
 * Initializes and returns an authenticated Google Drive v3 client.
 * Supports:
 * 1. OAuth2 User Credentials via Refresh Token
 * 2. Service account JSON file
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

module.exports = {
    getDriveClient
};
