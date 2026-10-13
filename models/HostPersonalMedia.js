const mongoose = require("mongoose");

const hostPersonalMediaSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    url: {
        type: String,
        required: true
    },
    public_id: {
        type: String,
        required: true
    },
    mediaType: {
        type: String,
        enum: ['image', 'video'],
        default: 'image'
    },
    isPinned: {
        type: Boolean,
        default: false
    },
    pinnedAt: {
        type: Date
    },
    googleDriveFileId: {
        type: String
    }
}, { timestamps: true });

hostPersonalMediaSchema.index({ user: 1, isPinned: -1, createdAt: -1 });

const HostPersonalMedia = mongoose.model("hostPersonalMedia", hostPersonalMediaSchema);

module.exports = HostPersonalMedia;
