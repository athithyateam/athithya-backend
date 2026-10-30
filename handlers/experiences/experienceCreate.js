const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Create a new experience listing (Hosts & Admins only)
 */
const createExperience = async (req, res) => {
    try {
        const experience = await experienceService.createExperience(
            req.user.userId || req.user.id,
            req.user.role,
            req.body,
            req.files,
            req.app
        );

        return res.status(201).json({
            success: true,
            message: "Experience created and submitted for admin approval",
            experience
        });
    } catch (err) {
        console.error("Create experience error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to create experience"
        });
    }
};

module.exports = {
    createExperience
};
