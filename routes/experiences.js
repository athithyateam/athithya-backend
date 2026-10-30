const express = require("express");
const experienceHandler = require("../handlers/experienceHandler");
const { checkAuth, checkAdmin, checkApprovedHost, checkOptionalAuth } = require("../middleware/checkRole");

const experienceRouter = express.Router();

/**
 * Common middlewares for setting defaults
 */
const setCategoryFilter = (cat) => (req, res, next) => {
    if (cat && !req.query.categories) req.query.categories = cat;
    next();
};

const setMyUser = (req, res, next) => {
    req.params.userId = req.user.userId;
    next();
};

// ==================== CORE EXPERIENCE ROUTES ====================

// PRESIGNED URL FOR S3 DIRECT UPLOAD
experienceRouter.get("/presigned-url", checkAuth, experienceHandler.getPresignedUrl);

// CREATE EXPERIENCE (JSON payload — files already on S3)
experienceRouter.post("/", checkAuth, checkApprovedHost, experienceHandler.createExperience);

// GET ALL EXPERIENCES
experienceRouter.get("/", checkOptionalAuth, experienceHandler.getExperiences);

// GET CATEGORY RECENT ACTIVITY & HIGHLIGHT STATUS
experienceRouter.get("/categories/activity", experienceHandler.getCategoryActivity);
experienceRouter.get("/categories/recent-activity", experienceHandler.getCategoryActivity);

// GET TOP-RATED TREKS
experienceRouter.get("/top-rated/treks", experienceHandler.getTopRatedTreks);

// GET NEARBY TREKS
experienceRouter.get("/nearby/treks", experienceHandler.getNearbyTreks);

// SAVE / BOOKMARK EXPERIENCE
experienceRouter.post("/:id/save", checkAuth, experienceHandler.saveExperience);

// UNSAVE / UNBOOKMARK EXPERIENCE
experienceRouter.delete("/:id/save", checkAuth, experienceHandler.unsaveExperience);

// GET EXPERIENCE REVIEWS
experienceRouter.get("/reviews/:experienceId", experienceHandler.getExperienceReviews);

// USER'S EXPERIENCES
experienceRouter.get("/user/:userId", checkOptionalAuth, experienceHandler.getUserExperiences);
experienceRouter.get("/my/experiences", checkAuth, setMyUser, experienceHandler.getUserExperiences);

// UPDATE & DELETE & HIDE (JSON payload — files already on S3)
experienceRouter.put("/:id", checkAuth, experienceHandler.updateExperience);
experienceRouter.patch("/:id/request-hide", checkAuth, experienceHandler.requestHideExperience);
experienceRouter.delete("/:id", checkAuth, experienceHandler.deleteExperience);

// CURATED LISTS
experienceRouter.get("/featured/list", (req, res, next) => { req.query.sort = 'clicks'; next(); }, experienceHandler.getExperiences);
experienceRouter.get("/latest", experienceHandler.getExperiences);
experienceRouter.get("/my/list", checkAuth, setMyUser, experienceHandler.getUserExperiences);
experienceRouter.get("/most-loved", (req, res, next) => { req.query.sort = 'bookings'; next(); }, experienceHandler.getExperiences);

// TREK CONVENIENCE ENDPOINTS
experienceRouter.post("/treks", checkAuth, checkApprovedHost, setCategoryFilter('Trek'), experienceHandler.createExperience);
experienceRouter.get("/treks", setCategoryFilter('Trek'), experienceHandler.getExperiences);
experienceRouter.get("/treks/:id", checkOptionalAuth, experienceHandler.getExperienceDetail);

// ADMIN ROUTES
experienceRouter.get("/admin/pending", checkAuth, checkAdmin, (req, res, next) => { req.query.status = 'pending'; next(); }, experienceHandler.getPendingExperiences);
experienceRouter.patch("/admin/:id/status", checkAuth, checkAdmin, experienceHandler.updateExperienceStatus);

// SINGLE EXPERIENCE BY ID
experienceRouter.get("/:id", checkOptionalAuth, experienceHandler.getExperienceDetail);

module.exports = experienceRouter;
