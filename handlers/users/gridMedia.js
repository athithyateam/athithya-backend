const mongoose = require("mongoose");
const { User, Post, HostPersonalMedia, HostPinnedExperienceMedia } = require("../../db/mongoose");
const { deleteFile } = require("../../services/storageService");
const { notificationService } = require("../../services/notificationService");

exports.getHostGridMedia = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid user ID format" });
        }

        const user = await User.findById(userId).select("role");
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const pinnedDocs = await HostPinnedExperienceMedia.find({ user: userId }).select("mediaKey");
        const pinnedExperienceKeys = pinnedDocs.map(d => d.mediaKey);

        // 1. Fetch experience posts media (from active experience/service/trek posts)
        const posts = await Post.find({ user: userId, status: "active" }).sort({ createdAt: -1 });

        const rawExperienceMedia = [];
        for (const post of posts) {
            if (post.photos && Array.isArray(post.photos)) {
                for (const photo of post.photos) {
                    if (photo && photo.url) {
                        const key = photo.public_id || photo.url;
                        rawExperienceMedia.push({
                            _id: photo._id ? photo._id.toString() : key,
                            key: key,
                            url: photo.url,
                            public_id: photo.public_id || "",
                            mediaType: "image",
                            title: post.title,
                            postId: post._id,
                            isPinned: pinnedExperienceKeys.includes(key),
                            createdAt: post.createdAt
                        });
                    }
                }
            }
            if (post.videos && Array.isArray(post.videos)) {
                for (const video of post.videos) {
                    if (video && video.url) {
                        const key = video.public_id || video.url;
                        rawExperienceMedia.push({
                            _id: video._id ? video._id.toString() : key,
                            key: key,
                            url: video.url,
                            public_id: video.public_id || "",
                            mediaType: "video",
                            title: post.title,
                            postId: post._id,
                            isPinned: pinnedExperienceKeys.includes(key),
                            createdAt: post.createdAt
                        });
                    }
                }
            }
        }

        // Sort experience media: pinned first, then newest created
        rawExperienceMedia.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            if (tB !== tA) return tB - tA;
            return (a.key || "").localeCompare(b.key || "");
        });

        // Strict limit to latest 20 items to optimize DB payload
        const experienceMedia = rawExperienceMedia.slice(0, 20);

        // 2. Fetch personal grid media (limit to 20 latest)
        const personalMedia = await HostPersonalMedia.find({ user: userId })
            .sort({ isPinned: -1, createdAt: -1 })
            .limit(20);

        return res.status(200).json({
            success: true,
            data: {
                experienceMedia,
                personalMedia,
                activeGridTab: "experience"
            }
        });
    } catch (error) {
        console.error("Error fetching host grid media:", error);
        return res.status(500).json({ success: false, message: "Error fetching host grid media" });
    }
};

exports.updateGridTabPreference = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { activeGridTab } = req.body;

        if (!["experience", "personal"].includes(activeGridTab)) {
            return res.status(400).json({ success: false, message: "Invalid grid tab preference" });
        }

        // Broadcast real-time grid tab preference update via NotificationService
        notificationService.emitToAll("host_grid_tab_updated", {
            hostId: userId,
            activeGridTab
        });

        return res.status(200).json({
            success: true,
            message: "Grid tab preference updated",
            data: { activeGridTab }
        });
    } catch (error) {
        console.error("Error updating grid tab preference:", error);
        return res.status(500).json({ success: false, message: "Server error updating grid tab preference" });
    }
};

exports.addPersonalMedia = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { items } = req.body; // Array of { url, public_id, mediaType }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "Please provide at least one media item to upload" });
        }

        const mediaToInsert = items.map((item) => ({
            user: userId,
            url: item.url,
            public_id: item.public_id || "",
            mediaType: item.mediaType === "video" ? "video" : "image"
        }));

        const inserted = await HostPersonalMedia.insertMany(mediaToInsert);

        // Asynchronously sync new personal media / moments to Google Drive
        setImmediate(async () => {
            try {
                const { googleDriveService } = require("../../services/googleDriveService");
                for (const doc of inserted) {
                    const defaultMime = doc.mediaType === "video" ? "video/mp4" : "image/jpeg";
                    const updated = await googleDriveService.syncMediaItems(
                        [doc],
                        `MOMENTO_${doc.user}_${doc._id}`,
                        "momentos",
                        defaultMime
                    );
                    if (updated && doc.googleDriveFileId) {
                        await HostPersonalMedia.findByIdAndUpdate(doc._id, { googleDriveFileId: doc.googleDriveFileId });
                    }
                }
            } catch (driveErr) {
                console.error("[GoogleDriveSync] Momentos upload background sync failed:", driveErr.message);
            }
        });

        return res.status(201).json({
            success: true,
            message: "Personal media added successfully",
            data: inserted
        });
    } catch (error) {
        console.error("Error adding personal media:", error);
        return res.status(500).json({ success: false, message: "Error adding personal media" });
    }
};

exports.deletePersonalMedia = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const media = await HostPersonalMedia.findOne({ _id: id, user: userId });
        if (!media) {
            return res.status(404).json({ success: false, message: "Personal media not found or unauthorized" });
        }

        if (media.public_id) {
            await deleteFile(media.public_id);
        }

        if (media.googleDriveFileId) {
            const { deleteMedia } = require("../../services/googleDriveService");
            await deleteMedia(media.googleDriveFileId);
        }

        await HostPersonalMedia.deleteOne({ _id: id });

        return res.status(200).json({
            success: true,
            message: "Personal media deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting personal media:", error);
        return res.status(500).json({ success: false, message: "Error deleting personal media" });
    }
};

exports.togglePinPersonalMedia = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const media = await HostPersonalMedia.findOne({ _id: id, user: userId });
        if (!media) {
            return res.status(404).json({ success: false, message: "Personal media not found or unauthorized" });
        }

        media.isPinned = !media.isPinned;
        media.pinnedAt = media.isPinned ? new Date() : undefined;
        await media.save();

        return res.status(200).json({
            success: true,
            isPinned: media.isPinned,
            message: media.isPinned ? "Media pinned to top" : "Media unpinned"
        });
    } catch (error) {
        console.error("Error toggling pin on personal media:", error);
        return res.status(500).json({ success: false, message: "Error updating pin status" });
    }
};

exports.togglePinExperienceMedia = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { mediaKey } = req.body;

        if (!mediaKey) {
            return res.status(400).json({ success: false, message: "mediaKey is required" });
        }

        const existingPin = await HostPinnedExperienceMedia.findOne({ user: userId, mediaKey });
        let isPinned = false;

        if (existingPin) {
            await HostPinnedExperienceMedia.deleteOne({ _id: existingPin._id });
            isPinned = false;
        } else {
            await HostPinnedExperienceMedia.create({ user: userId, mediaKey, pinnedAt: new Date() });
            isPinned = true;
        }

        const allPinnedDocs = await HostPinnedExperienceMedia.find({ user: userId }).select("mediaKey");
        const pinnedKeys = allPinnedDocs.map(d => d.mediaKey);

        return res.status(200).json({
            success: true,
            isPinned,
            pinnedExperienceMedia: pinnedKeys,
            message: isPinned ? "Experience media pinned" : "Experience media unpinned"
        });
    } catch (error) {
        console.error("Error toggling pin on experience media:", error);
        return res.status(500).json({ success: false, message: "Error updating pin status" });
    }
};
