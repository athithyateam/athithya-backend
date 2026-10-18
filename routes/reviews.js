const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const reviewHandler = require("../handlers/reviewHandler");

const reviewRouter = express.Router();

// CREATE REVIEW - Authenticated users can review hosts
reviewRouter.post("/", checkAuth, reviewHandler.createReview);

// GET ALL REVIEWS FOR A HOST - Public
reviewRouter.get("/host/:hostId", reviewHandler.getHostReviews);

// GET REVIEWS BY REVIEWER - Get all reviews written by a user
reviewRouter.get("/reviewer/:reviewerId", reviewHandler.getReviewerReviews);

// GET MY REVIEWS - Get reviews written by authenticated user
reviewRouter.get("/my/reviews", checkAuth, reviewHandler.getMyReviews);

// GET REVIEWS RECEIVED BY ME (for hosts) - Get reviews received by authenticated user
reviewRouter.get("/received", checkAuth, reviewHandler.getReceivedReviews);

// CHECK ELIGIBILITY - Check if authenticated user is allowed to review a post
reviewRouter.get("/check-eligibility", checkAuth, reviewHandler.checkReviewEligibility);

// GET LATEST PUBLIC REVIEWS (For Homepage Guest Reviews section - all written reviews sorted by latest)
reviewRouter.get("/latest", reviewHandler.getLatestReviews);

// GET SINGLE REVIEW BY ID
reviewRouter.get("/:id", reviewHandler.getReviewById);

// UPDATE REVIEW - Only review owner
reviewRouter.put("/:id", checkAuth, reviewHandler.updateReview);

// DELETE REVIEW - Only review owner
reviewRouter.delete("/:id", checkAuth, reviewHandler.deleteReview);

module.exports = reviewRouter;
