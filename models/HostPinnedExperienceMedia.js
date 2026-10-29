const mongoose = require("mongoose");

const hostPinnedExperienceMediaSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    mediaKey: {
        type: String,
        required: true
    },
    pinnedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Prevent duplicate pins of the same media key by the same host
hostPinnedExperienceMediaSchema.index({ user: 1, mediaKey: 1 }, { unique: true });
// Optimize retrieval sorted by pin recency
hostPinnedExperienceMediaSchema.index({ user: 1, pinnedAt: -1 });

const HostPinnedExperienceMedia = mongoose.model("hostPinnedExperienceMedia", hostPinnedExperienceMediaSchema);

module.exports = HostPinnedExperienceMedia;
