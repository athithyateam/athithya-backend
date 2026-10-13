const express = require("express")
const { Review, User, Post } = require("../db/mongoose")
const { checkAuth } = require("../middleware/checkRole")
const reviewRouter = express.Router()

/**
 * Helper to update Post ratings when reviews change
 */
async function updatePostRating(postId) {
    if (!postId) return;
    try {
        const reviews = await Review.find({ post: postId });
        const count = reviews.length;
        const average = count > 0 
            ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 
            : 0;
            
        await Post.findByIdAndUpdate(postId, {
            'rating.average': average,
            'rating.count': count
        });
    } catch (err) {
        console.error("Error updating post rating:", err);
    }
}

const mongoose = require("mongoose");

// CREATE REVIEW - Authenticated users can review hosts
reviewRouter.post("/", checkAuth, async (req, res) => {
    let validPostId = null;
    try {
        if (req.user.role === 'host') {
            return res.status(400).json({
                success: false,
                message: "Hosts cannot engage with another host's experience. Only guests can."
            });
        }
        const { hostId, postId, rating, comment } = req.body;

        // Validation
        if (!hostId || !rating || !mongoose.Types.ObjectId.isValid(hostId)) {
            return res.status(400).json({
                success: false,
                message: "Valid host ID and rating are required"
            });
        }

        // Check if host exists and is actually a host
        const host = await User.findById(hostId);
        if (!host) {
            return res.status(404).json({
                success: false,
                message: "Host not found"
            });
        }

        if (host.role !== 'host') {
            return res.status(400).json({
                success: false,
                message: "Reviews can only be given to hosts"
            });
        }

        // Users cannot review themselves
        if (req.user.userId === hostId) {
            return res.status(400).json({
                success: false,
                message: "You cannot review yourself"
            });
        }

        // Validate rating
        const ratingNum = Number(rating);
        if (ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({
                success: false,
                message: "Rating must be between 1 and 5"
            });
        }

        // Normalize postId (handle empty string or invalid ObjectId safely)
        if (postId && typeof postId === 'string' && postId.trim() !== '' && mongoose.Types.ObjectId.isValid(postId.trim())) {
            validPostId = postId.trim();
        }

        // Check if post exists if provided
        if (validPostId) {
            const post = await Post.findById(validPostId);
            if (!post) {
                return res.status(404).json({
                    success: false,
                    message: "Post not found"
                });
            }

            // Check if the post belongs to the host
            if (post.user.toString() !== hostId) {
                return res.status(400).json({
                    success: false,
                    message: "This post does not belong to the specified host"
                });
            }

            // Verify that the guest has booked and completed this specific experience before reviewing
            const Booking = require("../models/Booking");
            const hasCompleted = await Booking.findOne({
                post: validPostId,
                guest: req.user.userId,
                status: 'completed'
            });

            if (!hasCompleted) {
                const hasAny = await Booking.findOne({
                    post: validPostId,
                    guest: req.user.userId
                });

                if (!hasAny) {
                    return res.status(403).json({
                        success: false,
                        message: "To review the experience, you need to first book and experience it thoroughly."
                    });
                } else {
                    return res.status(403).json({
                        success: false,
                        message: "To review the experience, you need to experience it and complete it."
                    });
                }
            }
        }

        // Check if user already reviewed this host for this specific post (or generic host review)
        const query = {
            host: hostId,
            reviewer: req.user.userId,
            post: validPostId
        };

        let review = await Review.findOne(query);
        const isUpdate = !!review;

        if (review) {
            // Update existing review
            review.rating = ratingNum;
            if (comment !== undefined) review.comment = comment;
            await review.save();
        } else {
            // Create new review
            review = await Review.create({
                ...query,
                reviewerRole: req.user.role,
                rating: ratingNum,
                comment: comment || ""
            });
        }

        const populatedReview = await Review.findById(review._id)
            .populate('reviewer', 'firstname lastname email role avatar')
            .populate('host', 'firstname lastname email role avatar')
            .populate('post', 'title postType');

        return res.status(isUpdate ? 200 : 201).json({
            success: true,
            message: isUpdate ? "Rating updated successfully" : "Rating submitted successfully",
            review: populatedReview
        });
    } catch (error) {
        console.error("Submit review error:", error);
        return res.status(500).json({ success: false, message: "Error processing your rating" });
    } finally {
        if (validPostId) {
            updatePostRating(validPostId);
        }
    }
});

// GET ALL REVIEWS FOR A HOST - Public
reviewRouter.get("/host/:hostId", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.hostId)) {
            return res.status(400).json({ success: false, message: "Invalid host ID format" });
        }
        const {
            rating,
            page = 1,
            limit = 20,
            includeRatingOnly
        } = req.query;

        const hostObjectId = new mongoose.Types.ObjectId(req.params.hostId);
        const hostPosts = await Post.find({ user: hostObjectId }).select('_id');
        const hostPostIds = hostPosts.map(p => p._id);

        const baseMatch = hostPostIds.length > 0
            ? { $or: [{ host: hostObjectId }, { post: { $in: hostPostIds } }] }
            : { host: hostObjectId };

        const filter = { ...baseMatch };

        if (rating) filter.rating = Number(rating);
        if (includeRatingOnly === 'false') {
            filter.comment = { $exists: true, $ne: "" };
        }

        const skip = (Number(page) - 1) * Number(limit);

        let reviews = await Review.find(filter)
            .populate('reviewer', 'firstname lastname email role avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);

        if (includeRatingOnly === 'false') {
            reviews = reviews.filter(r => r.comment && r.comment.trim() !== "");
        }

        // Filter out any orphaned reviews where reviewer user no longer exists
        reviews = reviews.filter(r => r.reviewer && (r.reviewer._id || r.reviewer.id));

        // Deduplicate in case a reviewer has multiple entries (e.g. host review + post review)
        const seenReviewers = new Set();
        const uniqueReviews = [];
        for (const r of reviews) {
            const revId = r.reviewer?._id ? r.reviewer._id.toString() : (r.reviewer?.id ? r.reviewer.id.toString() : null);
            if (!revId) continue;
            if (!seenReviewers.has(revId)) {
                seenReviewers.add(revId);
                uniqueReviews.push(r);
            } else if (r.comment && r.comment.trim() !== "") {
                const prevIdx = uniqueReviews.findIndex(x => (x.reviewer?._id ? x.reviewer._id.toString() : '') === revId);
                if (prevIdx !== -1 && (!uniqueReviews[prevIdx].comment || uniqueReviews[prevIdx].comment.trim() === "")) {
                    uniqueReviews[prevIdx] = r;
                }
            }
        }
        reviews = uniqueReviews;

        // Calculate average rating and rating distribution across unique reviewer ratings
        const allRatingsRaw = await Review.find(baseMatch).populate('reviewer', '_id');
        const seenAllReviewers = new Set();
        const allRatings = [];
        for (const r of allRatingsRaw) {
            if (!r.reviewer) continue;
            const revId = r.reviewer._id ? r.reviewer._id.toString() : r.reviewer.toString();
            if (!seenAllReviewers.has(revId)) {
                seenAllReviewers.add(revId);
                allRatings.push(r);
            }
        }

        const total = allRatings.length;

        const avgRating = allRatings.length > 0
            ? allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length
            : 0;

        const writtenReviewsCount = allRatings.filter(r => r.comment && r.comment.trim() !== "").length;

        const ratingDistribution = {
            5: allRatings.filter(r => r.rating === 5).length,
            4: allRatings.filter(r => r.rating === 4).length,
            3: allRatings.filter(r => r.rating === 3).length,
            2: allRatings.filter(r => r.rating === 2).length,
            1: allRatings.filter(r => r.rating === 1).length
        };

        return res.status(200).json({
            success: true,
            count: reviews.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            averageRating: Number(avgRating.toFixed(2)),
            totalRatings: allRatings.length,
            totalReviews: writtenReviewsCount,
            ratingDistribution,
            reviews
        });
    } catch (error) {
        console.error("Get host reviews error:", error);
        return res.status(500).json({ success: false, message: "Error fetching reviews" });
    }
});

// GET REVIEWS BY REVIEWER - Get all reviews written by a user
reviewRouter.get("/reviewer/:reviewerId", async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query

        const skip = (Number(page) - 1) * Number(limit)

        const reviews = await Review.find({ reviewer: req.params.reviewerId })
            .populate('host', 'firstname lastname email role avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip)

        const total = await Review.countDocuments({ reviewer: req.params.reviewerId })

        return res.status(200).json({
            success: true,
            count: reviews.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            reviews
        })
    } catch (error) {
        console.error("Get reviewer reviews error:", error)
        return res.status(500).json({ success: false, message: "Error fetching reviews" })
    }
})

// GET MY REVIEWS - Get reviews written by authenticated user
reviewRouter.get("/my/reviews", checkAuth, async (req, res) => {
    try {
        const reviews = await Review.find({ reviewer: req.user.userId })
            .populate('host', 'firstname lastname email role avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 })

        return res.status(200).json({
            success: true,
            count: reviews.length,
            reviews
        })
    } catch (error) {
        console.error("Get my reviews error:", error)
        return res.status(500).json({ success: false, message: "Error fetching your reviews" })
    }
})

// GET REVIEWS RECEIVED BY ME (for hosts) - Get reviews received by authenticated user
reviewRouter.get("/received", checkAuth, async (req, res) => {
    try {
        if (req.user.role !== 'host') {
            return res.status(403).json({
                success: false,
                message: "Only hosts can view received reviews"
            })
        }

        const {
            rating,
            page = 1,
            limit = 20
        } = req.query

        const filter = {
            host: req.user.userId
        }

        if (rating) filter.rating = Number(rating)

        const skip = (Number(page) - 1) * Number(limit)

        const reviews = await Review.find(filter)
            .populate('reviewer', 'firstname lastname email role avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip)

        const total = await Review.countDocuments(filter)

        return res.status(200).json({
            success: true,
            count: reviews.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            reviews
        })
    } catch (error) {
        console.error("Get received reviews error:", error)
        return res.status(500).json({ success: false, message: "Error fetching received reviews" })
    }
})

// CHECK ELIGIBILITY - Check if authenticated user is allowed to review a post
reviewRouter.get("/check-eligibility", checkAuth, async (req, res) => {
    try {
        if (req.user.role === 'host') {
            return res.status(200).json({
                success: true,
                eligible: false,
                reason: "host_restricted",
                message: "Hosts cannot engage with another host's experience. Only guests can."
            });
        }
        const { postId } = req.query;

        if (!postId) {
            return res.status(400).json({ success: false, message: "Post ID is required" });
        }

        const Booking = require("../models/Booking");
        const hasCompleted = await Booking.findOne({
            post: postId,
            guest: req.user.userId,
            status: 'completed'
        });

        if (hasCompleted) {
            return res.status(200).json({ success: true, eligible: true });
        }

        const hasAny = await Booking.findOne({
            post: postId,
            guest: req.user.userId
        });

        if (!hasAny) {
            return res.status(200).json({
                success: true,
                eligible: false,
                reason: "not_booked",
                message: "To review the experience, you need to first book and experience it thoroughly."
            });
        }

        return res.status(200).json({
            success: true,
            eligible: false,
            reason: "not_completed",
            message: "To review the experience, you need to experience it and complete it."
        });

    } catch (error) {
        console.error("Check eligibility error:", error);
        return res.status(500).json({ success: false, message: "Error checking review eligibility" });
    }
});

// GET LATEST PUBLIC REVIEWS (For Homepage Guest Reviews section - all written reviews sorted by latest)
reviewRouter.get("/latest", async (req, res) => {
    try {
        const limitNum = Math.min(Number(req.query.limit || 20), 50);

        // Fetch candidate reviews with non-empty written comments (any rating 1 to 5)
        // Sorted by newest first (createdAt: -1)
        const candidateReviews = await Review.find({ 
            comment: { $exists: true, $ne: "" },
            rating: { $gte: 1 }
        })
            .populate('reviewer', 'firstname lastname name email role avatar')
            .populate('host', 'firstname lastname name email role avatar')
            .populate('post', 'title postType photos location price')
            .sort({ createdAt: -1 })
            .limit(limitNum * 3);

        // Safely filter out any orphaned/deleted user records or empty/whitespace-only comments
        const validReviews = candidateReviews.filter(
            r => r && r.comment && r.comment.trim() !== "" && r.reviewer && (r.reviewer.firstname || r.reviewer.name)
        ).slice(0, limitNum);

        return res.status(200).json({
            success: true,
            count: validReviews.length,
            reviews: validReviews
        });
    } catch (error) {
        console.error("Get latest reviews error:", error);
        return res.status(500).json({ success: false, message: "Error fetching latest reviews" });
    }
});

// GET SINGLE REVIEW BY ID
reviewRouter.get("/:id", async (req, res) => {
    try {
        const review = await Review.findById(req.params.id)
            .populate('reviewer', 'firstname lastname email role avatar')
            .populate('host', 'firstname lastname email role avatar')
            .populate('post', 'title postType')

        if (!review) {
            return res.status(404).json({ success: false, message: "Review not found" })
        }

        return res.status(200).json({ success: true, review })
    } catch (error) {
        console.error("Get review error:", error)
        return res.status(500).json({ success: false, message: "Error fetching review" })
    }
})

// UPDATE REVIEW - Only review owner
reviewRouter.put("/:id", checkAuth, async (req, res) => {
    let review;
    try {
        review = await Review.findById(req.params.id)

        if (!review) {
            return res.status(404).json({ success: false, message: "Review not found" })
        }

        // Check if user is the review owner
        if (review.reviewer.toString() !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own reviews"
            })
        }

        const { rating, comment } = req.body

        // Update fields
        if (rating !== undefined) {
            const ratingNum = Number(rating)
            if (ratingNum < 1 || ratingNum > 5) {
                return res.status(400).json({
                    success: false,
                    message: "Rating must be between 1 and 5"
                })
            }
            review.rating = ratingNum
        }
        if (comment !== undefined) review.comment = comment

        await review.save()

        const updatedReview = await Review.findById(review._id)
            .populate('reviewer', 'firstname lastname email role avatar')
            .populate('host', 'firstname lastname email role avatar')
            .populate('post', 'title postType')

        return res.status(200).json({
            success: true,
            message: "Review updated successfully",
            review: updatedReview
        })
    } catch (error) {
        console.error("Update review error:", error)
        return res.status(500).json({ success: false, message: "Error updating review" })
    } finally {
        if (review && review.post) {
            updatePostRating(review.post);
        }
    }
})

// DELETE REVIEW - Only review owner
reviewRouter.delete("/:id", checkAuth, async (req, res) => {
    let review;
    try {
        review = await Review.findById(req.params.id)

        if (!review) {
            return res.status(404).json({ success: false, message: "Review not found" })
        }

        // Check if user is the review owner
        if (review.reviewer.toString() !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: "You can only delete your own reviews"
            })
        }

        await Review.findByIdAndDelete(req.params.id)

        return res.status(200).json({
            success: true,
            message: "Review deleted successfully"
        })
    } catch (error) {
        console.error("Delete review error:", error)
        return res.status(500).json({ success: false, message: "Error deleting review" })
    } finally {
        if (review && review.post) {
            updatePostRating(review.post);
        }
    }
})

module.exports = reviewRouter
