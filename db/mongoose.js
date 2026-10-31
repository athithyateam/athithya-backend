const mongoose = require("mongoose");
const User = require("../models/User");
const OTP = require("../models/OTP");
const Experience = require("../models/Experience");
const Review = require("../models/Review");
const Notification = require("../models/Notification");
const Booking = require("../models/Booking");
const GroupBooking = require("../models/GroupBooking");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const HostDetails = require("../models/HostDetails");
const HostAuditLog = require("../models/HostAuditLog");
const HostPersonalMedia = require("../models/HostPersonalMedia");
const HostPinnedExperienceMedia = require("../models/HostPinnedExperienceMedia");
const WishlistSchedule = require("../models/WishlistSchedule");
const Friendship = require("../models/Friendship");
const FriendRequest = require("../models/FriendRequest");
const SavedExperience = require("../models/SavedExperience");

if (!process.env.MONGO_URL) {
    try {
        const path = require("path");
        require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
    } catch (_) {}
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development and serverless function invocations in production.
 * This prevents creating multiple connections.
 */
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
    if (cached.conn) {
        return cached.conn;
    }

    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) {
        console.error("❌ Cannot connect: MONGO_URL is missing in environment variables!");
        throw new Error("MONGO_URL environment variable is required to connect to database");
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: true,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        };

        cached.promise = mongoose.connect(mongoUrl, opts).then(async (mongooseInstance) => {
            console.log("✅ Connected to MongoDB");
            try {
                await Experience.updateMany({ clicks: { $exists: false } }, { $set: { clicks: 0 } });
            } catch (err) {
                console.error("Clicks migration error:", err);
            }
            try {
                const legacyExperiences = await Experience.find({
                    categories: { $in: ["Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding", "Rock climbing", "Fly boarding"] }
                });
                if (legacyExperiences.length > 0) {
                    for (const exp of legacyExperiences) {
                        let changed = false;
                        const newCategories = [];
                        for (const cat of (exp.categories || [])) {
                            const lc = String(cat).trim().toLowerCase();
                            if (lc === "rock climbing" || lc === "flyboarding" || lc === "rock-climbing" || lc === "fly boarding") {
                                if (!newCategories.includes("Others")) {
                                    newCategories.push("Others");
                                }
                                changed = true;
                            } else if (!newCategories.includes(cat)) {
                                newCategories.push(cat);
                            }
                        }
                        if (changed) {
                            await Experience.updateOne(
                                { _id: exp._id },
                                { $set: { categories: newCategories } }
                            );
                        }
                    }
                    console.log(`[MIGRATION] Successfully migrated ${legacyExperiences.length} experiences to "Others" category`);
                }
            } catch (err) {
                console.error("Category migration error:", err.message);
            }
            return mongooseInstance;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        
        console.error("\n" + "=".repeat(50));
        console.error("❌ MONGODB CONNECTION ERROR");
        console.error("Error Message:", e.message);
        
        if (e.code === 'ECONNREFUSED' || e.message.includes('querySrv')) {
            console.error("\n💡 TROUBLESHOOTING TIP:");
            console.error("This usually happens for one of two reasons:");
            console.error("1. IP WHITELISTING: Your current IP address is not allowed to access this database.");
            console.error("   Fix: Go to MongoDB Atlas -> Network Access -> Add '0.0.0.0/0' to allow access from anywhere.");
            console.error("2. DNS ISSUES: Your network might be blocking MongoDB SRV records.");
            console.error("   Fix: Try using a different network (like a mobile hotspot) or check your DNS settings.");
        }
        console.error("=".repeat(50) + "\n");
        
        throw e;
    }

    return cached.conn;
}

module.exports = {
    connectDB,
    User,
    OTP,
    Experience,
    Review,
    Notification,
    Booking,
    GroupBooking,
    Conversation,
    Message,
    HostDetails,
    HostAuditLog,
    HostPersonalMedia,
    HostPinnedExperienceMedia,
    WishlistSchedule,
    Friendship,
    FriendRequest,
    SavedExperience
};