/**
 * Review Handler
 * HTTP controller layer for review submissions, queries, eligibility checks, and ratings.
 * Delegates all domain logic, validations, and recalculations to ReviewService.
 */

const { reviewService } = require("../services/reviewService");

/**
 * Create or update a review
 * POST /api/reviews
 */
const createReview = async (req, res) => {
    try {
        const body = req.body || {};
        const { hostId, experienceId, rating, comment } = body;
        const result = await reviewService.createOrUpdateReview(
            req.user.userId,
            req.user.role,
            { hostId, experienceId, rating, comment }
        );

        return res.status(result.isUpdate ? 200 : 201).json({
            success: true,
            message: result.isUpdate ? "Rating updated successfully" : "Rating submitted successfully",
            review: result.review
        });
    } catch (error) {
        console.error("Submit review error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error processing your rating"
        });
    }
};

/**
 * Get all reviews for a host
 * GET /api/reviews/host/:hostId
 */
const getHostReviews = async (req, res) => {
    try {
        const result = await reviewService.getHostReviews(req.params.hostId, req.query);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get host reviews error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching reviews"
        });
    }
};

/**
 * Get all reviews written by a specific reviewer
 * GET /api/reviews/reviewer/:reviewerId
 */
const getReviewerReviews = async (req, res) => {
    try {
        const result = await reviewService.getReviewerReviews(req.params.reviewerId, req.query);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get reviewer reviews error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching reviews"
        });
    }
};

/**
 * Get reviews written by the authenticated user
 * GET /api/reviews/my/reviews
 */
const getMyReviews = async (req, res) => {
    try {
        const reviews = await reviewService.getMyReviews(req.user.userId);
        return res.status(200).json({
            success: true,
            count: reviews.length,
            reviews
        });
    } catch (error) {
        console.error("Get my reviews error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching your reviews"
        });
    }
};

/**
 * Get reviews received by the authenticated host
 * GET /api/reviews/received
 */
const getReceivedReviews = async (req, res) => {
    try {
        if (req.user.role !== "host") {
            return res.status(403).json({
                success: false,
                message: "Only hosts can view received reviews"
            });
        }

        const result = await reviewService.getReceivedReviews(req.user.userId, req.query);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get received reviews error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching received reviews"
        });
    }
};

/**
 * Check if the authenticated user is eligible to review an experience
 * GET /api/reviews/check-eligibility
 */
const checkReviewEligibility = async (req, res) => {
    try {
        const experienceId = req.query.experienceId || req.query.id;
        const result = await reviewService.checkReviewEligibility(
            req.user.userId,
            req.user.role,
            experienceId
        );
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Check eligibility error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error checking review eligibility"
        });
    }
};

/**
 * Get latest public reviews for homepage feed
 * GET /api/reviews/latest
 */
const getLatestReviews = async (req, res) => {
    try {
        const reviews = await reviewService.getLatestReviews(req.query.limit);
        return res.status(200).json({
            success: true,
            count: reviews.length,
            reviews
        });
    } catch (error) {
        console.error("Get latest reviews error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching latest reviews"
        });
    }
};

/**
 * Get single review by ID
 * GET /api/reviews/:id
 */
const getReviewById = async (req, res) => {
    try {
        const review = await reviewService.getReviewById(req.params.id);
        return res.status(200).json({
            success: true,
            review
        });
    } catch (error) {
        console.error("Get review error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching review"
        });
    }
};

/**
 * Update review by owner
 * PUT /api/reviews/:id
 */
const updateReview = async (req, res) => {
    try {
        const updatedReview = await reviewService.updateReview(
            req.params.id,
            req.user.userId,
            req.body || {}
        );
        return res.status(200).json({
            success: true,
            message: "Review updated successfully",
            review: updatedReview
        });
    } catch (error) {
        console.error("Update review error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating review"
        });
    }
};

/**
 * Delete review by owner or admin
 * DELETE /api/reviews/:id
 */
const deleteReview = async (req, res) => {
    try {
        await reviewService.deleteReview(req.params.id, req.user.userId, req.user.role);
        return res.status(200).json({
            success: true,
            message: "Review deleted successfully"
        });
    } catch (error) {
        console.error("Delete review error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error deleting review"
        });
    }
};

module.exports = {
    createReview,
    getHostReviews,
    getReviewerReviews,
    getMyReviews,
    getReceivedReviews,
    checkReviewEligibility,
    getLatestReviews,
    getReviewById,
    updateReview,
    deleteReview,
    updateExperienceRating: (id) => reviewService.recalculateExperienceRating(id)
};
