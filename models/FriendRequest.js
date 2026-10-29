const mongoose = require("mongoose");

const friendRequestSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'rejected'],
        default: 'pending',
        index: true
    }
}, { timestamps: true });

// Prevent duplicate active friend requests between the same pair
friendRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });
// Optimize listing received friend requests for a user
friendRequestSchema.index({ recipient: 1, status: 1, createdAt: -1 });
// Optimize checking sent friend requests
friendRequestSchema.index({ sender: 1, status: 1 });

const FriendRequest = mongoose.model("friendRequest", friendRequestSchema);

module.exports = FriendRequest;
