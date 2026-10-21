const { postService } = require("../../services/postService");

/**
 * Controller: Update experience details
 */
exports.updatePost = async (req, res) => {
    try {
        const result = await postService.updatePost(
            req.params.id,
            req.user.userId,
            req.user.role,
            req.body,
            req.files,
            req.app
        );

        return res.status(200).json({
            success: true,
            message: result.message,
            post: result.post
        });
    } catch (error) {
        console.error("Update post error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating post"
        });
    }
};

/**
 * Controller: Update experience status (approve/reject/archive)
 */
exports.updatePostStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        const post = await postService.updatePostStatus(
            req.params.id,
            status,
            remarks
        );

        return res.status(200).json({
            success: true,
            message: "Post status updated successfully",
            post
        });
    } catch (error) {
        console.error("Update post status error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating post status"
        });
    }
};

/**
 * Controller: Request to hide or unhide an experience
 */
exports.requestHideExperience = async (req, res) => {
    try {
        const { reason, action } = req.body;
        const result = await postService.toggleHideExperience(
            req.params.id,
            req.user.userId,
            req.user.role,
            action,
            reason,
            req.app
        );

        return res.status(200).json({
            success: true,
            message: result.message,
            hideRequested: result.hideRequested,
            unhideRequested: result.unhideRequested
        });
    } catch (error) {
        console.error("Error processing hide/unhide:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error processing hide/unhide request"
        });
    }
};

exports.requestHidePost = exports.requestHideExperience;
