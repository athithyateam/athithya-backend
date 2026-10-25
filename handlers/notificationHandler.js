const { notificationService } = require("../services/notificationService");

/**
 * GET /api/notifications
 * Get paginated notifications for the authenticated user
 */
const getMyNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly } = req.query;
        const result = await notificationService.getMyNotifications(req.user.userId, {
            page,
            limit,
            unreadOnly
        });

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get notifications error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching notifications"
        });
    }
};

/**
 * GET /api/notifications/bookings
 * Get booking-related notifications specifically
 */
const getBookingNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const result = await notificationService.getBookingNotifications(req.user.userId, {
            page,
            limit
        });

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get booking notifications error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching booking notifications"
        });
    }
};

/**
 * POST /api/notifications
 * Create notification (Internal or Debug)
 */
const createNotification = async (req, res) => {
    try {
        const { recipientId, title, message, type, link } = req.body;
        const notification = await notificationService.createNotification({
            recipientId: recipientId || req.user.userId,
            senderId: req.user.userId,
            title,
            message,
            type: type || 'info',
            link
        });

        return res.status(201).json({
            success: true,
            message: "Notification created",
            notification
        });
    } catch (error) {
        console.error("Create notification error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error creating notification"
        });
    }
};

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read
 */
const markAsRead = async (req, res) => {
    try {
        const notification = await notificationService.markAsRead(req.params.id, req.user.userId);
        return res.status(200).json({
            success: true,
            message: "Marked as read",
            notification
        });
    } catch (error) {
        console.error("Mark read error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating notification"
        });
    }
};

/**
 * PUT /api/notifications/mark-all/read
 * Mark all notifications as read for current user
 */
const markAllAsRead = async (req, res) => {
    try {
        await notificationService.markAllAsRead(req.user.userId);
        return res.status(200).json({
            success: true,
            message: "All notifications marked as read"
        });
    } catch (error) {
        console.error("Mark all read error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error updating notifications"
        });
    }
};

/**
 * DELETE /api/notifications/:id
 * Delete a single notification
 */
const deleteNotification = async (req, res) => {
    try {
        await notificationService.deleteNotification(req.params.id, req.user.userId);
        return res.status(200).json({
            success: true,
            message: "Notification deleted"
        });
    } catch (error) {
        console.error("Delete notification error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error deleting notification"
        });
    }
};

/**
 * DELETE /api/notifications/clear/all
 * Clear all notifications for current user
 */
const clearAllNotifications = async (req, res) => {
    try {
        await notificationService.clearAllNotifications(req.user.userId);
        return res.status(200).json({
            success: true,
            message: "Notifications cleared"
        });
    } catch (error) {
        console.error("Clear all error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error clearing notifications"
        });
    }
};

/**
 * GET /api/notifications/follows
 * Get follow-related notifications for user
 */
const getFollowNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const result = await notificationService.getFollowNotifications(req.user.userId, {
            page,
            limit
        });

        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error("Get follow notifications error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching follow notifications"
        });
    }
};

module.exports = {
    getMyNotifications,
    getBookingNotifications,
    createNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    getFollowNotifications
};
