/**
 * Review Service
 * Central domain service managing all review operations, ratings calculations,
 * booking completion verifications, host review statistics, and cascading cleanups.
 */

import mongoose from "mongoose";
const { Review, User, Experience, Booking } = require("../db/mongoose");

export interface ReviewData {
    hostId: string;
    experienceId?: string | null;
    rating: number;
    comment?: string;
}

export interface HostReviewsOptions {
    rating?: number | string;
    page?: number | string;
    limit?: number | string;
    includeRatingOnly?: string | boolean;
}

export interface ReviewStats {
    totalRatings: number;
    totalReviews: number;
    averageRating: number;
    currentUserRating: number | null;
    ratings: {
        1: number;
        2: number;
        3: number;
        4: number;
        5: number;
    };
}

export interface HostReviewsResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    averageRating: number;
    totalRatings: number;
    totalReviews: number;
    ratingDistribution: Record<number, number>;
    reviews: any[];
}

export interface EligibilityResult {
    eligible: boolean;
    reason?: "host_restricted" | "not_booked" | "not_completed";
    message?: string;
}

export class ReviewService {
    private static instance: ReviewService | null = null;
    private static instanceKey = Symbol("ReviewServiceInstanceKey");

    private reviewModel: any;
    private userModel: any;
    private experienceModel: any;
    private bookingModel: any;

    constructor(
        instanceKey: symbol,
        reviewModel: any = Review,
        userModel: any = User,
        experienceModel: any = Experience,
        bookingModel: any = Booking
    ) {
        if (instanceKey !== ReviewService.instanceKey) {
            throw new Error("Use ReviewService.getInstance() to obtain the singleton instance.");
        }
        this.reviewModel = reviewModel;
        this.userModel = userModel;
        this.experienceModel = experienceModel;
        this.bookingModel = bookingModel;
    }

    public static getInstance(
        reviewModel?: any,
        userModel?: any,
        experienceModel?: any,
        bookingModel?: any
    ): ReviewService {
        if (!this.instance) {
            this.instance = new ReviewService(
                this.instanceKey,
                reviewModel || Review,
                userModel || User,
                experienceModel || Experience,
                bookingModel || Booking
            );
        }
        return this.instance;
    }

    /**
     * Recalculate average rating and rating count for an experience
     */
    public async recalculateExperienceRating(experienceId: string): Promise<{ average: number; count: number }> {
        if (!experienceId) return { average: 0, count: 0 };
        try {
            const reviews = await this.reviewModel.find({ experience: experienceId });
            const count = reviews.length;
            const average = count > 0
                ? Math.round((reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / count) * 10) / 10
                : 0;

            await this.experienceModel.findByIdAndUpdate(experienceId, {
                "rating.average": average,
                "rating.count": count
            });
            return { average, count };
        } catch (err) {
            console.error("Error recalculating experience rating:", err);
            return { average: 0, count: 0 };
        }
    }

    /**
     * Check if a guest user is eligible to review an experience
     */
    public async checkReviewEligibility(
        userId: string,
        userRole: string,
        experienceId: string
    ): Promise<EligibilityResult> {
        if (userRole === "host") {
            return {
                eligible: false,
                reason: "host_restricted",
                message: "Hosts cannot engage with another host's experience. Only guests can."
            };
        }

        if (!experienceId) {
            const error: any = new Error("Experience ID is required");
            error.statusCode = 400;
            throw error;
        }

        const hasCompleted = await this.bookingModel.findOne({
            experience: experienceId,
            guest: userId,
            status: "completed"
        });

        if (hasCompleted) {
            return { eligible: true };
        }

        const hasAny = await this.bookingModel.findOne({
            experience: experienceId,
            guest: userId
        });

        if (!hasAny) {
            return {
                eligible: false,
                reason: "not_booked",
                message: "To review the experience, you need to first book and experience it thoroughly."
            };
        }

        return {
            eligible: false,
            reason: "not_completed",
            message: "To review the experience, you need to experience it and complete it."
        };
    }

    /**
     * Create or update a review
     */
    public async createOrUpdateReview(
        reviewerId: string,
        reviewerRole: string,
        data: ReviewData
    ): Promise<{ review: any; isUpdate: boolean }> {
        if (reviewerRole === "host") {
            const error: any = new Error("Hosts cannot engage with another host's experience. Only guests can.");
            error.statusCode = 400;
            throw error;
        }

        const { hostId, experienceId, rating, comment } = data;

        if (!hostId || !rating || !mongoose.Types.ObjectId.isValid(hostId)) {
            const error: any = new Error("Valid host ID and rating are required");
            error.statusCode = 400;
            throw error;
        }

        const host = await this.userModel.findById(hostId);
        if (!host) {
            const error: any = new Error("Host not found");
            error.statusCode = 404;
            throw error;
        }

        if (host.role !== "host") {
            const error: any = new Error("Reviews can only be given to hosts");
            error.statusCode = 400;
            throw error;
        }

        if (reviewerId === hostId) {
            const error: any = new Error("You cannot review yourself");
            error.statusCode = 400;
            throw error;
        }

        const ratingNum = Number(rating);
        if (ratingNum < 1 || ratingNum > 5) {
            const error: any = new Error("Rating must be between 1 and 5");
            error.statusCode = 400;
            throw error;
        }

        let validExperienceId: string | null = null;
        if (experienceId && typeof experienceId === "string" && experienceId.trim() !== "" && mongoose.Types.ObjectId.isValid(experienceId.trim())) {
            validExperienceId = experienceId.trim();
        }

        if (validExperienceId) {
            const experience = await this.experienceModel.findById(validExperienceId);
            if (!experience) {
                const error: any = new Error("Experience not found");
                error.statusCode = 404;
                throw error;
            }

            if (experience.user.toString() !== hostId) {
                const error: any = new Error("This experience does not belong to the specified host");
                error.statusCode = 400;
                throw error;
            }

            const eligibility = await this.checkReviewEligibility(reviewerId, reviewerRole, validExperienceId);
            if (!eligibility.eligible) {
                const error: any = new Error(eligibility.message || "Not eligible to review this experience");
                error.statusCode = 403;
                throw error;
            }
        }

        const query: any = {
            host: hostId,
            reviewer: reviewerId,
            experience: validExperienceId || null
        };

        let review = await this.reviewModel.findOne(query);
        const isUpdate = !!review;

        if (review) {
            review.rating = ratingNum;
            if (comment !== undefined) review.comment = comment;
            await review.save();
        } else {
            review = await this.reviewModel.create({
                host: hostId,
                reviewer: reviewerId,
                experience: validExperienceId || null,
                reviewerRole: reviewerRole,
                rating: ratingNum,
                comment: comment || ""
            });
        }

        if (validExperienceId) {
            await this.recalculateExperienceRating(validExperienceId);
        }

        const populatedReview = await this.reviewModel.findById(review._id)
            .populate("reviewer", "firstname lastname email role avatar")
            .populate("host", "firstname lastname email role avatar")
            .populate("experience", "title photos location price");

        return { review: populatedReview, isUpdate };
    }

    /**
     * Get all reviews for a host, including rating breakdown and statistics
     */
    public async getHostReviews(hostId: string, options: HostReviewsOptions = {}): Promise<HostReviewsResult> {
        if (!mongoose.Types.ObjectId.isValid(hostId)) {
            const error: any = new Error("Invalid host ID format");
            error.statusCode = 400;
            throw error;
        }

        const { rating, page = 1, limit = 20, includeRatingOnly } = options;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 20);
        const skip = (pageNum - 1) * limitNum;

        const hostObjectId = new mongoose.Types.ObjectId(hostId);
        const hostExperiences = await this.experienceModel.find({ user: hostObjectId }).select("_id");
        const hostExpIds = hostExperiences.map((p: any) => p._id);

        const baseMatch = hostExpIds.length > 0
            ? { $or: [{ host: hostObjectId }, { experience: { $in: hostExpIds } }] }
            : { host: hostObjectId };

        const filter: any = { ...baseMatch };
        if (rating) filter.rating = Number(rating);
        if (includeRatingOnly === "false" || includeRatingOnly === false) {
            filter.comment = { $exists: true, $ne: "" };
        }

        let reviews = await this.reviewModel.find(filter)
            .populate("reviewer", "firstname lastname email role avatar")
            .populate("experience", "title photos location price")
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .skip(skip);

        if (includeRatingOnly === "false" || includeRatingOnly === false) {
            reviews = reviews.filter((r: any) => r.comment && r.comment.trim() !== "");
        }
        reviews = reviews.filter((r: any) => r.reviewer && (r.reviewer._id || r.reviewer.id));

        // Deduplicate in case a reviewer has multiple entries
        const seenReviewers = new Set<string>();
        const uniqueReviews: any[] = [];
        for (const r of reviews) {
            const revId = r.reviewer?._id ? r.reviewer._id.toString() : (r.reviewer?.id ? r.reviewer.id.toString() : null);
            if (!revId) continue;
            if (!seenReviewers.has(revId)) {
                seenReviewers.add(revId);
                uniqueReviews.push(r);
            } else if (r.comment && r.comment.trim() !== "") {
                const prevIdx = uniqueReviews.findIndex(x => (x.reviewer?._id ? x.reviewer._id.toString() : "") === revId);
                if (prevIdx !== -1 && (!uniqueReviews[prevIdx].comment || uniqueReviews[prevIdx].comment.trim() === "")) {
                    uniqueReviews[prevIdx] = r;
                }
            }
        }

        // Calculate distribution across all unique reviewer ratings
        const allRatingsRaw = await this.reviewModel.find(baseMatch).populate("reviewer", "_id");
        const seenAllReviewers = new Set<string>();
        const allRatings: any[] = [];
        for (const r of allRatingsRaw) {
            if (!r.reviewer) continue;
            const revId = r.reviewer._id ? r.reviewer._id.toString() : r.reviewer.toString();
            if (!seenAllReviewers.has(revId)) {
                seenAllReviewers.add(revId);
                allRatings.push(r);
            }
        }

        const total = allRatings.length;
        const avgRating = total > 0
            ? allRatings.reduce((sum: number, r: any) => sum + r.rating, 0) / total
            : 0;
        const writtenReviewsCount = allRatings.filter((r: any) => r.comment && r.comment.trim() !== "").length;

        const ratingDistribution: Record<number, number> = {
            5: allRatings.filter((r: any) => r.rating === 5).length,
            4: allRatings.filter((r: any) => r.rating === 4).length,
            3: allRatings.filter((r: any) => r.rating === 3).length,
            2: allRatings.filter((r: any) => r.rating === 2).length,
            1: allRatings.filter((r: any) => r.rating === 1).length
        };

        return {
            count: uniqueReviews.length,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            averageRating: Number(avgRating.toFixed(2)),
            totalRatings: total,
            totalReviews: writtenReviewsCount,
            ratingDistribution,
            reviews: uniqueReviews
        };
    }

    /**
     * Calculate host review statistics, distribution, and current user rating (for host profile display)
     */
    public async calculateHostReviewStats(hostId: string, currentUserId?: string): Promise<{
        reviews: any[];
        reviewStats: ReviewStats | null;
    }> {
        const hostObjectId = new mongoose.Types.ObjectId(hostId);
        const allHostReviews = await this.reviewModel.find({ host: hostId })
            .populate("reviewer", "firstname lastname avatar")
            .populate("experience", "title")
            .sort({ createdAt: -1 });

        const writtenReviews = allHostReviews.filter((r: any) => r.comment && r.comment.trim() !== "");

        const totalStats = await this.reviewModel.aggregate([
            { $match: { host: hostObjectId } },
            { $group: { _id: "$host", average: { $avg: "$rating" }, count: { $sum: 1 } } }
        ]);

        let reviewStats: ReviewStats | null = null;
        if (totalStats.length > 0) {
            const avg = totalStats[0].average || 0;
            const currentUserIdStr = currentUserId?.toString();
            const userRatingObj = currentUserIdStr
                ? await this.reviewModel.findOne({ host: hostId, reviewer: currentUserIdStr, experience: null })
                : null;

            reviewStats = {
                totalRatings: totalStats[0].count,
                totalReviews: writtenReviews.length,
                averageRating: Number(avg.toFixed(1)),
                currentUserRating: userRatingObj ? userRatingObj.rating : null,
                ratings: {
                    5: allHostReviews.filter((r: any) => r.rating === 5).length,
                    4: allHostReviews.filter((r: any) => r.rating === 4).length,
                    3: allHostReviews.filter((r: any) => r.rating === 3).length,
                    2: allHostReviews.filter((r: any) => r.rating === 2).length,
                    1: allHostReviews.filter((r: any) => r.rating === 1).length
                }
            };
        }

        return { reviews: writtenReviews, reviewStats };
    }

    /**
     * Get aggregate host rating (average and count) across all host and experience reviews
     */
    public async getHostRating(hostId: string): Promise<{ average: number; count: number }> {
        if (!hostId) return { average: 0, count: 0 };
        const hostObjectId = new mongoose.Types.ObjectId(hostId);
        const hostExperiences = await this.experienceModel.find({ user: hostObjectId }).select("_id");
        const hostExperienceIds = hostExperiences.map((p: any) => p._id);
        const baseMatch = hostExperienceIds.length > 0
            ? { $or: [{ host: hostObjectId }, { experience: { $in: hostExperienceIds } }] }
            : { host: hostObjectId };

        const hostStats = await this.reviewModel.aggregate([
            { $match: baseMatch },
            { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }
        ]);

        if (hostStats.length > 0) {
            return {
                average: Math.round(hostStats[0].average * 10) / 10,
                count: hostStats[0].count
            };
        }
        return { average: 0, count: 0 };
    }

    /**
     * Get all reviews written by a specific reviewer
     */
    public async getReviewerReviews(reviewerId: string, options: { page?: number | string; limit?: number | string } = {}): Promise<any> {
        const pageNum = Math.max(1, parseInt(String(options.page)) || 1);
        const limitNum = Math.max(1, parseInt(String(options.limit)) || 20);
        const skip = (pageNum - 1) * limitNum;

        const [reviews, total] = await Promise.all([
            this.reviewModel.find({ reviewer: reviewerId })
                .populate("host", "firstname lastname email role avatar")
                .populate("experience", "title photos location price")
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip(skip),
            this.reviewModel.countDocuments({ reviewer: reviewerId })
        ]);

        return {
            count: reviews.length,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            reviews
        };
    }

    /**
     * Get reviews written by the authenticated user
     */
    public async getMyReviews(userId: string): Promise<any[]> {
        return this.reviewModel.find({ reviewer: userId })
            .populate("host", "firstname lastname email role avatar")
            .populate("experience", "title photos location price")
            .sort({ createdAt: -1 });
    }

    /**
     * Get reviews received by a host user
     */
    public async getReceivedReviews(hostId: string, options: { rating?: number | string; page?: number | string; limit?: number | string } = {}): Promise<any> {
        const filter: any = { host: hostId };
        if (options.rating) filter.rating = Number(options.rating);

        const pageNum = Math.max(1, parseInt(String(options.page)) || 1);
        const limitNum = Math.max(1, parseInt(String(options.limit)) || 20);
        const skip = (pageNum - 1) * limitNum;

        const [reviews, total] = await Promise.all([
            this.reviewModel.find(filter)
                .populate("reviewer", "firstname lastname email role avatar")
                .populate("experience", "title photos location price")
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip(skip),
            this.reviewModel.countDocuments(filter)
        ]);

        return {
            count: reviews.length,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            reviews
        };
    }

    /**
     * Get latest public reviews for homepage feed
     */
    public async getLatestReviews(limit: number = 20): Promise<any[]> {
        const limitNum = Math.min(Number(limit) || 20, 50);
        const candidateReviews = await this.reviewModel.find({
            comment: { $exists: true, $ne: "" },
            rating: { $gte: 1 }
        })
            .populate("reviewer", "firstname lastname name email role avatar")
            .populate("host", "firstname lastname name email role avatar")
            .populate("experience", "title photos location price")
            .sort({ createdAt: -1 })
            .limit(limitNum * 3);

        return candidateReviews
            .filter((r: any) => r && r.comment && r.comment.trim() !== "" && r.reviewer && (r.reviewer.firstname || r.reviewer.name))
            .slice(0, limitNum);
    }

    /**
     * Get single review by ID
     */
    public async getReviewById(reviewId: string): Promise<any> {
        const review = await this.reviewModel.findById(reviewId)
            .populate("reviewer", "firstname lastname email role avatar")
            .populate("host", "firstname lastname email role avatar")
            .populate("experience", "title photos location price");

        if (!review) {
            const error: any = new Error("Review not found");
            error.statusCode = 404;
            throw error;
        }
        return review;
    }

    /**
     * Update an existing review by owner
     */
    public async updateReview(
        reviewId: string,
        userId: string,
        data: { rating?: number | string; comment?: string }
    ): Promise<any> {
        const review = await this.reviewModel.findById(reviewId);
        if (!review) {
            const error: any = new Error("Review not found");
            error.statusCode = 404;
            throw error;
        }

        if (review.reviewer.toString() !== userId) {
            const error: any = new Error("You can only edit your own reviews");
            error.statusCode = 403;
            throw error;
        }

        if (data.rating !== undefined) {
            const ratingNum = Number(data.rating);
            if (ratingNum < 1 || ratingNum > 5) {
                const error: any = new Error("Rating must be between 1 and 5");
                error.statusCode = 400;
                throw error;
            }
            review.rating = ratingNum;
        }
        if (data.comment !== undefined) review.comment = data.comment;

        await review.save();

        if (review.experience) {
            await this.recalculateExperienceRating(review.experience.toString());
        }

        return this.reviewModel.findById(review._id)
            .populate("reviewer", "firstname lastname email role avatar")
            .populate("host", "firstname lastname email role avatar")
            .populate("experience", "title photos location price");
    }

    /**
     * Delete an existing review by owner
     */
    public async deleteReview(reviewId: string, userId: string): Promise<void> {
        const review = await this.reviewModel.findById(reviewId);
        if (!review) {
            const error: any = new Error("Review not found");
            error.statusCode = 404;
            throw error;
        }

        if (review.reviewer.toString() !== userId) {
            const error: any = new Error("You can only delete your own reviews");
            error.statusCode = 403;
            throw error;
        }

        const experienceId = review.experience ? review.experience.toString() : null;
        await this.reviewModel.findByIdAndDelete(reviewId);

        if (experienceId) {
            await this.recalculateExperienceRating(experienceId);
        }
    }

    /**
     * Cleanup all reviews when a user account is deleted and recalculate affected experience ratings
     */
    public async cleanupUserReviews(userId: string): Promise<{ affectedExperienceCount: number }> {
        const userSubmittedReviews = await this.reviewModel.find({
            reviewer: userId,
            experience: { $ne: null }
        });
        const affectedExpIds = [...new Set(userSubmittedReviews.map((r: any) => r.experience?.toString()).filter(Boolean))];

        await this.reviewModel.deleteMany({ $or: [{ reviewer: userId }, { host: userId }] });

        for (const expId of affectedExpIds) {
            await this.recalculateExperienceRating(expId as string);
        }

        return { affectedExperienceCount: affectedExpIds.length };
    }

    /**
     * Get written reviews by a user for profile display (populated with host and experience)
     */
    public async getWrittenReviewsForProfile(userId: string): Promise<any[]> {
        return this.reviewModel.find({ reviewer: userId, comment: { $exists: true, $ne: "" } })
            .populate("host", "firstname lastname avatar")
            .populate("experience", "title")
            .sort({ createdAt: -1 });
    }

    /**
     * Get reviews for a specific experience
     */
    public async getExperienceReviews(experienceId: string, limit?: number): Promise<any[]> {
        let query = this.reviewModel.find({ experience: experienceId })
            .populate("reviewer", "firstname lastname avatar")
            .sort({ createdAt: -1 });
        if (limit && Number(limit) > 0) {
            query = query.limit(Number(limit));
        }
        return typeof query.lean === "function" ? query.lean() : query;
    }

    /**
     * Delete all reviews for an experience
     */
    public async deleteExperienceReviews(experienceId: string): Promise<number> {
        const result = await this.reviewModel.deleteMany({ experience: experienceId });
        return result?.deletedCount || 0;
    }

    /**
     * Get total count of all reviews
     */
    public async countReviews(): Promise<number> {
        return this.reviewModel.countDocuments();
    }
}

export const reviewService = ReviewService.getInstance();

