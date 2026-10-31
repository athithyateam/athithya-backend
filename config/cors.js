/**
 * Centralized CORS Configuration
 * Manages allowed origins for web, mobile, local dev, and Vercel deployments.
 */

const allowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://localhost:5177",
    "http://localhost:3000",
    "http://localhost:5000",
    "https://athithya-pi.vercel.app",
    "https://athithya-frontend-app.vercel.app",
    "https://athithya.in",
    "https://www.athithya.in",
    "https://admin.athithya.in",
    "https://api.athithya.in",
    process.env.FRONTEND_URL
].filter(Boolean).map(o => o.replace(/\/$/, ""));

/**
 * Validates incoming origin against whitelist and approved domain patterns.
 * @param {string|undefined} origin
 * @param {Function} callback
 */
function originValidator(origin, callback) {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server)
    if (!origin) {
        return callback(null, true);
    }

    // Exact match against whitelist
    if (allowedOrigins.includes(origin)) {
        return callback(null, true);
    }

    try {
        const { hostname } = new URL(origin);
        const lowerHost = hostname.toLowerCase();

        if (
            lowerHost === "athithya.in" ||
            lowerHost.endsWith(".athithya.in") ||
            lowerHost.endsWith(".vercel.app") ||
            lowerHost === "localhost" ||
            lowerHost === "127.0.0.1"
        ) {
            return callback(null, true);
        }
    } catch (_) {
        // Invalid URL format
    }

    callback(null, false);
}

const corsOptions = {
    origin: originValidator,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"]
};

module.exports = {
    allowedOrigins,
    corsOptions,
    originValidator
};
