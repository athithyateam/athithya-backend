const mongoose = require("mongoose");

const friendshipSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    friend: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    }
}, { timestamps: true });

// Ensure directional uniqueness: a user can only have one friendship record per friend
friendshipSchema.index({ user: 1, friend: 1 }, { unique: true });
// Optimize paginated retrieval of a user's friends sorted by newest
friendshipSchema.index({ user: 1, createdAt: -1 });

const Friendship = mongoose.model("friendship", friendshipSchema);

module.exports = Friendship;
