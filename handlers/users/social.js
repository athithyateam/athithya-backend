const { socialService } = require("../../services/users/socialService");

/**
 * Send a friend request
 */
exports.sendFriendRequest = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;

        await socialService.sendFriendRequest(
            targetUserId,
            currentUserId
        );

        return res.status(200).json({ success: true, message: "Friend request sent" });
    } catch (error) {
        console.error("Error in sendFriendRequest handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error sending request"
        });
    }
};

/**
 * Accept a friend request
 */
exports.acceptFriendRequest = async (req, res) => {
    try {
        const requesterId = req.params.id;
        const currentUserId = req.user.userId;

        await socialService.acceptFriendRequest(
            requesterId,
            currentUserId
        );

        return res.status(200).json({ success: true, message: "Friend request accepted" });
    } catch (error) {
        console.error("Error in acceptFriendRequest handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error accepting request"
        });
    }
};

/**
 * Reject a friend request
 */
exports.rejectFriendRequest = async (req, res) => {
    try {
        const requesterId = req.params.id;
        const currentUserId = req.user.userId;

        await socialService.rejectFriendRequest(
            requesterId,
            currentUserId
        );

        return res.status(200).json({ success: true, message: "Friend request rejected" });
    } catch (error) {
        console.error("Error in rejectFriendRequest handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error rejecting request"
        });
    }
};

/**
 * Remove a friend and clear direct conversation
 */
exports.unfriend = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;

        await socialService.unfriend(
            targetUserId,
            currentUserId
        );

        return res.status(200).json({ success: true, message: "Unfriended and chat cleared" });
    } catch (error) {
        console.error("Error in unfriend handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error unfriending"
        });
    }
};

/**
 * Get paginated friends list for a user
 */
exports.getFriends = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const result = await socialService.getFriends(
            id,
            page,
            limit
        );

        return res.status(200).json({
            success: true,
            count: result.count,
            data: result.data
        });
    } catch (error) {
        console.error("Error in getFriends handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching friends"
        });
    }
};

/**
 * Get guests directory
 */
exports.getGuests = async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        const { search = "", page = 1, limit = 10, role } = req.query;

        const result = await socialService.getGuests(
            currentUserId,
            search,
            page,
            limit,
            role
        );

        return res.status(200).json({
            success: true,
            total: result.total,
            page: result.page,
            hasMore: result.hasMore,
            guests: result.guests,
            data: result.data
        });
    } catch (error) {
        console.error("Error in getGuests handler:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching guests"
        });
    }
};
