const express = require("express");
const postHandler = require("../handlers/postHandler");
const { checkAuth, checkAdmin, checkApprovedHost } = require("../middleware/checkRole");

const postRouter = express.Router();

/**
 * Common middlewares for setting defaults
 *
 * NOTE: multer has been intentionally removed from all create/update routes here.
 * The frontend now uploads files directly to S3 via pre-signed URLs and sends
 * only JSON payloads with S3 URLs. Keeping multer on JSON routes causes mobile
 * network errors because multer's busboy parser interferes with express.json()
 * body parsing on slow/unstable mobile connections.
 */
const setPostType = (type) => (req, res, next) => {
    req.postTypeFilter = type;
    req.postTypeDefault = type;
    next();
};

const setMyUser = (req, res, next) => {
    req.params.userId = req.user.userId;
    next();
};

// ==================== GENERAL POST ROUTES ====================

// PRESIGNED URL FOR S3 DIRECT UPLOAD
postRouter.get("/presigned-url", checkAuth, postHandler.getPresignedUrl);

// CREATE POST (JSON payload — files already on S3)
postRouter.post("/", checkAuth, checkApprovedHost, postHandler.createPost);

// GET ALL POSTS
postRouter.get("/", postHandler.getPosts);

// GET CATEGORY RECENT ACTIVITY & HIGHLIGHT STATUS
postRouter.get("/categories/activity", postHandler.getCategoryActivity);
postRouter.get("/categories/recent-activity", postHandler.getCategoryActivity);

// GET TOP-RATED TREKS
postRouter.get("/top-rated/treks", postHandler.getTopRatedTreks);

// GET NEARBY TREKS
postRouter.get("/nearby/treks", postHandler.getNearbyTreks);

// REACT TO POST
postRouter.put("/:id/react", checkAuth, postHandler.reactToPost);
postRouter.put("/:postId/react", checkAuth, postHandler.reactToPost);

// SAVE / BOOKMARK POST
postRouter.post("/:id/save", checkAuth, postHandler.savePost);

// UNSAVE / UNBOOKMARK POST
postRouter.delete("/:id/save", checkAuth, postHandler.unsavePost);

// GET REACTION STATS
postRouter.get("/:id/reactions", postHandler.getReactionStats);

// GET POST REVIEWS
postRouter.get("/reviews/:postId", postHandler.getPostReviews);

// USER'S POSTS
postRouter.get("/user/:userId", postHandler.getUserPosts);
postRouter.get("/my/posts", checkAuth, setMyUser, postHandler.getUserPosts);

// UPDATE & DELETE & HIDE (JSON payload — files already on S3)
postRouter.put("/:id", checkAuth, postHandler.updatePost);
postRouter.patch("/:id/request-hide", checkAuth, postHandler.requestHidePost);
postRouter.delete("/:id", checkAuth, postHandler.deletePost);

// ==================== DEDICATED EXPERIENCE ENDPOINTS ====================

postRouter.post("/experiences", checkAuth, checkApprovedHost, setPostType('experience'), postHandler.createPost);

postRouter.get("/experiences", setPostType(['experience', 'service', 'plan', 'trek']), postHandler.getPosts);
postRouter.get("/experiences/featured/list", setPostType(['experience', 'service', 'plan', 'trek']), (req, res, next) => { req.query.sort = 'clicks'; next(); }, postHandler.getPosts);
postRouter.get("/experiences/latest", setPostType(['experience', 'service', 'plan', 'trek']), postHandler.getPosts);
postRouter.get("/experiences/my/list", checkAuth, setPostType('experience'), setMyUser, postHandler.getUserPosts);
postRouter.get("/experiences/user/:userId", setPostType(['experience', 'service', 'plan', 'trek']), postHandler.getUserPosts);

// IMPORTANT: Most booked experiences (Most Loved)
postRouter.get("/most-reacted/experiences", setPostType(['experience', 'service', 'plan', 'trek']), (req, res, next) => { req.query.sort = 'bookings'; next(); }, postHandler.getPosts);

postRouter.get("/experiences/:id", postHandler.getPostDetail);
postRouter.put("/experiences/:id", checkAuth, setPostType('experience'), postHandler.updatePost);
postRouter.delete("/experiences/:id", checkAuth, setPostType('experience'), postHandler.deletePost);

// ==================== DEDICATED SERVICE ENDPOINTS ====================

postRouter.post("/services", checkAuth, checkApprovedHost, setPostType('service'), postHandler.createPost);

postRouter.get("/services", setPostType('service'), postHandler.getPosts);
postRouter.get("/services/:id", postHandler.getPostDetail);
postRouter.get("/services/featured/list", setPostType('service'), (req, res, next) => { req.query.isFeatured = 'true'; next(); }, postHandler.getPosts);
postRouter.get("/services/my/list", checkAuth, setPostType('service'), setMyUser, postHandler.getUserPosts);
postRouter.get("/services/host/:userId", setPostType('service'), postHandler.getUserPosts);
postRouter.put("/services/:id", checkAuth, setPostType('service'), postHandler.updatePost);
postRouter.delete("/services/:id", checkAuth, setPostType('service'), postHandler.deletePost);

// ==================== DEDICATED TREK ENDPOINTS ====================

postRouter.post("/treks", checkAuth, checkApprovedHost, setPostType('trek'), postHandler.createPost);

postRouter.get("/treks", setPostType('trek'), postHandler.getPosts);
postRouter.get("/all/treks", setPostType('trek'), postHandler.getPosts);
postRouter.get("/featured/treks", setPostType('trek'), (req, res, next) => { req.query.sort = 'clicks'; next(); }, postHandler.getPosts);
postRouter.get("/treks/:id", postHandler.getPostDetail);
postRouter.put("/treks/:id", checkAuth, setPostType('trek'), postHandler.updatePost);
postRouter.delete("/treks/:id", checkAuth, setPostType('trek'), postHandler.deletePost);

// ==================== ADMIN ROUTES ====================

postRouter.get("/admin/experiences/pending", checkAuth, checkAdmin, (req, res, next) => { req.query.status = 'pending'; next(); }, postHandler.getPendingPosts);
postRouter.patch("/admin/experiences/:id/status", checkAuth, checkAdmin, postHandler.updatePostStatus);

// Catch-all for single post (MUST BE LAST)
postRouter.get("/:id", postHandler.getPostDetail);

module.exports = postRouter;
