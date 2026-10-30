const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Get paginated experiences
 */
const getExperiences = async (req, res) => {
    try {
        const result = await experienceService.getExperiences({
            ...req.query,
            userRole: req.user?.role
        });

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            experiences: result.experiences
        });
    } catch (err) {
        console.error("Get experiences error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch experiences"
        });
    }
};

/**
 * Controller: Get experience detail by ID
 */
const getExperienceDetail = async (req, res) => {
    try {
        const result = await experienceService.getExperienceDetail(req.params.id);

        return res.status(200).json({
            success: true,
            experience: result.experience,
            reviews: result.reviews,
            similarExperiences: result.similarExperiences
        });
    } catch (err) {
        console.error("Get experience detail error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch experience details"
        });
    }
};

/**
 * Controller: Get top rated treks
 */
const getTopRatedTreks = async (req, res) => {
    try {
        const result = await experienceService.getTopRatedTreks(req.query);

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            treks: result.treks
        });
    } catch (err) {
        console.error("Get top rated treks error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch top rated treks"
        });
    }
};

/**
 * Controller: Get nearby treks using geo-coordinates
 */
const getNearbyTreks = async (req, res) => {
    try {
        const result = await experienceService.getNearbyTreks(req.query);

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            treks: result.treks
        });
    } catch (err) {
        console.error("Get nearby treks error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch nearby treks"
        });
    }
};

/**
 * Controller: Get experiences created by a specific user/host
 */
const getUserExperiences = async (req, res) => {
    try {
        const isSelfOrAdmin = req.user && (
            req.user.userId === req.params.userId ||
            req.user.id === req.params.userId ||
            req.user.role === "admin"
        );
        const experiences = await experienceService.getUserExperiences(req.params.userId, !!isSelfOrAdmin);

        return res.status(200).json({
            success: true,
            count: experiences.length,
            experiences
        });
    } catch (err) {
        console.error("Get user experiences error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch user experiences"
        });
    }
};

/**
 * Controller: Admin retrieves pending experiences awaiting review
 */
const getPendingExperiences = async (req, res) => {
    try {
        const result = await experienceService.getPendingExperiences(req.query);

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            experiences: result.experiences
        });
    } catch (err) {
        console.error("Get pending experiences error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch pending experiences"
        });
    }
};

/**
 * Controller: Get recent category activity
 */
const getCategoryActivity = async (_req, res) => {
    try {
        const data = await experienceService.getCategoryActivity();

        return res.status(200).json({
            success: true,
            data
        });
    } catch (err) {
        console.error("Get category activity error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch category activity"
        });
    }
};

module.exports = {
    getExperiences,
    getExperienceDetail,
    getTopRatedTreks,
    getNearbyTreks,
    getUserExperiences,
    getPendingExperiences,
    getCategoryActivity
};
