const { postService } = require("../../services/postService");

/**
 * Controller: Save / Bookmark a post
 */
const savePost = async (req, res) => {
    try {
        const result = await postService.savePost(
            req.params.id,
            req.user.userId,
            req.user.role
        );

        return res.status(200).json(result);
    } catch (err) {
        console.error("Save post error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Error saving post"
        });
    }
};

/**
 * Controller: Unsave / Remove bookmark from a post
 */
const unsavePost = async (req, res) => {
    try {
        const result = await postService.unsavePost(
            req.params.id,
            req.user.userId
        );

        return res.status(200).json(result);
    } catch (err) {
        console.error("Unsave post error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Error unsaving post"
        });
    }
};

module.exports = {
    savePost,
    unsavePost
};
