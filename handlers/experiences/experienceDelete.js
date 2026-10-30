const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Delete an experience listing
 */
const deleteExperience = async (req, res) => {
    try {
        const result = await experienceService.deleteExperience(
            req.params.id,
            req.user.userId,
            req.user.role,
            req.app
        );

        return res.status(200).json(result);
    } catch (err) {
        console.error("Delete experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to delete experience"
        });
    }
};

module.exports = {
    deleteExperience
};
