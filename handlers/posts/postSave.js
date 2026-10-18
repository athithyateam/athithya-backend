const { Post, User } = require("../../db/mongoose");

const savePost = async (req, res) => {
    try {
        const userId = req.user.userId;
        const postId = req.params.id;

        if (req.user.role === 'host') {
            return res.status(400).json({ success: false, message: "Hosts cannot engage with another host's experience. Only guests can." });
        }

        const post = await Post.findById(postId);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        const user = await User.findById(userId);
        const alreadySaved = user?.savedPosts?.some(p => p.toString() === postId);
        if (!alreadySaved) {
            await User.findByIdAndUpdate(userId, { $addToSet: { savedPosts: postId } });
            await Post.findByIdAndUpdate(postId, { $inc: { savesCount: 1 } });
        }

        return res.status(200).json({ success: true, message: "Post saved successfully" });
    } catch (err) {
        console.error("Save post error:", err);
        return res.status(500).json({ success: false, message: "Error saving post" });
    }
};

const unsavePost = async (req, res) => {
    try {
        const userId = req.user.userId;
        const postId = req.params.id;

        const user = await User.findById(userId);
        const alreadySaved = user?.savedPosts?.some(p => p.toString() === postId);
        if (alreadySaved) {
            await User.findByIdAndUpdate(userId, { $pull: { savedPosts: postId } });
            await Post.findByIdAndUpdate(postId, { $inc: { savesCount: -1 } });
        }

        return res.status(200).json({ success: true, message: "Post removed from saved list" });
    } catch (err) {
        console.error("Unsave post error:", err);
        return res.status(500).json({ success: false, message: "Error unsaving post" });
    }
};

module.exports = {
    savePost,
    unsavePost
};
