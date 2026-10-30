import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ReviewService } from "../services/reviewService";

describe("ReviewService Comprehensive Test Suite", () => {
    let mockReviewModel: any;
    let mockUserModel: any;
    let mockExperienceModel: any;
    let mockBookingModel: any;
    let service: ReviewService;

    const validHostId = new mongoose.Types.ObjectId().toString();
    const validGuestId = new mongoose.Types.ObjectId().toString();
    const validExpId = new mongoose.Types.ObjectId().toString();
    const validReviewId = new mongoose.Types.ObjectId().toString();

    beforeEach(() => {
        mockReviewModel = {
            find: () => mockReviewModel,
            findOne: async () => null,
            findById: async () => null,
            create: async (data: any) => ({ _id: validReviewId, ...data }),
            countDocuments: async () => 0,
            aggregate: async () => [],
            findByIdAndUpdate: async () => null,
            findByIdAndDelete: async () => null,
            deleteMany: async () => ({ deletedCount: 1 }),
            populate: () => mockReviewModel,
            sort: () => mockReviewModel,
            skip: () => mockReviewModel,
            limit: () => mockReviewModel,
            select: () => mockReviewModel,
            lean: async () => []
        };

        mockUserModel = {
            findById: async (id: any) => {
                if (id?.toString() === validHostId) {
                    return { _id: validHostId, role: "host", firstname: "Test", lastname: "Host" };
                }
                if (id?.toString() === validGuestId) {
                    return { _id: validGuestId, role: "guest", firstname: "Test", lastname: "Guest" };
                }
                return null;
            }
        };

        mockExperienceModel = {
            findById: async (id: any) => {
                if (id?.toString() === validExpId) {
                    return { _id: validExpId, title: "Trek", user: validHostId };
                }
                return null;
            },
            find: () => ({
                select: () => ({
                    lean: async () => [{ _id: validExpId }]
                })
            }),
            findByIdAndUpdate: async () => null
        };

        mockBookingModel = {
            findOne: async () => null
        };

        // Instantiate with dummy symbol for testing
        const instanceKey = (ReviewService as any).instanceKey;
        service = new ReviewService(
            instanceKey,
            mockReviewModel,
            mockUserModel,
            mockExperienceModel,
            mockBookingModel
        );
    });

    describe("checkReviewEligibility", () => {
        it("rejects host users with host_restricted", async () => {
            const result = await service.checkReviewEligibility(validGuestId, "host", validExpId);
            assert.strictEqual(result.eligible, false);
            assert.strictEqual(result.canReview, false);
            assert.strictEqual(result.reason, "host_restricted");
        });

        it("throws 400 for missing target ID", async () => {
            await assert.rejects(
                async () => service.checkReviewEligibility(validGuestId, "guest", ""),
                { statusCode: 400, message: "Experience ID is required" }
            );
        });

        it("throws 400 for malformed target ID", async () => {
            await assert.rejects(
                async () => service.checkReviewEligibility(validGuestId, "guest", "not-a-valid-id"),
                { statusCode: 400, message: "Invalid experience ID format" }
            );
        });

        it("throws 404 when target ID is neither experience nor host", async () => {
            const randomId = new mongoose.Types.ObjectId().toString();
            await assert.rejects(
                async () => service.checkReviewEligibility(validGuestId, "guest", randomId),
                { statusCode: 404, message: "Experience not found" }
            );
        });

        it("returns eligible: true when guest has completed experience booking", async () => {
            mockBookingModel.findOne = async (query: any) => {
                if (query.status === "completed") return { _id: "b1", status: "completed" };
                return null;
            };

            const result = await service.checkReviewEligibility(validGuestId, "guest", validExpId);
            assert.strictEqual(result.eligible, true);
            assert.strictEqual(result.canReview, true);
            assert.strictEqual(result.isExperience, true);
        });

        it("returns not_completed when booking exists but not completed", async () => {
            mockBookingModel.findOne = async (query: any) => {
                if (query.status === "completed") return null;
                return { _id: "b1", status: "in_progress" };
            };

            const result = await service.checkReviewEligibility(validGuestId, "guest", validExpId);
            assert.strictEqual(result.eligible, false);
            assert.strictEqual(result.reason, "not_completed");
        });

        it("returns not_booked when no booking exists for experience", async () => {
            mockBookingModel.findOne = async () => null;

            const result = await service.checkReviewEligibility(validGuestId, "guest", validExpId);
            assert.strictEqual(result.eligible, false);
            assert.strictEqual(result.reason, "not_booked");
        });
    });

    describe("createOrUpdateReview", () => {
        it("rejects host users from reviewing", async () => {
            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "host", {
                    hostId: validHostId,
                    rating: 5
                }),
                { statusCode: 400 }
            );
        });

        it("rejects user reviewing oneself", async () => {
            await assert.rejects(
                async () => service.createOrUpdateReview(validHostId, "guest", {
                    hostId: validHostId,
                    rating: 5
                }),
                { statusCode: 400, message: "You cannot review yourself" }
            );
        });

        it("rejects invalid or NaN ratings", async () => {
            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "guest", {
                    hostId: validHostId,
                    rating: "invalid" as any
                }),
                { statusCode: 400, message: "Rating must be a number between 1 and 5" }
            );

            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "guest", {
                    hostId: validHostId,
                    rating: 6
                }),
                { statusCode: 400, message: "Rating must be a number between 1 and 5" }
            );

            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "guest", {
                    hostId: validHostId,
                    rating: 0
                }),
                { statusCode: 400, message: "Rating must be a number between 1 and 5" }
            );
        });

        it("rejects malformed experienceId instead of silently creating host-only review", async () => {
            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "guest", {
                    hostId: validHostId,
                    experienceId: "malformed-exp-id",
                    rating: 5
                }),
                { statusCode: 400, message: "Invalid experience ID format" }
            );
        });

        it("rejects comment exceeding 1000 characters", async () => {
            await assert.rejects(
                async () => service.createOrUpdateReview(validGuestId, "guest", {
                    hostId: validHostId,
                    rating: 5,
                    comment: "a".repeat(1001)
                }),
                { statusCode: 400, message: "Comment cannot exceed 1000 characters" }
            );
        });

        it("auto-resolves hostId when experienceId is provided alone", async () => {
            // Mock eligibility to pass
            mockBookingModel.findOne = async () => ({ _id: "b1", status: "completed" });
            let createdData: any = null;
            mockReviewModel.create = async (d: any) => {
                createdData = d;
                return { _id: validReviewId, ...d };
            };
            mockReviewModel.findById = () => ({
                populate: () => ({
                    populate: () => ({
                        populate: () => ({
                            lean: async () => ({ _id: validReviewId, ...createdData })
                        })
                    })
                })
            });

            const res = await service.createOrUpdateReview(validGuestId, "guest", {
                experienceId: validExpId,
                rating: 4.8,
                comment: "Great experience!"
            });

            assert.strictEqual(res.isUpdate, false);
            assert.strictEqual(createdData.host, validHostId);
            assert.strictEqual(createdData.experience, validExpId);
            assert.strictEqual(createdData.rating, 5); // Rounded from 4.8
            assert.strictEqual(createdData.comment, "Great experience!");
        });
    });

    describe("getHostReviews Aggregation & Pagination", () => {
        it("throws 400 on invalid host ID format", async () => {
            await assert.rejects(
                async () => service.getHostReviews("bad-id"),
                { statusCode: 400, message: "Invalid host ID format" }
            );
        });

        it("accurately computes ratingDistribution, totalRatings, totalReviews, and averageRating via aggregation", async () => {
            mockReviewModel.aggregate = async () => [
                { _id: 5, count: 10, writtenCount: 8 },
                { _id: 4, count: 5, writtenCount: 2 }
            ];
            mockReviewModel.countDocuments = async () => 15;
            mockReviewModel.find = () => ({
                populate: () => ({
                    populate: () => ({
                        sort: () => ({
                            skip: () => ({
                                limit: () => ({
                                    lean: async () => [
                                        { _id: "r1", rating: 5, comment: "Awesome", reviewer: { _id: "u1" } },
                                        { _id: "r2", rating: 4, comment: "Nice", reviewer: { _id: "u2" } }
                                    ]
                                })
                            })
                        })
                    })
                })
            });

            const result = await service.getHostReviews(validHostId, { page: 1, limit: 10 });

            assert.strictEqual(result.total, 15);
            assert.strictEqual(result.totalPages, 2);
            assert.strictEqual(result.totalRatings, 15);
            assert.strictEqual(result.totalReviews, 10);
            assert.strictEqual(result.ratingDistribution[5], 10);
            assert.strictEqual(result.ratingDistribution[4], 5);
            assert.strictEqual(result.ratingDistribution[3], 0);
            // Average: (10*5 + 5*4) / 15 = 70 / 15 = 4.67
            assert.strictEqual(result.averageRating, 4.67);
            assert.strictEqual(result.count, 2);
        });
    });

    describe("updateReview & deleteReview Safety Checks", () => {
        it("rejects non-owner from updating review", async () => {
            mockReviewModel.findById = async () => ({
                _id: validReviewId,
                reviewer: new mongoose.Types.ObjectId().toString(),
                rating: 3
            });

            await assert.rejects(
                async () => service.updateReview(validReviewId, validGuestId, { rating: 5 }),
                { statusCode: 403, message: "You can only edit your own reviews" }
            );
        });

        it("allows admin to delete review even if not the author", async () => {
            const otherUser = new mongoose.Types.ObjectId().toString();
            mockReviewModel.findById = async () => ({
                _id: validReviewId,
                reviewer: otherUser,
                experience: null
            });
            let deleted = false;
            mockReviewModel.findByIdAndDelete = async () => {
                deleted = true;
            };

            await service.deleteReview(validReviewId, validGuestId, "admin");
            assert.strictEqual(deleted, true);
        });

        it("resets experience ratings when all reviews for an experience are deleted", async () => {
            let updatedRating: any = null;
            mockExperienceModel.findByIdAndUpdate = async (_id: any, update: any) => {
                updatedRating = update;
            };
            mockReviewModel.aggregate = async () => [];

            const count = await service.deleteExperienceReviews(validExpId);
            assert.strictEqual(count, 1);
            assert.deepStrictEqual(updatedRating, {
                "rating.average": 0,
                "rating.count": 0
            });
        });
    });
});
