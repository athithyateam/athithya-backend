const rateLimit = require("express-rate-limit");

/**
 * NOTE on serverless (Vercel): express-rate-limit's default store is
 * in-memory, scoped to a single function instance. On Vercel, multiple
 * cold-started instances can run concurrently, so a determined attacker
 * spreading requests across instances could get a higher effective limit
 * than configured below. This still stops the common cases (a single
 * script hammering one endpoint, a stuck retry loop, casual brute force)
 * and is a big improvement over no limiting at all.
 *
 * If/when this needs to be airtight (e.g. after real traffic growth),
 * swap the store for a shared one backed by Redis — Upstash has a
 * serverless-friendly REST-based Redis that works well with Vercel
 * functions (`rate-limit-redis` + `@upstash/redis`).
 */

const jsonRateLimitResponse = (req, res, next, options) => {
    res.status(options.statusCode).json({
        success: false,
        message: options.message || "Too many requests. Please try again later.",
    });
};

/**
 * Strict limiter for sign-in attempts.
 * Keyed by IP + email so a single attacker can't lock out a real user's
 * email from other IPs, while still slowing down brute-force from one IP.
 */
const signinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { default: false },
    keyGenerator: (req) => `${req.ip}:${(req.body?.email || "").toLowerCase()}`,
    handler: (req, res, next, options) =>
        jsonRateLimitResponse(req, res, next, {
            ...options,
            message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
        }),
});

/**
 * Limiter for OTP-sending endpoints (signup initiate, phone OTP, forgot password).
 * OTP sends cost money (SMS/email) and can be abused to spam a phone/inbox,
 * so this is intentionally tighter than the sign-in limiter.
 */
const otpRequestLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { default: false },
    keyGenerator: (req) => `${req.ip}:${(req.body?.email || req.body?.phone || "").toLowerCase()}`,
    handler: (req, res, next, options) =>
        jsonRateLimitResponse(req, res, next, {
            ...options,
            message: "Too many OTP requests. Please wait a few minutes before requesting another code.",
        }),
});

/**
 * Limiter for OTP-verification endpoints (guards against brute-forcing a
 * 4-6 digit code once it's been sent).
 */
const otpVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { default: false },
    keyGenerator: (req) => `${req.ip}:${(req.body?.email || req.body?.phone || "").toLowerCase()}`,
    handler: (req, res, next, options) =>
        jsonRateLimitResponse(req, res, next, {
            ...options,
            message: "Too many verification attempts. Please wait before trying again.",
        }),
});

/**
 * General-purpose limiter for other sensitive-but-lower-risk auth routes
 * (reset-password submission, google sign-in).
 */
const authGeneralLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { default: false },
    handler: jsonRateLimitResponse,
});

module.exports = {
    signinLimiter,
    otpRequestLimiter,
    otpVerifyLimiter,
    authGeneralLimiter,
};