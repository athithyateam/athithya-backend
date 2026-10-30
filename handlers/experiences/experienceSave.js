const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Save / Bookmark an experience
 */
const saveExperience = async (req, res) => {
    try {
        const result = await experienceService.saveExperience(
            req.params.id,
            req.user.userId,
            req.user.role
        );

        return res.status(200).json(result);
    } catch (err) {
        console.error("Save experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Error saving experience"
        });
    }
};

/**
 * Controller: Unsave / Remove bookmark from an experience
 */
const unsaveExperience = async (req, res) => {
    try {
        const result = await experienceService.unsaveExperience(
            req.params.id,
            req.user.userId
        );

        return res.status(200).json(result);
    } catch (err) {
        console.error("Unsave experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Error unsaving experience"
        });
    }
};

module.exports = {
    saveExperience,
    unsaveExperience
};
