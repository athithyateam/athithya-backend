const mongoose = require("mongoose");
const { CommunityPost, User } = require("../db/mongoose");
const { uploadToS3, deleteFromS3 } = require("../utils/s3");

const createCommunityPost = async (req, res) => {
    console.log("[DEBUG] createCommunityPost request received", { userId: req.user?.userId, mediaCount: req.body.media?.length });
    try {
        const { title, description, media } = req.body;

        if (!description) {
            return res.status(400).json({ success: false, message: "Description is required" });
        }

        let uploadedMedia = [];
        if (media) {
            const parsedMedia = typeof media === 'string' ? JSON.parse(media) : media;
            uploadedMedia = Array.isArray(parsedMedia) ? parsedMedia : [parsedMedia];
        }

        const newPost = new CommunityPost({
            user: req.user.userId,
            title,
            description,
            media: uploadedMedia
        });

        await newPost.save();
        
        // Populate user info for immediate frontend update
        const populatedPost = await CommunityPost.findById(newPost._id).populate('user', 'firstname lastname avatar role');

        res.status(201).json({ success: true, data: populatedPost });
    } catch (error) {
        console.error("Error creating community post:", error);
        res.status(500).json({ success: false, message: "Failed to create post", error: error.message });
    }
};

const getUserCommunityPosts = async (req, res) => {
    try {
        const userId = req.params.userId;
        const posts = await CommunityPost.find({ user: userId })
            .populate('user', 'firstname lastname avatar role')
            .sort({ createdAt: -1 })
            .limit(20);

        res.status(200).json({ success: true, posts });
    } catch (error) {
        console.error("Error fetching community posts:", error);
        res.status(500).json({ success: false, message: "Failed to fetch posts", error: error.message });
    }
};

const toggleLike = async (req, res) => {
    try {
        const post = await CommunityPost.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }

        const userId = req.user.userId;
        const likedIndex = post.likes.indexOf(userId);

        if (likedIndex === -1) {
            post.likes.push(userId);
        } else {
            post.likes.splice(likedIndex, 1);
        }

        await post.save();
        res.status(200).json({ success: true, likesCount: post.likes.length, isLiked: likedIndex === -1 });
    } catch (error) {
        console.error("Error toggling like:", error);
        res.status(500).json({ success: false, message: "Failed to like post", error: error.message });
    }
};

const getPostLikers = async (req, res) => {
    try {
        const post = await CommunityPost.findById(req.params.id)
            .populate('likes', 'firstname lastname avatar role description');

        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }

        res.status(200).json({ success: true, likers: post.likes });
    } catch (error) {
        console.error("Error fetching likers:", error);
        res.status(500).json({ success: false, message: "Failed to fetch likers", error: error.message });
    }
};

const deleteCommunityPost = async (req, res) => {
    try {
        const post = await CommunityPost.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }

        if (String(post.user) !== String(req.user.userId)) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        // Delete from S3
        if (post.media && post.media.length > 0) {
            for (const item of post.media) {
                try {
                    await deleteFromS3(item.public_id);
                } catch (cErr) {
                    console.error("S3 destroy error:", cErr);
                }
            }
        }

        await CommunityPost.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: "Post deleted" });
    } catch (error) {
        console.error("Error deleting post:", error);
        res.status(500).json({ success: false, message: "Failed to delete post", error: error.message });
    }
};

module.exports = { createCommunityPost, getUserCommunityPosts, deleteCommunityPost, toggleLike, getPostLikers };
