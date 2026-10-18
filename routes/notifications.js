const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const notificationHandler = require("../handlers/notificationHandler");

const notificationRouter = express.Router();

// GET MY NOTIFICATIONS
notificationRouter.get("/", checkAuth, notificationHandler.getMyNotifications);

// GET BOOKING NOTIFICATIONS SPECIFICALLY
notificationRouter.get("/bookings", checkAuth, notificationHandler.getBookingNotifications);

// CREATE NOTIFICATION (Internal or Debug)
notificationRouter.post("/", checkAuth, notificationHandler.createNotification);

// MARK AS READ
notificationRouter.put("/:id/read", checkAuth, notificationHandler.markAsRead);

// MARK ALL AS READ
notificationRouter.put("/mark-all/read", checkAuth, notificationHandler.markAllAsRead);

// DELETE NOTIFICATION
notificationRouter.delete("/:id", checkAuth, notificationHandler.deleteNotification);

// CLEAR ALL
notificationRouter.delete("/clear/all", checkAuth, notificationHandler.clearAllNotifications);

// GET FOLLOW NOTIFICATIONS
notificationRouter.get("/follows", checkAuth, notificationHandler.getFollowNotifications);

module.exports = notificationRouter;
