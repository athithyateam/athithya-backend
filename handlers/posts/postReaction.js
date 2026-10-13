const postService = require("../../services/postService");

exports.reactToPost = async (req, res) => {
    try {
        const { emoji } = req.body;
        const userId = req.user.userId;
        const postId = req.params.id || req.params.postId;

        const result = await postService.reactToPost(postId, userId, emoji);

        return res.status(200).json({
            success: true,
            message: `Reaction ${result.action}`,
            action: result.action,
            reactions: result.reactions,
            reactionStats: result.reactionStats,
            totalReactions: result.totalReactions,
            userReaction: result.userReaction
        });
    } catch (error) {
        console.error("React to post error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error reacting to post"
        });
    }
};

exports.getReactionStats = async (req, res) => {
    try {
        const postId = req.params.id;
        const currentUserId = req.user && req.user.userId ? req.user.userId : null;
        const result = await postService.getReactionStats(postId, currentUserId);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching reactions"
        });
    }
};

exports.getPostReviews = async (req, res) => {
    try {
        const reviews = await postService.getPostReviews(req.params.postId);
        return res.status(200).json({
            success: true,
            count: reviews.length,
            reviews
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching reviews"
        });
    }
};
