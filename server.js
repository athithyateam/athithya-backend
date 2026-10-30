const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config(); // Fallback to local .env if it exists

const express = require("express");
const app = express();
const port = process.env.PORT || 5000;

// Middleware & Configurations
const _dirname = process.cwd();

console.log(`[DEBUG] NODE_ENV: "${process.env.NODE_ENV}"`);
console.log(`[DEBUG] PORT: "${process.env.PORT}"`);
console.log(`[DEBUG] VERCEL: "${process.env.VERCEL}"`);

const cors = require("cors");
const cookieParser = require("cookie-parser");

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
  process.env.FRONTEND_URL,
].filter(Boolean).map(o => o.replace(/\/$/, ""));

// CORS Policy using the 'cors' package
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    
    // Exact match in allowed origins list
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    // Check if origin matches athithya.in, local development, or vercel deployments
    try {
      const parsedUrl = new URL(origin);
      const hostname = parsedUrl.hostname.toLowerCase();
      if (
        hostname === "athithya.in" ||
        hostname.endsWith(".athithya.in") ||
        hostname.endsWith(".vercel.app") ||
        hostname === "localhost" ||
        hostname === "127.0.0.1"
      ) {
        return callback(null, true);
      }
    } catch (e) {
      // Invalid URL format
    }
    
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
};

const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: corsOptions
});
app.set("io", io);

// Register Socket.io instance with centralized NotificationService
const { notificationService } = require("./services/notificationService");
notificationService.setIo(io);

// Trust proxy for Vercel / reverse proxy deployments to correctly identify client IPs
app.set("trust proxy", 1);

// Security & Protection Middleware
const { setSecurityHeaders, sanitizeNoSQL } = require("./middleware/security");

app.use(setSecurityHeaders);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Parsers & Input Sanitization
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(sanitizeNoSQL);

// Database
const { connectDB } = require("./db/mongoose");

// Ensure DB connection for API routes
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await connectDB();
    } catch (error) {
      console.error("DB Connection Middleware Error:", error);
    }
  }
  next();
});
// Debug Logger for development
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEBUG] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const experienceRoutes = require("./routes/experiences");
const reviewRoutes = require("./routes/reviews");
const searchRoutes = require("./routes/search");
const bookingRoutes = require("./routes/bookings");
const groupBookingRoutes = require("./routes/groupBookings");
const wishlistScheduleRoutes = require("./routes/wishlistSchedules");
const chatRoutes = require("./routes/chat");
const { startWishlistReminderWorker } = require("./utils/wishlistReminderWorker");

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/experiences", experienceRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/bookings", bookingRoutes);
app.use("/api/group-bookings", groupBookingRoutes);
app.use("/api/wishlist-schedules", wishlistScheduleRoutes);
app.use("/api/admin", require("./routes/admin"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/chat", chatRoutes);

// Start background worker for wishlist experience schedule reminders
startWishlistReminderWorker(app);

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// Favicon handler to prevent 404 noise in logs
app.get(['/favicon.ico', '/favicon.png'], (req, res) => res.status(204).end());

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Athithya API is running",
    endpoints: {
      health: "/health",
      auth: "/api/auth",
      users: "/api/users"
    },
    version: "1.0.0"
  });
});

// Error Handling
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error - " + (err?.message || "Unknown error"),
      error: process.env.NODE_ENV === "development" ? err?.stack || err : {},
    });
  }
});

// Online status tracking
const { Message, Conversation } = require("./db/mongoose");
const onlineUsers = new Set();

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  let currentUserId = null;

  // Authenticated user joins their own room
  socket.on("join", (userId) => {
    currentUserId = userId;
    socket.join(userId);
    onlineUsers.add(userId);
    console.log(`User ${userId} joined their private room and is online`);
    io.emit("online_users_list", Array.from(onlineUsers));
  });

  // Handle private messages - Handled via REST API (/api/chat/messages) to prevent duplication and support serverless environments

  socket.on("typing", (data) => {
    const { senderId, recipientId, conversationId, isTyping } = data;
    io.to(recipientId).emit("user_typing", { senderId, conversationId, isTyping });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (currentUserId) {
      onlineUsers.delete(currentUserId);
      io.emit("online_users_list", Array.from(onlineUsers));
    }
  });
});

const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true" || !!process.env.NOW_REGION;
const shouldListen = process.env.NODE_ENV !== "production" || 
                     process.env.RUN_SERVER === "true" || 
                     (require.main === module && !isVercel);

if (shouldListen) {
  server.listen(port, "0.0.0.0", async () => {
    console.log(`✅ Server is running with Socket.io on port ${port}`);
    console.log(`➜  Local API: http://localhost:${port}/api`);
    console.log(`➜  Environment: ${process.env.NODE_ENV || 'development'}`);

    // Pre-connect database on startup to prevent buffering timeouts for background tasks
    try {
      await connectDB();
    } catch (err) {
      console.error("❌ Failed to connect to MongoDB on startup:", err.message);
    }

     // Start periodic background tasks for expired group bookings
     const { checkExpiredGroupBookings } = require("./utils/bookingCleanup");
     setInterval(() => checkExpiredGroupBookings(), 60 * 1000);
     console.log(`[CLEANUP] Periodic 1-hour booking expiration scheduler started (interval: 60s)`);
  });
} else {
  console.log(`[INFO] Server is in ${process.env.NODE_ENV} mode. Internal listen skipped (expected for serverless/vercel).`);
  console.log(`[INFO] If you want to run this locally, set NODE_ENV=development or RUN_SERVER=true in your .env file.`);
}

// Vercel serverless functions require exporting the Express app, not the HTTP server.
module.exports = app;
