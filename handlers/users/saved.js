const userService = require("../../services/userService");

exports.getSavedPosts = async (req, res) => {
    try {
        const savedPosts = await userService.getSavedPosts(req.user.userId);
        const validSavedPosts = (savedPosts || []).filter((post) => post !== null);
        return res.status(200).json({ success: true, posts: validSavedPosts });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching saved items"
        });
    }
};
