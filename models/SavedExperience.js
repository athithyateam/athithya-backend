const mongoose = require("mongoose");

const savedExperienceSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    experience: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'experience',
        required: true
    }
}, { timestamps: true });

// Prevent duplicate saves of the same experience by the same user
savedExperienceSchema.index({ user: 1, experience: 1 }, { unique: true });
// Optimize paginated retrieval of a user's saved experiences sorted by newest
savedExperienceSchema.index({ user: 1, createdAt: -1 });
// Optimize counting bookmarks per experience
savedExperienceSchema.index({ experience: 1 });

const SavedExperience = mongoose.models.savedExperience || mongoose.model("savedExperience", savedExperienceSchema, "savedposts");

module.exports = SavedExperience;
