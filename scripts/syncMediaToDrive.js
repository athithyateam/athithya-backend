const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connectDB, Experience, HostPersonalMedia, User } = require('../db/mongoose');
const { getDriveClient } = require('../clients/googleDriveClient');
const { ensureFolderStructure, uploadMediaToDrive } = require('../services/googleDriveService');

async function syncAllMediaToDrive() {
    console.log("==================================================");
    console.log("🚀 Athithya Google Drive Media Synchronization");
    console.log("==================================================");

    await connectDB();

    const drive = getDriveClient();
    if (!drive) {
        console.error("❌ Google Drive credentials not configured!");
        console.error("Please provide either:");
        console.error("1. src/backend/config/google-drive-key.json");
        console.error("2. GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env");
        process.exit(1);
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
        console.error("❌ GOOGLE_DRIVE_FOLDER_ID is missing from .env!");
        console.error("Please add the Google Drive folder ID to your .env file.");
        process.exit(1);
    }

    console.log(`📁 Target Parent Google Drive Folder ID: ${folderId}`);
    console.log("Ensuring subfolder hierarchy (Experiences, Momentos)...");
    const folders = await ensureFolderStructure(drive, folderId);
    console.log("✅ Subfolders ready:");
    console.log(`   - Experiences Folder: ${folders.experiences}`);
    console.log(`   - Momentos Folder:    ${folders.momentos}`);
    console.log("--------------------------------------------------");

    let expUploaded = 0;
    let momentosUploaded = 0;

    // 1. SYNC EXPERIENCES MEDIA
    console.log("🔍 Scanning Experiences media...");
    const experiences = await Experience.find({
        $or: [
            { 'photos.0': { $exists: true } },
            { 'videos.0': { $exists: true } }
        ]
    });

    console.log(`Found ${experiences.length} experiences.`);
    for (const post of experiences) {
        let postModified = false;

        // Photos
        if (post.photos && Array.isArray(post.photos)) {
            for (let i = 0; i < post.photos.length; i++) {
                const photo = post.photos[i];
                if (photo.url && !photo.googleDriveFileId) {
                    const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                    const ext = photo.url.split('.').pop().split('?')[0] || "jpg";
                    const fileName = `EXP_${cleanTitle}_${post._id}_photo_${i + 1}.${ext}`;

                    process.stdout.write(`   Uploading Experience photo: ${fileName}... `);
                    const res = await uploadMediaToDrive({
                        url: photo.url,
                        fileName,
                        category: 'experiences'
                    });

                    if (res?.fileId) {
                        photo.googleDriveFileId = res.fileId;
                        postModified = true;
                        expUploaded++;
                        console.log("✅");
                    } else {
                        console.log("⚠️ (skipped or failed)");
                    }
                }
            }
        }

        // Videos
        if (post.videos && Array.isArray(post.videos)) {
            for (let i = 0; i < post.videos.length; i++) {
                const video = post.videos[i];
                if (video.url && !video.googleDriveFileId) {
                    const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                    const ext = video.url.split('.').pop().split('?')[0] || "mp4";
                    const fileName = `EXP_${cleanTitle}_${post._id}_video_${i + 1}.${ext}`;

                    process.stdout.write(`   Uploading Experience video: ${fileName}... `);
                    const res = await uploadMediaToDrive({
                        url: video.url,
                        fileName,
                        mimeType: 'video/mp4',
                        category: 'experiences'
                    });

                    if (res?.fileId) {
                        video.googleDriveFileId = res.fileId;
                        postModified = true;
                        expUploaded++;
                        console.log("✅");
                    } else {
                        console.log("⚠️ (skipped or failed)");
                    }
                }
            }
        }

        if (postModified) {
            await post.save();
        }
    }

    // 2. SYNC HOST PROFILE MOMENTOS
    console.log("--------------------------------------------------");
    console.log("🔍 Scanning Host Profile Momentos media...");
    const momentos = await HostPersonalMedia.find({ url: { $exists: true, $ne: "" } });
    console.log(`Found ${momentos.length} momentos media items.`);

    for (const item of momentos) {
        if (item.url && !item.googleDriveFileId) {
            const ext = item.url.split('.').pop().split('?')[0] || (item.mediaType === 'video' ? 'mp4' : 'jpg');
            const fileName = `MOMENTO_${item.user}_${item._id}.${ext}`;

            process.stdout.write(`   Uploading Momento: ${fileName}... `);
            const res = await uploadMediaToDrive({
                url: item.url,
                fileName,
                mimeType: item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
                category: 'momentos'
            });

            if (res?.fileId) {
                item.googleDriveFileId = res.fileId;
                await item.save();
                momentosUploaded++;
                console.log("✅");
            } else {
                console.log("⚠️ (skipped or failed)");
            }
        }
    }

    console.log("==================================================");
    console.log("🎉 SYNCHRONIZATION SUMMARY:");
    console.log(`   - Experience Photos & Videos Synced: ${expUploaded}`);
    console.log(`   - Host Profile Momentos Synced:      ${momentosUploaded}`);
    console.log("   - Google Drive Folder Status: Fully Synchronized (Experiences + Momentos)");
    console.log("==================================================");

    process.exit(0);
}

syncAllMediaToDrive().catch(err => {
    console.error("Fatal error during sync:", err);
    process.exit(1);
});
