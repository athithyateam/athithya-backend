/**
 * Review Service
 * Central domain service managing all review operations, ratings calculations,
 * booking completion verifications, host review statistics, and cascading cleanups.
 */

import mongoose from "mongoose";
const { Review, User, Experience, Booking } = require("../db/mongoose");

export interface ReviewData {
    hostId?: string;
    experienceId?: string | null;
    rating: number | string;
    comment?: string;
}

export interface ReviewPaginationOptions {
    page?: number | string;
    limit?: number | string;
    sort?: any;
    populateReviewer?: boolean;
    populateHost?: boolean;
    populateExperience?: boolean;
}

export interface HostReviewsOptions extends ReviewPaginationOptions {
    rating?: number | string;
    includeRatingOnly?: string | boolean;
    currentUserId?: string;
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
    ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
    reviewStats: ReviewStats;
    reviews: any[];
}

export interface EligibilityResult {
    eligible: boolean;
    canReview?: boolean;
    hasReviewed?: boolean;
    existingReview?: any;
    reason?: "host_restricted" | "not_booked" | "not_completed";
    message?: string;
    isExperience?: boolean;
    hostId?: string;
}

const POPULATE_USER = "firstname lastname email role avatar";
const POPULATE_EXPERIENCE = "title photos location price";

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

    // ==========================================
    // DRY VALIDATION & AGGREGATION HELPERS
    // ==========================================

    private validateObjectId(id: any, name: string): mongoose.Types.ObjectId {
        if (!id || typeof id !== "string" || id.trim() === "") {
            const error: any = new Error(`${name} is required`);
            error.statusCode = 400;
            throw error;
        }
        const cleanId = id.trim();
        if (!mongoose.Types.ObjectId.isValid(cleanId)) {
            const error: any = new Error(`Invalid ${name.charAt(0).toLowerCase() + name.slice(1)} format`);
            error.statusCode = 400;
            throw error;
        }
        return new mongoose.Types.ObjectId(cleanId);
    }

    private validateRating(rating: any): number {
        if (rating === undefined || rating === null) {
            const error: any = new Error("Rating is required");
            error.statusCode = 400;
            throw error;
        }
        const ratingNum = Number(rating);
        if (isNaN(ratingNum) || !Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            const error: any = new Error("Rating must be a number between 1 and 5");
            error.statusCode = 400;
            throw error;
        }
        return Math.round(ratingNum);
    }

    private validateComment(comment: any): string {
        if (comment === undefined || comment === null) return "";
        const trimmed = String(comment).trim();
        if (trimmed.length > 1000) {
            const error: any = new Error("Comment cannot exceed 1000 characters");
            error.statusCode = 400;
            throw error;
        }
        return trimmed;
    }

    /**
     * Centralized rating statistics aggregation pipeline.
     * Computes total ratings, written review count, average rating, and 1-5 distribution in a single pass.
     */
    private async aggregateRatingStats(matchFilter: any): Promise<{
        totalRatings: number;
        totalReviews: number;
        averageRating: number;
        ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
    }> {
        const statsResult = await this.reviewModel.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: "$rating",
                    count: { $sum: 1 },
                    writtenCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $ne: ["$comment", null] },
                                        { $ne: ["$comment", ""] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRatings = 0;
        let totalReviews = 0;
        let ratingSum = 0;

        for (const item of statsResult || []) {
            const star = item._id;
            if (star >= 1 && star <= 5) {
                ratingDistribution[star as 1 | 2 | 3 | 4 | 5] = item.count;
                totalRatings += item.count;
                totalReviews += item.writtenCount;
                ratingSum += star * item.count;
            }
        }

        const averageRating = totalRatings > 0 ? Number((ratingSum / totalRatings).toFixed(2)) : 0;
        return { totalRatings, totalReviews, averageRating, ratingDistribution };
    }

    /**
     * Build base match query for a host, covering reviews addressed directly to the host
     * or associated with any experiences owned by that host.
     */
    private async getHostBaseMatch(hostObjectId: mongoose.Types.ObjectId): Promise<any> {
        const hostExperiences = await this.experienceModel.find({ user: hostObjectId }).select("_id").lean();
        const hostExpIds = (hostExperiences || []).map((e: any) => e._id);
        return hostExpIds.length > 0
            ? { $or: [{ host: hostObjectId }, { experience: { $in: hostExpIds } }] }
            : { host: hostObjectId };
    }

    // ==========================================
    // CORE QUERY & DOMAIN OPERATIONS
    // ==========================================

    /**
     * Unified paginated query engine for review retrieval with population and sorting.
     */
    public async getReviews(
        filter: any = {},
        options: ReviewPaginationOptions = {}
    ): Promise<{
        count: number;
        total: number;
        page: number;
        totalPages: number;
        reviews: any[];
    }> {
        const pageNum = Math.max(1, parseInt(String(options.page)) || 1);
        const limitNum = options.limit ? Math.max(1, Math.min(parseInt(String(options.limit)) || 20, 100)) : 20;
        const skip = (pageNum - 1) * limitNum;
        const sort = options.sort || { createdAt: -1 };

        let query = this.reviewModel.find(filter);

        if (options.populateReviewer !== false && typeof query?.populate === "function") {
            query = query.populate("reviewer", POPULATE_USER);
        }
        if (options.populateHost !== false && typeof query?.populate === "function") {
            query = query.populate("host", POPULATE_USER);
        }
        if (options.populateExperience !== false && typeof query?.populate === "function") {
            query = query.populate("experience", POPULATE_EXPERIENCE);
        }

        if (typeof query?.sort === "function") {
            query = query.sort(sort);
        }
        if (typeof query?.skip === "function") {
            query = query.skip(skip);
        }
        if (typeof query?.limit === "function") {
            query = query.limit(limitNum);
        }

        const [rawReviews, total] = await Promise.all([
            typeof query?.lean === "function" ? query.lean() : query,
            this.reviewModel.countDocuments(filter)
        ]);

        const reviews = Array.isArray(rawReviews) ? rawReviews : [];
        return {
            count: reviews.length,
            total: total || 0,
            page: pageNum,
            totalPages: Math.ceil((total || 0) / limitNum) || 1,
            reviews
        };
    }

    /**
     * Recalculate average rating and rating count for an experience using MongoDB aggregation
     */
    public async recalculateExperienceRating(experienceId: string): Promise<{ average: number; count: number }> {
        if (!experienceId || !mongoose.Types.ObjectId.isValid(experienceId)) return { average: 0, count: 0 };
        try {
            const expObjectId = new mongoose.Types.ObjectId(experienceId);
            const stats = await this.aggregateRatingStats({ experience: expObjectId });
            const average = Math.round(stats.averageRating * 10) / 10;
            const count = stats.totalRatings;

            await this.experienceModel.findByIdAndUpdate(expObjectId, {
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
                canReview: false,
                reason: "host_restricted",
                message: "Hosts cannot engage with another host's experience. Only guests can."
            };
        }

        const expObjectId = this.validateObjectId(experienceId, "Experience ID");
        const expQuery = this.experienceModel.findById(expObjectId);
        const experience = await (typeof expQuery?.select === "function" ? expQuery.select("_id user") : expQuery);
        if (!experience) {
            const error: any = new Error("Experience not found");
            error.statusCode = 404;
            throw error;
        }

        const hasCompleted = await this.bookingModel.findOne({
            experience: expObjectId,
            $or: [{ guest: userId }, { "joinedUsers.user": userId }],
            status: "completed"
        });

        if (hasCompleted) {
            const revQuery = this.reviewModel.findOne({
                reviewer: userId,
                experience: expObjectId
            });
            const selectedRev = typeof revQuery?.select === "function" ? revQuery.select("_id rating comment createdAt updatedAt") : revQuery;
            const existingReview = await (typeof selectedRev?.lean === "function" ? selectedRev.lean() : selectedRev);

            return {
                eligible: true,
                canReview: true,
                hasReviewed: !!existingReview,
                existingReview: existingReview || null,
                isExperience: true,
                hostId: experience.user?.toString()
            };
        }

        const hasAny = await this.bookingModel.findOne({
            experience: expObjectId,
            $or: [{ guest: userId }, { "joinedUsers.user": userId }]
        });

        if (!hasAny) {
            return {
                eligible: false,
                canReview: false,
                reason: "not_booked",
                message: "To review the experience, you need to first book and experience it thoroughly."
            };
        }

        return {
            eligible: false,
            canReview: false,
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

        let { hostId, experienceId, rating, comment } = data || {};

        let validExperienceId: string | null = null;
        if (experienceId !== undefined && experienceId !== null && String(experienceId).trim() !== "") {
            validExperienceId = this.validateObjectId(experienceId, "Experience ID").toString();
        }

        if (validExperienceId) {
            const experience = await this.experienceModel.findById(validExperienceId);
            if (!experience) {
                const error: any = new Error("Experience not found");
                error.statusCode = 404;
                throw error;
            }

            const expHostId = experience.user.toString();
            if (hostId && hostId.toString() !== expHostId) {
                const error: any = new Error("This experience does not belong to the specified host");
                error.statusCode = 400;
                throw error;
            }
            if (!hostId) {
                hostId = expHostId;
            }

            const eligibility = await this.checkReviewEligibility(reviewerId, reviewerRole, validExperienceId);
            if (!eligibility.eligible) {
                const error: any = new Error(eligibility.message || "Not eligible to review this experience");
                error.statusCode = 403;
                throw error;
            }
        }

        if (!hostId || !mongoose.Types.ObjectId.isValid(hostId)) {
            const error: any = new Error("Valid host ID or experience ID is required");
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
        if (reviewerId && reviewerId.toString() === hostId.toString()) {
            const error: any = new Error("You cannot review yourself");
            error.statusCode = 400;
            throw error;
        }

        const finalRating = this.validateRating(rating);
        const finalComment = this.validateComment(comment);

        const query: any = {
            host: hostId,
            reviewer: reviewerId,
            experience: validExperienceId || null
        };

        let review = await this.reviewModel.findOne(query);
        const isUpdate = !!review;

        if (review) {
            review.rating = finalRating;
            if (comment !== undefined) review.comment = finalComment;
            await review.save();
        } else {
            review = await this.reviewModel.create({
                host: hostId,
                reviewer: reviewerId,
                experience: validExperienceId || null,
                reviewerRole: reviewerRole,
                rating: finalRating,
                comment: finalComment
            });
        }

        if (validExperienceId) {
            await this.recalculateExperienceRating(validExperienceId);
        }

        const findQuery = this.reviewModel.findById(review._id);
        const populatedReview = typeof findQuery?.populate === "function"
            ? await findQuery
                .populate("reviewer", POPULATE_USER)
                .populate("host", POPULATE_USER)
                .populate("experience", POPULATE_EXPERIENCE)
                .lean()
            : review;

        return { review: populatedReview, isUpdate };
    }

    /**
     * Get all reviews for a host, including rating breakdown and statistics.
     * Serves both public host review listings and profile host review statistics.
     */
    public async getHostReviews(hostId: string, options: HostReviewsOptions = {}): Promise<HostReviewsResult> {
        const hostObjectId = this.validateObjectId(hostId, "Host ID");
        const { rating, page = 1, limit = 20, includeRatingOnly, currentUserId } = options;

        const baseMatch = await this.getHostBaseMatch(hostObjectId);
        const filter: any = { ...baseMatch };

        if (rating !== undefined && rating !== null && rating !== "") {
            const rNum = Number(rating);
            if (!isNaN(rNum) && rNum >= 1 && rNum <= 5) {
                filter.rating = Math.round(rNum);
            }
        }
        if (includeRatingOnly === "false" || includeRatingOnly === false) {
            filter.comment = { $exists: true, $regex: /\S/ };
        }

        const [stats, paginatedResult] = await Promise.all([
            this.aggregateRatingStats(baseMatch),
            this.getReviews(filter, { page, limit, populateHost: false })
        ]);

        // Deduplicate multiple entries from same reviewer on this page prioritizing written comments
        const seenReviewers = new Set<string>();
        const uniqueReviews: any[] = [];
        for (const r of paginatedResult.reviews) {
            const revId = r.reviewer?._id ? r.reviewer._id.toString() : (r.reviewer?.id ? r.reviewer.id.toString() : null);
            if (!revId) continue;
            if (!seenReviewers.has(revId)) {
                seenReviewers.add(revId);
                uniqueReviews.push(r);
            } else if (r.comment && r.comment.trim() !== "") {
                const prevIdx = uniqueReviews.findIndex(x => (x.reviewer?._id ? x.reviewer._id.toString() : (x.reviewer?.id ? x.reviewer.id.toString() : "")) === revId);
                if (prevIdx !== -1 && (!uniqueReviews[prevIdx].comment || uniqueReviews[prevIdx].comment.trim() === "")) {
                    uniqueReviews[prevIdx] = r;
                }
            }
        }

        let currentUserRating: number | null = null;
        if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
            const userReview = await this.reviewModel.findOne({
                host: hostObjectId,
                reviewer: new mongoose.Types.ObjectId(currentUserId)
            }).sort({ createdAt: -1 });
            if (userReview) currentUserRating = userReview.rating;
        }

        const reviewStats: ReviewStats = {
            totalRatings: stats.totalRatings,
            totalReviews: stats.totalReviews,
            averageRating: Number(stats.averageRating.toFixed(1)),
            currentUserRating,
            ratings: stats.ratingDistribution
        };

        return {
            count: uniqueReviews.length,
            total: paginatedResult.total,
            page: paginatedResult.page,
            totalPages: paginatedResult.totalPages,
            averageRating: stats.averageRating,
            totalRatings: stats.totalRatings,
            totalReviews: stats.totalReviews,
            ratingDistribution: stats.ratingDistribution,
            reviewStats,
            reviews: uniqueReviews
        };
    }

    /**
     * Get reviews written by a specific reviewer, with optional comment filtering and pagination.
     */
    public async getReviewerReviews(
        reviewerId: string,
        options: { page?: number | string; limit?: number | string; hasComment?: boolean } = {}
    ): Promise<{ count: number; total: number; page: number; totalPages: number; reviews: any[] }> {
        const reviewerObjectId = this.validateObjectId(reviewerId, "Reviewer ID");
        const filter: any = { reviewer: reviewerObjectId };
        if (options.hasComment) {
            filter.comment = { $exists: true, $regex: /\S/ };
        }
        return this.getReviews(filter, { ...options, populateReviewer: false });
    }

    /**
     * Get reviews for a specific experience
     */
    public async getExperienceReviews(experienceId: string, limit?: number): Promise<any[]> {
        if (!experienceId || !mongoose.Types.ObjectId.isValid(experienceId)) return [];
        const result = await this.getReviews(
            { experience: new mongoose.Types.ObjectId(experienceId) },
            { limit: limit || 100, populateHost: false, populateExperience: false }
        );
        return result.reviews;
    }

    /**
     * Get latest public reviews for homepage feed
     */
    public async getLatestReviews(limit: number = 20): Promise<any[]> {
        const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));
        const result = await this.getReviews(
            { comment: { $exists: true, $regex: /\S/ }, rating: { $gte: 1 } },
            { limit: limitNum }
        );
        return result.reviews.filter(r => r.reviewer && (r.reviewer.firstname || r.reviewer.name));
    }

    /**
     * Get single review by ID
     */
    public async getReviewById(reviewId: string): Promise<any> {
        const objId = this.validateObjectId(reviewId, "Review ID");
        const query = this.reviewModel.findById(objId)
            .populate("reviewer", POPULATE_USER)
            .populate("host", POPULATE_USER)
            .populate("experience", POPULATE_EXPERIENCE);

        const review = await (typeof query?.lean === "function" ? query.lean() : query);
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
        const objId = this.validateObjectId(reviewId, "Review ID");
        const review = await this.reviewModel.findById(objId);
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

        if (data.rating !== undefined && data.rating !== null) {
            review.rating = this.validateRating(data.rating);
        }

        if (data.comment !== undefined && data.comment !== null) {
            review.comment = this.validateComment(data.comment);
        }

        await review.save();

        if (review.experience) {
            await this.recalculateExperienceRating(review.experience.toString());
        }

        const findQuery = this.reviewModel.findById(review._id);
        return typeof findQuery?.populate === "function"
            ? await findQuery
                .populate("reviewer", POPULATE_USER)
                .populate("host", POPULATE_USER)
                .populate("experience", POPULATE_EXPERIENCE)
                .lean()
            : review;
    }

    /**
     * Delete an existing review by owner or admin
     */
    public async deleteReview(reviewId: string, userId: string, userRole?: string): Promise<void> {
        const objId = this.validateObjectId(reviewId, "Review ID");
        const review = await this.reviewModel.findById(objId);
        if (!review) {
            const error: any = new Error("Review not found");
            error.statusCode = 404;
            throw error;
        }

        if (review.reviewer.toString() !== userId && userRole !== "admin") {
            const error: any = new Error("You can only delete your own reviews");
            error.statusCode = 403;
            throw error;
        }

        const experienceId = review.experience ? review.experience.toString() : null;
        await this.reviewModel.findByIdAndDelete(objId);

        if (experienceId) {
            await this.recalculateExperienceRating(experienceId);
        }
    }

    /**
     * Cleanup all reviews when a user account is deleted and recalculate affected experience ratings
     */
    public async cleanupUserReviews(userId: string): Promise<{ affectedExperienceCount: number }> {
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return { affectedExperienceCount: 0 };
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const userSubmittedReviews = await this.reviewModel.find({
            reviewer: userObjectId,
            experience: { $ne: null }
        });
        const submittedList = typeof userSubmittedReviews?.lean === "function" ? await userSubmittedReviews.lean() : userSubmittedReviews;

        const affectedExpIds = [...new Set(((submittedList || []) as any[]).map((r: any) => r.experience?.toString()).filter(Boolean))];

        await this.reviewModel.deleteMany({ $or: [{ reviewer: userObjectId }, { host: userObjectId }] });

        for (const expId of affectedExpIds) {
            await this.recalculateExperienceRating(expId as string);
        }

        return { affectedExperienceCount: affectedExpIds.length };
    }

    /**
     * Delete all reviews for an experience and reset experience ratings
     */
    public async deleteExperienceReviews(experienceId: string): Promise<number> {
        if (!experienceId || !mongoose.Types.ObjectId.isValid(experienceId)) {
            return 0;
        }
        const expObjectId = new mongoose.Types.ObjectId(experienceId);
        const result = await this.reviewModel.deleteMany({ experience: expObjectId });
        await this.recalculateExperienceRating(experienceId);
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
