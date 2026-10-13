const { Post, User, Review } = require("../db/mongoose");

/**
 * Service: React to a post (add, remove, or change emoji)
 */
const reactToPost = async (postId, userId, emoji) => {
    if (!emoji) {
        const error = new Error("Emoji is required");
        error.statusCode = 400;
        throw error;
    }

    const post = await Post.findById(postId);
    if (!post) {
        const error = new Error("Post not found");
        error.statusCode = 404;
        throw error;
    }

    const user = await User.findById(userId);
    const userName = user ? `${user.firstname} ${user.lastname}` : "Someone";

    const existingIndex = post.reactions.findIndex((r) => r.user.toString() === userId.toString());
    let action = "added";

    if (existingIndex > -1) {
        if (post.reactions[existingIndex].emoji === emoji) {
            post.reactions.splice(existingIndex, 1);
            action = "removed";
        } else {
            post.reactions[existingIndex].emoji = emoji;
            post.reactions[existingIndex].timestamp = Date.now();
            action = "updated";
        }
    } else {
        post.reactions.push({ user: userId, name: userName, emoji });
    }

    await post.save();

    const reactionStats = {};
    post.reactions.forEach((r) => {
        reactionStats[r.emoji] = (reactionStats[r.emoji] || 0) + 1;
    });

    return {
        action,
        reactions: post.reactions,
        reactionStats,
        totalReactions: post.reactions.length,
        userReaction: action === "removed" ? null : emoji
    };
};

/**
 * Service: Get aggregated reaction statistics for a post
 */
const getReactionStats = async (postId, currentUserId = null) => {
    const post = await Post.findById(postId).select("reactions");
    if (!post) {
        const error = new Error("Post not found");
        error.statusCode = 404;
        throw error;
    }

    const reactionStats = {};
    const reactions = post.reactions || [];
    reactions.forEach((r) => {
        if (!reactionStats[r.emoji]) reactionStats[r.emoji] = { count: 0, users: [] };
        reactionStats[r.emoji].count++;
        reactionStats[r.emoji].users.push({ userId: r.user, name: r.name, timestamp: r.timestamp });
    });

    let userReaction = null;
    if (currentUserId) {
        const ur = reactions.find((r) => r.user.toString() === currentUserId.toString());
        if (ur) userReaction = ur.emoji;
    }

    return {
        totalReactions: reactions.length,
        reactionStats,
        userReaction,
        allReactions: reactions
    };
};

/**
 * Service: Get reviews for a post
 */
const getPostReviews = async (postId) => {
    return await Review.find({ post: postId })
        .populate("reviewer", "firstname lastname avatar")
        .sort({ createdAt: -1 });
};

module.exports = {
    reactToPost,
    getReactionStats,
    getPostReviews
};
