const { postService } = require("../../services/postService");

/**
 * Controller: Get posts with filters, pagination, and sorting
 */
exports.getPosts = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const result = await postService.getPosts({
            ...req.query,
            postTypeFilter: req.postTypeFilter
        });

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get posts error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching posts"
        });
    }
};

/**
 * Controller: Get detailed post info by id
 */
exports.getPostDetail = async (req, res) => {
    try {
        const result = await postService.getPostDetail(req.params.id);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get post detail error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching post detail"
        });
    }
};

/**
 * Controller: Get top-rated treks
 */
exports.getTopRatedTreks = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const result = await postService.getTopRatedTreks(req.query);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching top-rated treks"
        });
    }
};

/**
 * Controller: Get nearby treks / experiences
 */
exports.getNearbyTreks = async (req, res) => {
    try {
        const result = await postService.getNearbyTreks(req.query);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Error fetching nearby treks:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching nearby treks"
        });
    }
};

/**
 * Controller: Get posts for a specific user
 */
exports.getUserPosts = async (req, res) => {
    try {
        const posts = await postService.getUserPosts(req.params.userId, req.query.postType);

        return res.status(200).json({
            success: true,
            count: posts.length,
            posts
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching user posts"
        });
    }
};

/**
 * Controller: Get pending posts for admin review
 */
exports.getPendingPosts = async (req, res) => {
    try {
        const result = await postService.getPendingPosts(req.query);

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching pending posts"
        });
    }
};

/**
 * Controller: Get category recent activity and highlight status
 */
exports.getCategoryActivity = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const data = await postService.getCategoryActivity();

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error("Error fetching category activity:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching category activity"
        });
    }
};
