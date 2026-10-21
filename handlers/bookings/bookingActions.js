const { bookingService } = require("../../services/bookingService");

exports.acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { hostResponse } = req.body;
        const io = req.app?.get("io");

        const data = await bookingService.acceptBooking(bookingId, req.user.userId, hostResponse, io);
        res.status(200).json({ success: true, message: "Booking accepted successfully", data });
    } catch (error) {
        console.error("Error accepting booking:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to accept booking" });
    }
};

exports.declineBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { hostResponse } = req.body;
        const io = req.app?.get("io");

        const data = await bookingService.declineBooking(bookingId, req.user.userId, hostResponse, io);
        res.status(200).json({ success: true, message: "Booking declined successfully", data });
    } catch (error) {
        console.error("Error declining booking:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to decline booking" });
    }
};

exports.requestCancellation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { reason } = req.body;
        const io = req.app?.get("io");

        const data = await bookingService.requestCancellation(bookingId, req.user.userId, reason, io);
        res.json({ success: true, message: "Cancellation request sent", data });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to request cancellation" });
    }
};

exports.approveCancellation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const io = req.app?.get("io");

        const data = await bookingService.approveCancellation(bookingId, req.user.userId, io);
        res.json({ success: true, message: "Cancellation approved", data });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to approve cancellation" });
    }
};

exports.sendStartOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const result = await bookingService.sendStartOTP(bookingId, req.user.userId);
        res.status(200).json(result);
    } catch (error) {
        console.error("Error in sendStartOTP:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to send check-in OTP" });
    }
};

exports.verifyStartOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { otp } = req.body;
        const io = req.app?.get("io");

        const data = await bookingService.verifyStartOTP(bookingId, req.user.userId, otp, io);
        res.status(200).json({ success: true, message: "Check-in verified successfully. Journey has started!", data });
    } catch (error) {
        console.error("Error in verifyStartOTP:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to verify check-in OTP" });
    }
};

exports.sendCompletionOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const result = await bookingService.sendCompletionOTP(bookingId, req.user.userId);
        res.status(200).json(result);
    } catch (error) {
        console.error("Error in sendCompletionOTP:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to send checkout OTP" });
    }
};

exports.verifyCompletionOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { otp } = req.body;
        const io = req.app?.get("io");

        const data = await bookingService.verifyCompletionOTP(bookingId, req.user.userId, otp, io);
        res.status(200).json({ success: true, message: "Checkout verified successfully. Journey completed!", data });
    } catch (error) {
        console.error("Error in verifyCompletionOTP:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to verify checkout OTP" });
    }
};

exports.acceptOrphanedBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const io = req.app?.get("io");

        const data = await bookingService.acceptOrphanedBooking(bookingId, req.user.userId, io);
        res.status(200).json({ success: true, message: "Booking accepted successfully", data });
    } catch (error) {
        console.error("Error accepting orphaned booking:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to accept booking" });
    }
};

exports.rejectOrphanedBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const io = req.app?.get("io");

        const result = await bookingService.rejectOrphanedBooking(bookingId, req.user.userId, io);
        res.status(200).json({
            success: true,
            message: "Booking declined successfully and wallet credited",
            refundAmount: result.refundAmount
        });
    } catch (error) {
        console.error("Error declining orphaned booking:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to decline booking" });
    }
};
