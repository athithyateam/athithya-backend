const express = require("express");
const { validateUser, signupSchema, otpCompleteSchema, googleSigninSchema } = require("../middleware/validateUser");
const { checkAuth } = require("../middleware/checkRole");
const { signinLimiter, otpRequestLimiter, otpVerifyLimiter, authGeneralLimiter } = require("../middleware/rateLimiter");
const authHandler = require("../handlers/authHandler");

const authRouter = express.Router();

// --- Authentication Endpoints ---
authRouter.post("/signup/initiate", otpRequestLimiter, validateUser(signupSchema), authHandler.initiateSignup);
authRouter.post("/signup/complete", otpVerifyLimiter, validateUser(otpCompleteSchema), authHandler.completeSignup);
authRouter.post("/signin", signinLimiter, authHandler.signin);
authRouter.post("/google", authGeneralLimiter, validateUser(googleSigninSchema), authHandler.googleSignin);
authRouter.post("/forgot-password", otpRequestLimiter, authHandler.forgotPassword);
authRouter.post("/reset-password", authGeneralLimiter, authHandler.resetPassword);
authRouter.post("/logout", authHandler.logout);
authRouter.get("/me", checkAuth, authHandler.getMe);

module.exports = authRouter;
