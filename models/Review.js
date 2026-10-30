const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    reviewerRole: { type: String, enum: ['guest', 'host'], required: true },
    experience: { type: mongoose.Schema.Types.ObjectId, ref: 'experience' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 }
}, { timestamps: true });

reviewSchema.index({ host: 1, createdAt: -1 });
reviewSchema.index({ host: 1, reviewer: 1, experience: 1 }, { unique: true, sparse: true });
reviewSchema.index({ experience: 1, createdAt: -1 });

// Function to update experience rating
reviewSchema.statics.calculateAverageRating = async function (experienceId) {
    if (!experienceId) return;

    const targetObjId = new mongoose.Types.ObjectId(experienceId);
    const stats = await this.aggregate([
        { 
            $match: { experience: targetObjId } 
        },
        {
            $group: {
                _id: null,
                nRating: { $sum: 1 },
                avgRating: { $avg: '$rating' }
            }
        }
    ]);

    const ExperienceModel = mongoose.models.experience || mongoose.model('experience');
    if (stats.length > 0) {
        await ExperienceModel.findByIdAndUpdate(experienceId, {
            'rating.count': stats[0].nRating,
            'rating.average': Math.round(stats[0].avgRating * 10) / 10
        });
    } else {
        await ExperienceModel.findByIdAndUpdate(experienceId, {
            'rating.count': 0,
            'rating.average': 0
        });
    }
};

// Call calculateAverageRating after save
reviewSchema.post('save', function () {
    if (this.experience) {
        this.constructor.calculateAverageRating(this.experience);
    }
});

// Call calculateAverageRating after findOneAnd (update/delete)
reviewSchema.post(/^findOneAnd/, async function (doc) {
    if (doc && doc.experience) {
        await doc.constructor.calculateAverageRating(doc.experience);
    }
});

const Review = mongoose.models.review || mongoose.model("review", reviewSchema);

module.exports = Review;
