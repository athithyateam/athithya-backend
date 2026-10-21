const { postService } = require("../../services/postService");

/**
 * Controller: Delete post / experience (or submit deletion request for hosts)
 */
exports.deletePost = async (req, res) => {
    try {
        const result = await postService.deletePost(
            req.params.id,
            req.user.userId,
            req.user.role,
            req.app
        );

        return res.status(200).json(result);
    } catch (error) {
        console.error("Delete post error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error deleting post"
        });
    }
};
