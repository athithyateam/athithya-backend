const http = require('http');
const url = require('url');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { google } = require('googleapis');

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:5555';

if (!clientId || !clientSecret) {
    console.error('❌ Missing GOOGLE_DRIVE_CLIENT_ID (or GOOGLE_CLIENT_ID) / GOOGLE_DRIVE_CLIENT_SECRET in .env');
    process.exit(1);
}

let port = 5555;
try {
    const parsedRedirect = new URL(redirectUri);
    port = parseInt(parsedRedirect.port, 10) || 5555;
} catch (e) {
    port = 5555;
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive']
});

console.log('\n==================================================');
console.log('🔑 Google Drive OAuth Refresh Token Generator');
console.log('==================================================\n');
console.log('1. Open this link in your browser to authorize Athithya with Google Drive:');
console.log(`\n   ${authUrl}\n`);
console.log(`2. Waiting for OAuth callback on ${redirectUri}...`);

const server = http.createServer(async (req, res) => {
    try {
        const query = url.parse(req.url, true).query;
        if (!query.code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Missing authorization code</h1>');
            return;
        }

        const { tokens } = await oauth2Client.getToken(query.code);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication successful!</h1><p>You can return to the terminal. The refresh token has been logged.</p>');

        console.log('\n✅ Successfully received tokens from Google!');
        if (tokens.refresh_token) {
            console.log('\n==================================================');
            console.log('New GOOGLE_DRIVE_REFRESH_TOKEN:');
            console.log('==================================================');
            console.log(tokens.refresh_token);
            console.log('==================================================\n');
            console.log('Update this in your .env file:');
            console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        } else {
            console.log('⚠️ Google did not return a refresh token.');
            console.log('Access token was returned, but no refresh token. Make sure prompt=consent is used.');
        }

        server.close(() => process.exit(0));
    } catch (err) {
        console.error('❌ Failed to exchange authorization code for tokens:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error: ${err.message}</h1>`);
        server.close(() => process.exit(1));
    }
});

server.listen(port, () => {
    console.log(`Temporary OAuth listener running on port ${port}.\n`);
});
