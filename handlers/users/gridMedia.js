/**
 * Host Grid Media Handler
 * HTTP controller layer for host profile grid media (experience photos/videos and personal moments).
 * Delegates business logic, validations, and storage operations to GridMediaService.
 */

const { gridMediaService } = require("../../services/users/gridMediaService");

/**
 * Get host profile grid media
 * GET /api/users/profile/:userId/grid-media
 */
exports.getHostGridMedia = async (req, res) => {
    try {
        const result = await gridMediaService.getHostGridMedia(req.params.userId);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Error fetching host grid media:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching host grid media"
        });
    }
};

/**
 * Update active grid tab preference
 * PATCH /api/users/grid-tab-preference
 */
exports.updateGridTabPreference = async (req, res) => {
    try {
        const result = await gridMediaService.updateGridTabPreference(req.user.userId, req.body.activeGridTab);
        return res.status(200).json({
            success: true,
            message: "Grid tab preference updated",
            data: result
        });
    } catch (error) {
        console.error("Error updating grid tab preference:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Server error updating grid tab preference"
        });
    }
};

/**
 * Upload personal media moments
 * POST /api/users/personal-media
 */
exports.addPersonalMedia = async (req, res) => {
    try {
        const result = await gridMediaService.addPersonalMedia(req.user.userId, req.body.items);
        return res.status(201).json({
            success: true,
            message: "Personal media added successfully",
            data: result
        });
    } catch (error) {
        console.error("Error adding personal media:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error adding personal media"
        });
    }
};

/**
 * Delete personal media moment
 * DELETE /api/users/personal-media/:id
 */
exports.deletePersonalMedia = async (req, res) => {
    try {
        await gridMediaService.deletePersonalMedia(req.user.userId, req.params.id);
        return res.status(200).json({
            success: true,
            message: "Personal media deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting personal media:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error deleting personal media"
        });
    }
};

/**
 * Toggle pin on personal media moment
 * PATCH /api/users/personal-media/:id/pin
 */
exports.togglePinPersonalMedia = async (req, res) => {
    try {
        const result = await gridMediaService.togglePinPersonalMedia(req.user.userId, req.params.id);
        return res.status(200).json({
            success: true,
            isPinned: result.isPinned,
            message: result.isPinned ? "Media pinned to top" : "Media unpinned"
        });
    } catch (error) {
        console.error("Error toggling pin on personal media:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating pin status"
        });
    }
};

/**
 * Toggle pin on experience media item
 * PATCH /api/users/experience-media/pin
 */
exports.togglePinExperienceMedia = async (req, res) => {
    try {
        const result = await gridMediaService.togglePinExperienceMedia(req.user.userId, req.body.mediaKey);
        return res.status(200).json({
            success: true,
            isPinned: result.isPinned,
            pinnedExperienceMedia: result.pinnedExperienceMedia,
            message: result.isPinned ? "Experience media pinned" : "Experience media unpinned"
        });
    } catch (error) {
        console.error("Error toggling pin on experience media:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating pin status"
        });
    }
};
