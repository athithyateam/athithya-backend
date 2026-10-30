const express = require("express");
const { validateUser, signupSchema, otpCompleteSchema, googleSigninSchema } = require("../middleware/validateUser");
const { checkAuth, checkAdmin, checkOptionalAuth } = require("../middleware/checkRole");
const { signinLimiter, otpRequestLimiter, otpVerifyLimiter, authGeneralLimiter } = require("../middleware/rateLimiter");

const { upload } = require("../middleware/uploadMiddleware");

const authHandler = require("../handlers/authHandler");
const userHandler = require("../handlers/userHandler");
const adminHandler = require("../handlers/adminHandler");
const gridMediaHandler = require("../handlers/users/gridMedia");

const userrouter = express.Router();

// --- Auth Routes ---
userrouter.post("/signup/initiate", otpRequestLimiter, validateUser(signupSchema), authHandler.initiateSignup);
userrouter.post("/signup/complete", otpVerifyLimiter, validateUser(otpCompleteSchema), authHandler.completeSignup);
userrouter.post("/signin", signinLimiter, authHandler.signin);
userrouter.post("/google", authGeneralLimiter, validateUser(googleSigninSchema), authHandler.googleSignin);
userrouter.post("/forgot-password", otpRequestLimiter, authHandler.forgotPassword);
userrouter.post("/reset-password", authGeneralLimiter, authHandler.resetPassword);
userrouter.post("/logout", authHandler.logout);
userrouter.get("/me", checkAuth, authHandler.getMe);

// --- Profile & Social ---
// NOTE: multer removed from /profile — avatar now uploaded directly to S3 via pre-signed URL.
// The frontend sends { avatarUrl, avatarPublicId } as JSON fields instead of the file itself.
userrouter.put("/profile", checkAuth, userHandler.updateProfile);
userrouter.put("/location", checkAuth, userHandler.updateLocation);
userrouter.get("/location", checkAuth, userHandler.getLocation);
userrouter.get("/me/saved", checkAuth, userHandler.getSavedExperiences);
userrouter.delete("/profile", checkAuth, userHandler.deleteMyAccount);
userrouter.post("/verify-phone/send-otp", checkAuth, otpRequestLimiter, userHandler.sendPhoneOTP);
userrouter.post("/verify-phone/verify-otp", checkAuth, otpVerifyLimiter, userHandler.verifyPhoneOTP);
userrouter.post("/verify-host", checkAuth, userHandler.submitHostVerification);


// --- Host Profile Grid Media ---
userrouter.get("/profile/:userId/grid-media", checkOptionalAuth, gridMediaHandler.getHostGridMedia);
userrouter.patch("/grid-tab-preference", checkAuth, gridMediaHandler.updateGridTabPreference);
userrouter.post("/personal-media", checkAuth, gridMediaHandler.addPersonalMedia);
userrouter.delete("/personal-media/:id", checkAuth, gridMediaHandler.deletePersonalMedia);
userrouter.patch("/personal-media/:id/pin", checkAuth, gridMediaHandler.togglePinPersonalMedia);
userrouter.patch("/experience-media/pin", checkAuth, gridMediaHandler.togglePinExperienceMedia);

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

// This must be last
userrouter.get("/:id", checkAuth, userHandler.getUserById);

module.exports = userrouter;
