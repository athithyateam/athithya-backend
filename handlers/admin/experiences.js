const { experienceService } = require("../../services/experienceService");

/**
 * Controller: Admin retrieves all experiences with search, category, and host filters
 */
exports.getAllExperiences = async (req, res) => {
    try {
        const result = await experienceService.getExperiences({
            ...req.query,
            isAdmin: true
        });

        return res.json({
            success: true,
            experiences: result.experiences,
            totalPages: result.totalPages,
            currentPage: result.page,
            totalDocuments: result.total
        });
    } catch (err) {
        console.error("Admin get all experiences error:", err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

/**
 * Controller: Admin retrieves pending experiences (new, updates, hide, unhide, and delete requests)
 */
exports.getPendingExperiences = async (req, res) => {
    try {
        const result = await experienceService.getPendingExperiences(req.query);

        return res.json({
            success: true,
            experiences: result.experiences,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages
        });
    } catch (err) {
        console.error("Admin get pending experiences error:", err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

/**
 * Controller: Admin directly updates experience details
 */
exports.updateExperience = async (req, res) => {
    try {
        const result = await experienceService.updateExperience(
            req.params.id,
            req.user?.userId || req.user?.id,
            "admin",
            req.body,
            req.files,
            req.app
        );

        return res.json({
            success: true,
            message: result?.message || "Experience updated successfully",
            experience: result?.experience || result
        });
    } catch (err) {
        console.error("Admin update experience error:", err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

/**
 * Controller: Admin updates experience status (approvals, rejections, hide/unhide, deletions)
 */
exports.updateExperienceStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        const result = await experienceService.updateExperienceStatus(
            req.params.id,
            status,
            remarks,
            req.user?.userId || req.user?.id,
            req.app
        );

        return res.json({
            success: true,
            message: result?.message || `Experience status updated to ${status}`,
            experience: result?.experience || result
        });
    } catch (err) {
        console.error("Admin update experience status error:", err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

/**
 * Controller: Admin deletes an experience listing permanently
 */
exports.deleteExperience = async (req, res) => {
    try {
        const result = await experienceService.deleteExperience(
            req.params.id,
            req.user?.userId || req.user?.id,
            "admin",
            req.app
        );

        return res.json(result);
    } catch (err) {
        console.error("Admin delete experience error:", err);
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};
