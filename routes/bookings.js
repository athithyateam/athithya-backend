const express = require("express");
const bookingRouter = express.Router();
const { checkAuth } = require("../middleware/checkRole");

const { createBooking, verifyPayment } = require("../handlers/bookings/bookingCreate");
const { getHostRequests, getGuestBookings, getBookingDetails } = require("../handlers/bookings/bookingQuery");
const { 
    acceptBooking, 
    declineBooking, 
    requestCancellation, 
    approveCancellation,
    sendStartOTP,
    verifyStartOTP,
    sendCompletionOTP,
    verifyCompletionOTP,
    acceptOrphanedBooking,
    rejectOrphanedBooking
} = require("../handlers/bookings/bookingActions");

bookingRouter.post("/", checkAuth, createBooking);
bookingRouter.post("/verify", checkAuth, verifyPayment);
bookingRouter.get("/host/requests", checkAuth, getHostRequests);
bookingRouter.patch("/:bookingId/accept", checkAuth, acceptBooking);
bookingRouter.patch("/:bookingId/decline", checkAuth, declineBooking);
bookingRouter.patch("/:bookingId/orphaned-accept", checkAuth, acceptOrphanedBooking);
bookingRouter.patch("/:bookingId/orphaned-reject", checkAuth, rejectOrphanedBooking);
bookingRouter.get("/guest/my-bookings", checkAuth, getGuestBookings);
bookingRouter.get("/:bookingId", checkAuth, getBookingDetails);
bookingRouter.patch("/:bookingId/request-cancel", checkAuth, requestCancellation);
bookingRouter.patch("/:bookingId/approve-cancel", checkAuth, approveCancellation);

// Journey OTP endpoints
bookingRouter.post("/:bookingId/send-start-otp", checkAuth, sendStartOTP);
bookingRouter.post("/:bookingId/verify-start-otp", checkAuth, verifyStartOTP);
bookingRouter.post("/:bookingId/send-completion-otp", checkAuth, sendCompletionOTP);
bookingRouter.post("/:bookingId/verify-completion-otp", checkAuth, verifyCompletionOTP);

module.exports = bookingRouter;
