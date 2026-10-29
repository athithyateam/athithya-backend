const mongoose = require("mongoose");

const savedPostSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'post',
        required: true
    },
    postType: {
        type: String,
        default: 'experience'
    }
}, { timestamps: true });

// Prevent duplicate saves of the same post by the same user
savedPostSchema.index({ user: 1, post: 1 }, { unique: true });
// Optimize paginated retrieval of a user's saved posts sorted by newest
savedPostSchema.index({ user: 1, createdAt: -1 });
// Optimize counting bookmarks per post
savedPostSchema.index({ post: 1 });

const SavedPost = mongoose.model("savedPost", savedPostSchema);

module.exports = SavedPost;
