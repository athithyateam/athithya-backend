const express = require("express");
const { checkAuth, checkAdmin, checkOptionalAuth } = require("../middleware/checkRole");
const { otpRequestLimiter, otpVerifyLimiter } = require("../middleware/rateLimiter");

const userHandler = require("../handlers/userHandler");
const adminHandler = require("../handlers/adminHandler");
const authRouter = require("./auth");

const userrouter = express.Router();

// Mount auth endpoints on userrouter for full backwards-compatibility with /api/users/auth-endpoints
userrouter.use(authRouter);

// --- Profile & Verification ---
userrouter.put("/profile", checkAuth, userHandler.updateProfile);
userrouter.put("/location", checkAuth, userHandler.updateLocation);
userrouter.get("/location", checkAuth, userHandler.getLocation);
userrouter.get("/me/saved", checkAuth, userHandler.getSavedExperiences);
userrouter.delete("/profile", checkAuth, userHandler.deleteMyAccount);
userrouter.post("/verify-phone/send-otp", checkAuth, otpRequestLimiter, userHandler.sendPhoneOTP);
userrouter.post("/verify-phone/verify-otp", checkAuth, otpVerifyLimiter, userHandler.verifyPhoneOTP);
userrouter.post("/verify-host", checkAuth, userHandler.submitHostVerification);

// --- Host Profile Grid Media ---
userrouter.get("/profile/:userId/grid-media", checkOptionalAuth, userHandler.getHostGridMedia);
userrouter.patch("/grid-tab-preference", checkAuth, userHandler.updateGridTabPreference);
userrouter.post("/personal-media", checkAuth, userHandler.addPersonalMedia);
userrouter.delete("/personal-media/:id", checkAuth, userHandler.deletePersonalMedia);
userrouter.patch("/personal-media/:id/pin", checkAuth, userHandler.togglePinPersonalMedia);
userrouter.patch("/experience-media/pin", checkAuth, userHandler.togglePinExperienceMedia);

userrouter.get("/profile/:userId", checkOptionalAuth, userHandler.getProfile);
userrouter.get("/profile/:userId/complete", checkOptionalAuth, userHandler.getCompleteProfile);
userrouter.get("/top-rated/hosts", userHandler.getTopRatedHosts);
userrouter.get("/guests", checkOptionalAuth, userHandler.getGuests);

// --- Friendships ---
userrouter.post("/:id/friend-request", checkAuth, userHandler.sendFriendRequest);
userrouter.post("/:id/friend-accept", checkAuth, userHandler.acceptFriendRequest);
userrouter.post("/:id/friend-reject", checkAuth, userHandler.rejectFriendRequest);
userrouter.post("/:id/unfriend", checkAuth, userHandler.unfriend);
userrouter.get("/:id/friends", checkAuth, userHandler.getFriends);

// --- Admin ---
userrouter.get("/admin/users", checkAuth, checkAdmin, adminHandler.getAllUsers);
userrouter.get("/admin/users/:id", checkAuth, checkAdmin, adminHandler.getUserById);
userrouter.patch("/admin/users/:id/role", checkAuth, checkAdmin, adminHandler.updateUserRole);
userrouter.delete("/admin/users/:id", checkAuth, checkAdmin, adminHandler.deleteUser);
userrouter.get("/admin/stats", checkAuth, checkAdmin, adminHandler.getAdminStats);

// --- Admin Host Verification ---
userrouter.get("/admin/host-verifications/pending", checkAuth, checkAdmin, adminHandler.getPendingHostVerifications);
userrouter.patch("/admin/host-verifications/:userId/status", checkAuth, checkAdmin, adminHandler.updateHostVerificationStatus);

// Catch-all user by ID (must be last)
userrouter.get("/:id", checkAuth, userHandler.getUserById);

module.exports = userrouter;
