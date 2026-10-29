/**
 * Database Migration Script: Entity Cleanup & Reorganization
 *
 * Migrations performed:
 * 1. Collection rename: 'schedules' -> 'groupbookings'
 * 2. Collection rename: 'guestschedules' -> 'wishlistschedules'
 * 3. User.friends array -> 'friendships' collection (bidirectional, unique indexed)
 * 4. User.friendRequests array -> 'friendrequests' collection (unique indexed)
 * 5. User.savedPosts array -> 'savedposts' collection (unique indexed)
 * 6. User.pinnedExperienceMedia array -> 'hostpinnedexperiencemedias' collection
 * 7. Unset dead fields from 'users' collection:
 *    otp, otpExpires, activeGridTab, pinnedExperienceMedia, friends, friendRequests, savedPosts
 *
 * Run with: node scripts/migrations/migrate_entities_cleanup.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
    console.error("❌ ERROR: MONGO_URL is not defined in environment variables!");
    process.exit(1);
}

async function runMigration() {
    console.log("🚀 Starting Entity Cleanup Migration...");
    await mongoose.connect(MONGO_URL, {
        bufferCommands: true,
        serverSelectionTimeoutMS: 15000
    });
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // 1. Rename 'schedules' -> 'groupbookings'
    try {
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name.toLowerCase());

        if (colNames.includes("schedules")) {
            if (!colNames.includes("groupbookings")) {
                console.log("📦 Renaming collection 'schedules' to 'groupbookings'...");
                await db.collection("schedules").rename("groupbookings");
                console.log("✅ Successfully renamed 'schedules' -> 'groupbookings'");
            } else {
                console.log("ℹ️ Both 'schedules' and 'groupbookings' exist. Copying missing records...");
                const legacyDocs = await db.collection("schedules").find({}).toArray();
                let copied = 0;
                for (const doc of legacyDocs) {
                    const exists = await db.collection("groupbookings").findOne({ _id: doc._id });
                    if (!exists) {
                        await db.collection("groupbookings").insertOne(doc);
                        copied++;
                    }
                }
                console.log(`✅ Copied ${copied} records from 'schedules' to 'groupbookings'`);
            }
        } else {
            console.log("ℹ️ Collection 'schedules' does not exist (already migrated or empty)");
        }
    } catch (err) {
        console.error("⚠️ Error migrating schedules collection:", err.message);
    }

    // 2. Rename 'guestschedules' -> 'wishlistschedules'
    try {
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name.toLowerCase());

        if (colNames.includes("guestschedules")) {
            if (!colNames.includes("wishlistschedules")) {
                console.log("📦 Renaming collection 'guestschedules' to 'wishlistschedules'...");
                await db.collection("guestschedules").rename("wishlistschedules");
                console.log("✅ Successfully renamed 'guestschedules' -> 'wishlistschedules'");
            } else {
                console.log("ℹ️ Both 'guestschedules' and 'wishlistschedules' exist. Copying missing records...");
                const legacyDocs = await db.collection("guestschedules").find({}).toArray();
                let copied = 0;
                for (const doc of legacyDocs) {
                    const exists = await db.collection("wishlistschedules").findOne({ _id: doc._id });
                    if (!exists) {
                        await db.collection("wishlistschedules").insertOne(doc);
                        copied++;
                    }
                }
                console.log(`✅ Copied ${copied} records from 'guestschedules' to 'wishlistschedules'`);
            }
        } else {
            console.log("ℹ️ Collection 'guestschedules' does not exist (already migrated or empty)");
        }
    } catch (err) {
        console.error("⚠️ Error migrating guestschedules collection:", err.message);
    }

    // 3. Migrate User.friends -> friendships collection
    try {
        console.log("👥 Migrating user friends arrays to 'friendships' collection...");
        const usersWithFriends = await db.collection("users").find({
            friends: { $exists: true, $not: { $size: 0 } }
        }).toArray();

        let friendshipCount = 0;
        const friendshipsCol = db.collection("friendships");

        // Ensure unique compound index
        await friendshipsCol.createIndex({ user: 1, friend: 1 }, { unique: true });
        await friendshipsCol.createIndex({ user: 1, createdAt: -1 });

        for (const user of usersWithFriends) {
            const userId = user._id;
            for (const friendId of (user.friends || [])) {
                if (!friendId) continue;
                try {
                    await friendshipsCol.updateOne(
                        { user: userId, friend: friendId },
                        {
                            $setOnInsert: {
                                user: userId,
                                friend: friendId,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    await friendshipsCol.updateOne(
                        { user: friendId, friend: userId },
                        {
                            $setOnInsert: {
                                user: friendId,
                                friend: userId,
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    friendshipCount += 2;
                } catch (dupErr) {
                    // Ignore duplicate key errors on upsert
                }
            }
        }
        console.log(`✅ Migrated friendships from ${usersWithFriends.length} users (total ${friendshipCount} entries processed)`);
    } catch (err) {
        console.error("⚠️ Error migrating friendships:", err.message);
    }

    // 4. Migrate User.friendRequests -> friendrequests collection
    try {
        console.log("📩 Migrating user friendRequests arrays to 'friendrequests' collection...");
        const usersWithRequests = await db.collection("users").find({
            friendRequests: { $exists: true, $not: { $size: 0 } }
        }).toArray();

        let reqCount = 0;
        const friendRequestsCol = db.collection("friendrequests");

        await friendRequestsCol.createIndex({ sender: 1, recipient: 1 }, { unique: true });
        await friendRequestsCol.createIndex({ recipient: 1, status: 1, createdAt: -1 });

        for (const user of usersWithRequests) {
            const recipientId = user._id;
            for (const senderId of (user.friendRequests || [])) {
                if (!senderId) continue;
                try {
                    await friendRequestsCol.updateOne(
                        { sender: senderId, recipient: recipientId },
                        {
                            $setOnInsert: {
                                sender: senderId,
                                recipient: recipientId,
                                status: "pending",
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    reqCount++;
                } catch (dupErr) {
                    // Ignore duplicate
                }
            }
        }
        console.log(`✅ Migrated friendRequests from ${usersWithRequests.length} users (${reqCount} requests created)`);
    } catch (err) {
        console.error("⚠️ Error migrating friendRequests:", err.message);
    }

    // 5. Migrate User.savedPosts -> savedposts collection
    try {
        console.log("🔖 Migrating user savedPosts arrays to 'savedposts' collection...");
        const usersWithSaved = await db.collection("users").find({
            savedPosts: { $exists: true, $not: { $size: 0 } }
        }).toArray();

        let savedCount = 0;
        const savedPostsCol = db.collection("savedposts");

        await savedPostsCol.createIndex({ user: 1, post: 1 }, { unique: true });
        await savedPostsCol.createIndex({ user: 1, createdAt: -1 });

        for (const user of usersWithSaved) {
            const userId = user._id;
            for (const postId of (user.savedPosts || [])) {
                if (!postId) continue;
                try {
                    await savedPostsCol.updateOne(
                        { user: userId, post: postId },
                        {
                            $setOnInsert: {
                                user: userId,
                                post: postId,
                                postType: "experience",
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    savedCount++;
                } catch (dupErr) {
                    // Ignore duplicate
                }
            }
        }
        console.log(`✅ Migrated savedPosts from ${usersWithSaved.length} users (${savedCount} saved post bookmarks created)`);
    } catch (err) {
        console.error("⚠️ Error migrating savedPosts:", err.message);
    }

    // 6. Migrate User.pinnedExperienceMedia -> hostpinnedexperiencemedias collection
    try {
        console.log("📌 Migrating user pinnedExperienceMedia arrays to 'hostpinnedexperiencemedias' collection...");
        const usersWithPinned = await db.collection("users").find({
            pinnedExperienceMedia: { $exists: true, $not: { $size: 0 } }
        }).toArray();

        let pinCount = 0;
        const pinnedCol = db.collection("hostpinnedexperiencemedias");

        await pinnedCol.createIndex({ user: 1, mediaKey: 1 }, { unique: true });
        await pinnedCol.createIndex({ user: 1, pinnedAt: -1 });

        for (const user of usersWithPinned) {
            const userId = user._id;
            for (const key of (user.pinnedExperienceMedia || [])) {
                if (!key) continue;
                try {
                    await pinnedCol.updateOne(
                        { user: userId, mediaKey: key },
                        {
                            $setOnInsert: {
                                user: userId,
                                mediaKey: key,
                                pinnedAt: new Date(),
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    pinCount++;
                } catch (dupErr) {
                    // Ignore duplicate
                }
            }
        }
        console.log(`✅ Migrated pinnedExperienceMedia from ${usersWithPinned.length} hosts (${pinCount} pins created)`);
    } catch (err) {
        console.error("⚠️ Error migrating pinnedExperienceMedia:", err.message);
    }

    // 7. Unset dead fields from 'users' collection
    try {
        console.log("🧹 Unsetting bloated fields (otp, otpExpires, activeGridTab, pinnedExperienceMedia, friends, friendRequests, savedPosts) from users collection...");
        const unsetResult = await db.collection("users").updateMany(
            {},
            {
                $unset: {
                    otp: "",
                    otpExpires: "",
                    activeGridTab: "",
                    pinnedExperienceMedia: "",
                    friends: "",
                    friendRequests: "",
                    savedPosts: ""
                }
            }
        );
        console.log(`✅ Successfully cleaned up ${unsetResult.modifiedCount} user documents`);
    } catch (err) {
        console.error("⚠️ Error unsetting fields on users collection:", err.message);
    }

    // 8. Migrate Host Details from 'users' -> 'hostdetails' collection
    try {
        console.log("🏨 Migrating host details from 'users' to 'hostdetails' collection...");
        const hostDetailsCol = db.collection("hostdetails");
        await hostDetailsCol.createIndex({ user: 1 }, { unique: true });
        await hostDetailsCol.createIndex({ status: 1 });
        await hostDetailsCol.createIndex({ "verifyBadge.enabled": 1 });

        const hosts = await db.collection("users").find({
            $or: [
                { role: "host" },
                { hostDetails: { $exists: true, $ne: null } },
                { hostStatus: { $exists: true, $ne: null } }
            ]
        }).toArray();

        let hostCount = 0;
        for (const user of hosts) {
            const h = user.hostDetails || {};
            await hostDetailsCol.updateOne(
                { user: user._id },
                {
                    $setOnInsert: {
                        user: user._id,
                        status: user.hostStatus || "pending_verification",
                        yearsOfExperience: h.yearsOfExperience || 0,
                        phone: h.phone || "",
                        phoneVerified: h.phoneVerified || false,
                        tempVerifiedPhone: h.tempVerifiedPhone || null,
                        physicalAddress: h.physicalAddress || "",
                        pincode: h.pincode || "",
                        city: h.city || "",
                        district: h.district || "",
                        state: h.state || "",
                        aadhaarCard: h.aadhaarCard || [],
                        pendingHostDetails: user.pendingHostDetails || null,
                        verifyBadge: user.verifyBadge || {
                            enabled: false,
                            requiredBookings: 1,
                            successfulBookingsCount: 0
                        },
                        createdAt: user.createdAt || new Date(),
                        updatedAt: user.updatedAt || new Date()
                    }
                },
                { upsert: true }
            );
            hostCount++;
        }
        console.log(`✅ Migrated host details for ${hostCount} hosts to 'hostdetails' collection`);

        // Unset host fields from users
        const unsetHostResult = await db.collection("users").updateMany(
            {},
            {
                $unset: {
                    hostStatus: "",
                    hostDetails: "",
                    pendingHostDetails: "",
                    verifyBadge: ""
                }
            }
        );
        console.log(`✅ Unset hostStatus, hostDetails, pendingHostDetails, verifyBadge from ${unsetHostResult.modifiedCount} user documents`);
    } catch (err) {
        console.error("⚠️ Error migrating host details:", err.message);
    }

    // 9. Rename 'hosthistories' -> 'hostauditlogs'
    try {
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name.toLowerCase());

        if (colNames.includes("hosthistories")) {
            if (!colNames.includes("hostauditlogs")) {
                console.log("📦 Renaming collection 'hosthistories' to 'hostauditlogs'...");
                await db.collection("hosthistories").rename("hostauditlogs");
                console.log("✅ Successfully renamed 'hosthistories' -> 'hostauditlogs'");
            } else {
                console.log("ℹ️ Both 'hosthistories' and 'hostauditlogs' exist. Copying missing records...");
                const legacyDocs = await db.collection("hosthistories").find({}).toArray();
                let copied = 0;
                for (const doc of legacyDocs) {
                    const exists = await db.collection("hostauditlogs").findOne({ _id: doc._id });
                    if (!exists) {
                        await db.collection("hostauditlogs").insertOne(doc);
                        copied++;
                    }
                }
                console.log(`✅ Copied ${copied} records from 'hosthistories' to 'hostauditlogs'`);
            }
        } else {
            console.log("ℹ️ Collection 'hosthistories' does not exist (already migrated or empty)");
        }
    } catch (err) {
        console.error("⚠️ Error migrating hosthistories collection:", err.message);
    }

    console.log("🎉 Entity Cleanup Migration Complete!");
    await mongoose.disconnect();
    process.exit(0);
}

runMigration().catch((err) => {
    console.error("❌ Migration failed with fatal error:", err);
    process.exit(1);
});
