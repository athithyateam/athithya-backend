const express = require("express");
const router = express.Router();
const { checkAuth, checkAdmin } = require("../middleware/checkRole");
const adminHandler = require("../handlers/adminHandler");

// All admin routes require authentication and admin role
router.use(checkAuth, checkAdmin);

// Stats
router.get("/stats", adminHandler.getAdminStats);

// Users Management
router.get("/users", adminHandler.getAllUsers);
router.patch("/users/:id", adminHandler.updateUser);
router.patch("/users/:id/role", adminHandler.updateUserRole);
router.delete("/users/:id", adminHandler.deleteUser);

// Experiences Management
router.get("/experiences", adminHandler.getAllExperiences);
router.get("/experiences/pending", adminHandler.getPendingExperiences);
router.patch("/experiences/:id", adminHandler.updateExperience);
router.patch("/experiences/:id/status", adminHandler.updateExperienceStatus);
router.delete("/experiences/:id", adminHandler.deleteExperience);

// Bookings Management
router.get("/bookings", adminHandler.getAllBookings);
router.patch("/bookings/:id", adminHandler.updateBooking);
router.delete("/bookings/:id", adminHandler.deleteBooking);

// Host Management
router.get("/hosts/pending", adminHandler.getPendingHostVerifications);
router.patch("/hosts/:userId/verification", adminHandler.updateHostVerificationStatus);
router.get("/host-history", adminHandler.getHostHistory);

// Chat Activity Management
router.get("/chat-activity", adminHandler.getChatActivity);

module.exports = router;
