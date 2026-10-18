const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const guestScheduleHandler = require("../handlers/guestScheduleHandler");

const router = express.Router();

/**
 * POST /api/guest-schedules
 * Create or update a guest scheduled experience
 */
router.post("/", checkAuth, guestScheduleHandler.scheduleExperience);

/**
 * GET /api/guest-schedules/me
 * Get all active scheduled experiences for the logged-in guest
 */
router.get("/me", checkAuth, guestScheduleHandler.getMyGuestSchedules);

/**
 * GET /api/guest-schedules/check/:postId
 * Check if the logged-in user has scheduled a specific post
 */
router.get("/check/:postId", checkAuth, guestScheduleHandler.checkScheduleStatus);

/**
 * DELETE /api/guest-schedules/:id
 * Delete / unschedule an experience
 */
router.delete("/:id", checkAuth, guestScheduleHandler.unscheduleExperience);

module.exports = router;
