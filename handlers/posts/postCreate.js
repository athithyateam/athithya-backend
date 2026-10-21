const { postService } = require("../../services/postService");

/**
 * Controller: Create a new post / experience
 */
exports.createPost = async (req, res) => {
    try {
        const post = await postService.createPost(
            req.user.userId,
            req.user.role,
            req.body,
            req.files,
            req.app
        );

        return res.status(201).json({
            success: true,
            message: "Post created successfully",
            post
        });
    } catch (error) {
        console.error("Create post error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error creating post"
        });
    }
};
