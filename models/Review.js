const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    reviewerRole: { type: String, enum: ['guest', 'host'], required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'post' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 }
}, { timestamps: true });

reviewSchema.index({ host: 1, createdAt: -1 });
reviewSchema.index({ host: 1, reviewer: 1, post: 1 }, { unique: true });
reviewSchema.index({ post: 1, createdAt: -1 });

// Function to update post rating
reviewSchema.statics.calculateAverageRating = async function (postId) {
    if (!postId) return;

    const stats = await this.aggregate([
        { $match: { post: new mongoose.Types.ObjectId(postId) } },
        {
            $group: {
                _id: '$post',
                nRating: { $sum: 1 },
                avgRating: { $avg: '$rating' }
            }
        }
    ]);

    if (stats.length > 0) {
        await mongoose.model('post').findByIdAndUpdate(postId, {
            'rating.count': stats[0].nRating,
            'rating.average': Math.round(stats[0].avgRating * 10) / 10
        });
    } else {
        await mongoose.model('post').findByIdAndUpdate(postId, {
            'rating.count': 0,
            'rating.average': 0
        });
    }
};

// Call calculateAverageRating after save
reviewSchema.post('save', function () {
    this.constructor.calculateAverageRating(this.post);
});

// Call calculateAverageRating after findOneAnd (update/delete)
reviewSchema.post(/^findOneAnd/, async function (doc) {
    if (doc) await doc.constructor.calculateAverageRating(doc.post);
});

const Review = mongoose.model("review", reviewSchema);

module.exports = Review;
