const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Update experience listing details
 */
const updateExperience = async (req, res) => {
    try {
        const result = await experienceService.updateExperience(
            req.params.id,
            req.user.userId || req.user.id,
            req.user.role,
            req.body,
            req.files,
            req.app
        );

        return res.status(200).json({
            success: true,
            isPendingReview: result.isPendingReview,
            message: result.message,
            experience: result.experience
        });
    } catch (err) {
        console.error("Update experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to update experience"
        });
    }
};

/**
 * Controller: Admin updates experience status (approve/reject/archive)
 */
const updateExperienceStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        const result = await experienceService.updateExperienceStatus(
            req.params.id,
            status,
            remarks,
            req.user?.userId || req.user?.id,
            req.app
        );

        return res.status(200).json({
            success: true,
            message: result?.message || `Experience status updated to ${status}`,
            experience: result?.experience || result
        });
    } catch (err) {
        console.error("Update experience status error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to update experience status"
        });
    }
};

/**
 * Controller: Host requests to hide/unhide experience
 */
const requestHideExperience = async (req, res) => {
    try {
        const { action, reason } = req.body;
        const result = await experienceService.toggleHideExperience(
            req.params.id,
            req.user.userId || req.user.id,
            req.user.role,
            action,
            reason,
            req.app
        );

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error("Toggle hide experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to process hide request"
        });
    }
};

module.exports = {
    updateExperience,
    updateExperienceStatus,
    requestHideExperience
};
