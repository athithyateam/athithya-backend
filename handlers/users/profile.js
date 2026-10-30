const { User, HostDetails, HostAuditLog, Experience, Review, Booking, Notification, Conversation, Message, Friendship, FriendRequest, SavedExperience, HostPinnedExperienceMedia, WishlistSchedule } = require("../../db/mongoose");
const { deleteFromS3 } = require("../../services/storageService");
const { profileService } = require("../../services/users/profileService");

/**
 * Update user profile (guest or host)
 */
exports.updateProfile = async (req, res) => {
    try {
        const result = await profileService.updateProfile(
            req.user.userId,
            req.body
        );

        return res.status(200).json({
            success: true,
            isPendingReview: result.isPendingReview,
            message: result.message,
            user: result.user
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            isUnverifiedHost: error.isUnverifiedHost || undefined,
            message: error.message || "Error updating profile"
        });
    }
};

/**
 * Update user geographic location
 */
exports.updateLocation = async (req, res) => {
    try {
        const { latitude, longitude, address, city, state, country } = req.body;
        const result = await profileService.updateUserLocation(req.user.userId, {
            latitude,
            longitude,
            address,
            city,
            state,
            country
        });

        return res.status(200).json({
            success: true,
            message: "Location updated",
            data: result
        });
    } catch (error) {
        console.error("Error updating location:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to update location"
        });
    }
};

/**
 * Get current user location
 */
exports.getLocation = async (req, res) => {
    try {
        const result = await profileService.getUserLocation(req.user.userId);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Error fetching location:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch location"
        });
    }
};

/**
 * Get user profile with posts and reviews
 */
exports.getProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = req.query.page;
        const limit = req.query.limit;

        const result = await profileService.getProfile(
            userId,
            page,
            limit,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Profile fetch error (getProfile):", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get complete user profile with categorized items
 */
exports.getCompleteProfile = async (req, res) => {
    try {
        const userId = req.params.userId || req.user?.userId;
        const result = await profileService.getCompleteProfile(
            userId,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Profile fetch error (getCompleteProfile):", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch complete profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get top rated hosts
 */
exports.getTopRatedHosts = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const { limit = 100, page = 1, minRating = 0, location } = req.query;

        const result = await profileService.getTopRatedHosts(
            limit,
            page,
            minRating,
            location
        );

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            hosts: result.hosts
        });
    } catch (error) {
        console.error("Error fetching top-rated hosts:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching top-rated hosts"
        });
    }
};

/**
 * Fetch a specific user by ID
 */
exports.getUserById = async (req, res) => {
    try {
        const result = await profileService.getUserById(
            req.params.id,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            user: result
        });
    } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching user"
        });
    }
};

/**
 * Delete account and all associated data
 * NOTE: Left in handler per architecture design decision pending service DI for all affected models.
 */
exports.deleteMyAccount = async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 1. Delete Avatar from S3
        if (user.avatar && user.avatar.public_id) {
            try { await deleteFromS3(user.avatar.public_id); } catch (err) {}
        }

        // 2. Delete Host Documents (Aadhaar) from S3
        const hostDoc = await HostDetails.findOne({ user: userId });
        if (hostDoc?.aadhaarCard) {
            if (Array.isArray(hostDoc.aadhaarCard)) {
                for (const doc of hostDoc.aadhaarCard) {
                    if (doc.public_id) {
                        try { await deleteFromS3(doc.public_id); } catch (err) {}
                    }
                }
            } else if (hostDoc.aadhaarCard.public_id) {
                try { await deleteFromS3(hostDoc.aadhaarCard.public_id); } catch (err) {}
            }
        }

        // 3. Delete all Experiences and their media from S3
        const userExperiences = await Experience.find({ user: userId });
        for (const exp of userExperiences) {
            // Cleanup Photos
            if (exp.photos && exp.photos.length > 0) {
                for (const img of exp.photos) {
                    if (img.public_id) {
                        try { await deleteFromS3(img.public_id); } catch (err) {}
                    }
                }
            }
            // Cleanup Videos
            if (exp.videos && exp.videos.length > 0) {
                for (const vid of exp.videos) {
                    if (vid.public_id) {
                        try { await deleteFromS3(vid.public_id); } catch (err) {}
                    }
                }
            }
        }
        await Experience.deleteMany({ user: userId });

        // 5. Delete all Bookings (where user is host or guest)
        await Booking.deleteMany({ $or: [{ guest: userId }, { host: userId }] });

        // 6. Delete all Reviews (written by user or about user) and recalculate experience ratings
        const userSubmittedReviews = await Review.find({ reviewer: userId, $or: [{ experience: { $ne: null } }, { post: { $ne: null } }] });
        const affectedExpIds = [...new Set(userSubmittedReviews.map(r => (r.experience || r.post)?.toString()).filter(Boolean))];

        await Review.deleteMany({ $or: [{ reviewer: userId }, { host: userId }] });

        for (const expId of affectedExpIds) {
            try {
                const remainingReviews = await Review.find({ $or: [{ experience: expId }, { post: expId }] });
                const count = remainingReviews.length;
                const average = count > 0 
                    ? Math.round((remainingReviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 
                    : 0;
                await Experience.findByIdAndUpdate(expId, {
                    'rating.average': average,
                    'rating.count': count
                });
            } catch (err) {
                console.error("Error recalculating experience rating on account deletion:", err);
            }
        }

        // 7. Delete all Notifications
        await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

        // 8. Delete all Conversations and their Messages
        const userConversations = await Conversation.find({ participants: userId });
        for (const conv of userConversations) {
            await Message.deleteMany({ conversationId: conv._id });
        }
        await Conversation.deleteMany({ participants: userId });

        // 9. Clean up user's social connections, requests, bookmarks, pins, wishlist schedules, and host records
        await Promise.all([
            Friendship.deleteMany({ $or: [{ user: userId }, { friend: userId }] }),
            FriendRequest.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] }),
            SavedExperience.deleteMany({ user: userId }),
            HostPinnedExperienceMedia.deleteMany({ user: userId }),
            WishlistSchedule.deleteMany({ user: userId }),
            HostDetails.deleteOne({ user: userId }),
            HostAuditLog.deleteMany({ hostId: userId })
        ]);

        // 11. Finally, delete the user record
        await User.findByIdAndDelete(userId);

        return res.status(200).json({
            success: true,
            message: "Account and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Account deletion error:", error);
        return res.status(500).json({ success: false, message: "Failed to delete account" });
    }
};
