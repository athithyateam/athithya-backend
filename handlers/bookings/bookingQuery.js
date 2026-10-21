const { bookingService } = require("../../services/bookingService");

/**
 * Fetch booking requests received by a host with group revenue aggregation
 */
exports.getHostRequests = async (req, res) => {
    try {
        const result = await bookingService.getHostRequests(req.user.userId, req.query);
        res.status(200).json({
            success: true,
            data: result.bookings,
            pagination: result.pagination,
            summary: result.summary
        });
    } catch (error) {
        console.error("Error fetching booking requests:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to fetch booking requests" });
    }
};

/**
 * Fetch bookings made by a guest
 */
exports.getGuestBookings = async (req, res) => {
    try {
        const result = await bookingService.getGuestBookings(req.user.userId, req.query);
        res.status(200).json({
            success: true,
            data: result.bookings,
            pagination: result.pagination
        });
    } catch (error) {
        console.error("Error fetching guest bookings:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to fetch bookings" });
    }
};

/**
 * Fetch details of a single booking with authorization and host privacy check
 */
exports.getBookingDetails = async (req, res) => {
    try {
        const data = await bookingService.getBookingDetails(req.params.bookingId, req.user.userId);
        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to fetch booking record" });
    }
};
