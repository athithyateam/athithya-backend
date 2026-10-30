const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const wishlistScheduleHandler = require("../handlers/wishlistScheduleHandler");

const router = express.Router();

/**
 * POST /api/wishlist-schedules
 * Create or update a wishlist item with scheduled reminder
 */
router.post("/", checkAuth, wishlistScheduleHandler.scheduleExperience);

/**
 * GET /api/wishlist-schedules/me
 * Get all active scheduled wishlist items for the logged-in guest
 */
router.get("/me", checkAuth, wishlistScheduleHandler.getMyWishlistSchedules);

/**
 * GET /api/wishlist-schedules/check/:experienceId
 * Check if the logged-in user has scheduled a specific experience
 */
router.get("/check/:experienceId", checkAuth, wishlistScheduleHandler.checkScheduleStatus);

/**
 * DELETE /api/wishlist-schedules/:id
 * Delete / unschedule a wishlist reminder
 */
router.delete("/:id", checkAuth, wishlistScheduleHandler.unscheduleExperience);

module.exports = router;
