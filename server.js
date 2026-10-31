/**
 * Athithya Backend - Main Application & Server Entrypoint
 * Modern ES6 Express Application with Socket.io, RESTful domain APIs,
 * connection pooling, and Vercel serverless compatibility.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");

// ============================================================================
// 1. ENVIRONMENT CONFIGURATION & ROBUST .ENV LOADING
// ============================================================================
const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, ".env")
];

for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
    }
}
// Fallback to default dotenv lookup
dotenv.config();

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const IS_VERCEL = process.env.VERCEL === "1" || process.env.VERCEL === "true" || Boolean(process.env.NOW_REGION);

// ============================================================================
// 2. CORE APPLICATION & SOCKET.IO INITIALIZATION
// ============================================================================
const app = express();
const server = http.createServer(app);

// Import Modular Components
const { corsOptions } = require("./config/cors");
const { setSecurityHeaders, sanitizeNoSQL } = require("./middleware/security");
const { connectDB } = require("./db/mongoose");
const { initSocketServer, getIo } = require("./sockets/socketServer");
const { startBackgroundWorkers, stopBackgroundWorkers } = require("./utils/scheduler");

// Initialize Realtime Sockets & bind with Express
const io = initSocketServer(server, corsOptions);
app.set("io", io);

// Trust reverse proxy for accurate client IP resolution (Vercel, AWS ALB, Nginx)
app.set("trust proxy", 1);

// ============================================================================
// 3. GLOBAL MIDDLEWARE PIPELINE
// ============================================================================
app.use(setSecurityHeaders);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Body parsers and input sanitizers
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(sanitizeNoSQL);

// Pre-flight database connection for API routes
app.use(async (req, res, next) => {
    if (req.path.startsWith("/api")) {
        try {
            await connectDB();
        } catch (error) {
            console.error("❌ DB Connection Middleware Error:", error.message);
            return res.status(503).json({
                success: false,
                message: "Database service unavailable. Please retry shortly."
            });
        }
    }
    next();
});

// Non-production request debugging logger
if (!IS_PRODUCTION) {
    app.use((req, res, next) => {
        console.log(`[DEBUG] ${req.method} ${req.originalUrl}`);
        next();
    });
}

// ============================================================================
// 4. ROUTE REGISTRATIONS
// ============================================================================
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const experienceRoutes = require("./routes/experiences");
const reviewRoutes = require("./routes/reviews");
const searchRoutes = require("./routes/search");
const bookingRoutes = require("./routes/bookings");
const groupBookingRoutes = require("./routes/groupBookings");
const wishlistScheduleRoutes = require("./routes/wishlistSchedules");
const chatRoutes = require("./routes/chat");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");

// Core RESTful domain endpoints
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/experiences", experienceRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/group-bookings", groupBookingRoutes);
app.use("/api/wishlist-schedules", wishlistScheduleRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/chat", chatRoutes);

// Backwards-compatibility aliases for legacy clients
app.use("/api/posts", experienceRoutes);
app.use("/api/schedules", groupBookingRoutes);
app.use("/api/guest-schedules", wishlistScheduleRoutes);

// ============================================================================
// 5. HEALTH CHECK, METADATA & UTILITY ENDPOINTS
// ============================================================================
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: NODE_ENV
    });
});

// Favicon handler to eliminate 404 log noise
app.get(["/favicon.ico", "/favicon.png"], (req, res) => res.status(204).end());

// Root API discovery endpoint
app.get("/", (req, res) => {
    res.status(200).json({
        name: "Athithya API",
        status: "operational",
        version: "1.0.0",
        endpoints: {
            health: "/health",
            auth: "/api/auth",
            users: "/api/users",
            experiences: "/api/experiences",
            bookings: "/api/bookings",
            search: "/api/search",
            chat: "/api/chat"
        }
    });
});

// API 404 handler
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: `API route not found: ${req.method} ${req.originalUrl}`
    });
});

// ============================================================================
// 6. GLOBAL ERROR HANDLING MIDDLEWARE
// ============================================================================
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    if (!isClientError) {
        console.error("🔥 UNHANDLED ERROR:", err);
    }

    if (!res.headersSent) {
        res.status(statusCode).json({
            success: false,
            message: err.message || "Internal Server Error",
            ...(NODE_ENV === "development" ? { stack: err.stack, details: err } : {})
        });
    }
});

// ============================================================================
// 7. SERVER LIFECYCLE & STANDALONE BOOTSTRAP
// ============================================================================
const shouldListen =
    NODE_ENV !== "production" ||
    process.env.RUN_SERVER === "true" ||
    (require.main === module && !IS_VERCEL);

/**
 * Boots HTTP and Socket.IO server for standalone environments
 */
async function startServer() {
    try {
        await connectDB();
        console.log("✅ Pre-connected to MongoDB on server startup");
    } catch (err) {
        console.error("❌ Failed to connect to MongoDB on startup:", err.message);
    }

    // Start background workers (periodic booking expiration and wishlist reminders)
    startBackgroundWorkers(app);

    server.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Athithya Server running with Socket.io on port ${PORT}`);
        console.log(`➜  Local API: http://localhost:${PORT}/api`);
        console.log(`➜  Environment: ${NODE_ENV}`);
    });

    // Graceful process termination handlers
    const shutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}. Gracefully shutting down...`);
        stopBackgroundWorkers();
        server.close(() => {
            console.log("👋 HTTP server closed.");
            process.exit(0);
        });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    return server;
}

if (shouldListen) {
    startServer();
} else {
    console.log(`[INFO] Server running in ${NODE_ENV} serverless mode (standalone listen skipped).`);
}

// Export Express app for Vercel serverless runtime and test suites
module.exports = app;
module.exports.app = app;
module.exports.server = server;
module.exports.io = io;
module.exports.getIo = getIo;
module.exports.startServer = startServer;
module.exports.default = app;
