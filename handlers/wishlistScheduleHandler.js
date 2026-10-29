const { wishlistScheduleService } = require("../services/wishlistScheduleService");

const scheduleExperience = async (req, res) => {
    try {
        const schedule = await wishlistScheduleService.scheduleWishlistItem(
            req.user.userId,
            req.user.role,
            req.body
        );

        res.status(200).json({
            success: true,
            message: "Experience scheduled successfully!",
            schedule
        });
    } catch (err) {
        console.error("Error scheduling experience:", err);
        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to schedule experience"
        });
    }
};

const getMyWishlistSchedules = async (req, res) => {
    try {
        const schedules = await wishlistScheduleService.getMyWishlistSchedules(req.user.userId);
        res.status(200).json({
            success: true,
            schedules
        });
    } catch (err) {
        console.error("Error fetching wishlist schedules:", err);
        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to fetch schedules"
        });
    }
};

const checkScheduleStatus = async (req, res) => {
    try {
        const schedule = await wishlistScheduleService.checkWishlistScheduleStatus(
            req.user.userId,
            req.params.postId
        );

        res.status(200).json({
            success: true,
            isScheduled: !!schedule,
            schedule: schedule || null
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const unscheduleExperience = async (req, res) => {
    try {
        await wishlistScheduleService.removeWishlistSchedule(req.user.userId, req.params.id);
        res.status(200).json({
            success: true,
            message: "Experience unscheduled successfully"
        });
    } catch (err) {
        console.error("Error unscheduling experience:", err);
        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to unschedule"
        });
    }
};

module.exports = {
    scheduleExperience,
    getMyWishlistSchedules,
    checkScheduleStatus,
    unscheduleExperience
};
