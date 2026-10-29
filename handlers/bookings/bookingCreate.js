const { bookingService } = require("../../services/bookingService");

/**
 * Initiates booking request, calculates tiered fees/discounts, and creates Razorpay order
 */
exports.createBooking = async (req, res) => {
    try {
        const result = await bookingService.createBooking(req.body, req.user?.userId, req.user?.role);

        res.status(201).json({
            success: true,
            message: result.amount > 0 ? "Order created. Payment required." : "Booking successful",
            data: result
        });
    } catch (error) {
        console.error("CRITICAL Booking creation error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : `Internal Server Error: ${error.message}`,
            error_details: error.name === "ValidationError" ? error.errors : null
        });
    }
};

/**
 * Verifies Razorpay payment signature and completes booking lifecycle
 */
exports.verifyPayment = async (req, res) => {
    try {
        const result = await bookingService.verifyPayment(req.body, req.user?.userId);

        res.status(200).json({
            success: true,
            message: "Payment verified and booking confirmed",
            data: result.booking,
            groupBooking: result.groupBooking,
            groupBookingId: result.groupBookingId
        });
    } catch (error) {
        console.error("Verification error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Verification failed",
            error: error.message
        });
    }
};
