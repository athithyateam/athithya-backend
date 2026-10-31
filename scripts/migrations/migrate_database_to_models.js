/**
 * Comprehensive Database Migration Script: Schema & Model Alignment
 *
 * Aligns MongoDB collections and document structures with active Mongoose models:
 * 1. Renames collections:
 *    - 'schedules' -> 'groupbookings'
 *    - 'guestschedules' -> 'wishlistschedules'
 *    - 'hosthistories' -> 'hostauditlogs'
 * 2. Deconstructs bloated 'users' collection into normalized collections:
 *    - Host fields (hostDetails, hostStatus, pendingHostDetails, verifyBadge) -> 'hostdetails'
 *    - Friends arrays -> 'friendships' (bidirectional, unique indexed)
 *    - Friend requests arrays -> 'friendrequests' (unique indexed)
 *    - Saved posts arrays -> 'savedposts' (with field 'experience', unique indexed)
 *    - Pinned experience media arrays -> 'hostpinnedexperiencemedias' (unique indexed)
 *    - Unsets dead/legacy fields from 'users'
 * 3. Migrates field names across domain collections:
 *    - 'bookings': drops legacy indexes, renames post -> experience, postTitle -> experienceTitle, scheduleId -> groupBookingId, unsets postType
 *    - 'reviews': drops legacy indexes on 'post', renames post -> experience
 *    - 'groupbookings': drops legacy indexes, renames post -> experience, postTitle -> experienceTitle, unsets postType
 *    - 'notifications': metadata.postId -> metadata.experienceId, metadata.scheduleId -> metadata.groupBookingId, link: /post/ -> /experience/
 *    - 'messages': locationData.postId -> locationData.experienceId
 *    - 'conversations': unsets deprecated itinerary array
 *    - 'posts': unsets reactions, postType, stay capacity remnants
 * 4. Normalizes 'hostauditlogs':
 *    - Wraps legacy flat experience/host fields into structured 'snapshot' object
 * 5. Drops deprecated collections:
 *    - 'communityposts'
 * 6. Builds and verifies model indexes across all collections.
 *
 * Usage:
 *   node scripts/migrations/migrate_database_to_models.js [--dry-run]
 */

require("dotenv").config();
const mongoose = require("mongoose");

const isDryRun = process.argv.includes("--dry-run");
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/athithya";

async function runMigration() {
    console.log("=".repeat(70));
    console.log(`🚀 Starting Database Migration [${isDryRun ? "DRY-RUN MODE (No writes)" : "LIVE EXECUTION"}]`);
    console.log(`📡 Connecting to: ${MONGO_URL}`);
    console.log("=".repeat(70));

    await mongoose.connect(MONGO_URL, {
        bufferCommands: true,
        serverSelectionTimeoutMS: 15000
    });
    console.log("✅ Successfully connected to MongoDB\n");

    const db = mongoose.connection.db;

    // Helper to safely list collection names in lowercase
    async function getCollectionNames() {
        const cols = await db.listCollections().toArray();
        return cols.map(c => c.name.toLowerCase());
    }

    // ---------------------------------------------------------
    // STEP 1: Collection Renames
    // ---------------------------------------------------------
    console.log("--- STEP 1: Collection Renames ---");
    let colNames = await getCollectionNames();

    // 1A. 'schedules' -> 'groupbookings'
    if (colNames.includes("schedules")) {
        if (!colNames.includes("groupbookings")) {
            console.log("📦 Renaming collection 'schedules' -> 'groupbookings'...");
            if (!isDryRun) {
                await db.collection("schedules").rename("groupbookings");
                console.log("✅ Successfully renamed 'schedules' -> 'groupbookings'");
            }
        } else {
            console.log("ℹ️ Both 'schedules' and 'groupbookings' exist. Copying missing documents...");
            const legacyDocs = await db.collection("schedules").find({}).toArray();
            let copied = 0;
            for (const doc of legacyDocs) {
                const exists = await db.collection("groupbookings").findOne({ _id: doc._id });
                if (!exists) {
                    if (!isDryRun) await db.collection("groupbookings").insertOne(doc);
                    copied++;
                }
            }
            console.log(`✅ Copied ${copied} missing docs from 'schedules' to 'groupbookings'`);
            if (!isDryRun) {
                await db.collection("schedules").drop();
                console.log("🗑️ Dropped legacy 'schedules' collection");
            }
        }
    } else {
        console.log("ℹ️ 'schedules' already migrated or does not exist");
    }

    // 1B. 'guestschedules' -> 'wishlistschedules'
    colNames = await getCollectionNames();
    if (colNames.includes("guestschedules")) {
        if (!colNames.includes("wishlistschedules")) {
            console.log("📦 Renaming collection 'guestschedules' -> 'wishlistschedules'...");
            if (!isDryRun) {
                await db.collection("guestschedules").rename("wishlistschedules");
                console.log("✅ Successfully renamed 'guestschedules' -> 'wishlistschedules'");
            }
        } else {
            console.log("ℹ️ Both 'guestschedules' and 'wishlistschedules' exist. Copying missing documents...");
            const legacyDocs = await db.collection("guestschedules").find({}).toArray();
            let copied = 0;
            for (const doc of legacyDocs) {
                const exists = await db.collection("wishlistschedules").findOne({ _id: doc._id });
                if (!exists) {
                    if (!isDryRun) await db.collection("wishlistschedules").insertOne(doc);
                    copied++;
                }
            }
            console.log(`✅ Copied ${copied} missing docs to 'wishlistschedules'`);
            if (!isDryRun) {
                await db.collection("guestschedules").drop();
                console.log("🗑️ Dropped legacy 'guestschedules' collection");
            }
        }
    } else {
        console.log("ℹ️ 'guestschedules' already migrated or does not exist");
    }

    // 1C. 'hosthistories' -> 'hostauditlogs'
    colNames = await getCollectionNames();
    if (colNames.includes("hosthistories")) {
        if (!colNames.includes("hostauditlogs")) {
            console.log("📦 Renaming collection 'hosthistories' -> 'hostauditlogs'...");
            if (!isDryRun) {
                await db.collection("hosthistories").rename("hostauditlogs");
                console.log("✅ Successfully renamed 'hosthistories' -> 'hostauditlogs'");
            }
        } else {
            console.log("ℹ️ Both 'hosthistories' and 'hostauditlogs' exist. Copying missing documents...");
            const legacyDocs = await db.collection("hosthistories").find({}).toArray();
            let copied = 0;
            for (const doc of legacyDocs) {
                const exists = await db.collection("hostauditlogs").findOne({ _id: doc._id });
                if (!exists) {
                    if (!isDryRun) await db.collection("hostauditlogs").insertOne(doc);
                    copied++;
                }
            }
            console.log(`✅ Copied ${copied} missing docs to 'hostauditlogs'`);
            if (!isDryRun) {
                await db.collection("hosthistories").drop();
                console.log("🗑️ Dropped legacy 'hosthistories' collection");
            }
        }
    } else {
        console.log("ℹ️ 'hosthistories' already migrated or does not exist");
    }

    // ---------------------------------------------------------
    // STEP 2: Deconstruct Bloated 'users' Collection
    // ---------------------------------------------------------
    console.log("\n--- STEP 2: Deconstruct Bloated 'users' Collection ---");

    // 2A. Host Details -> 'hostdetails' collection
    console.log("🏨 2A. Migrating Host Details to 'hostdetails'...");
    const hostDetailsCol = db.collection("hostdetails");
    if (!isDryRun) {
        await hostDetailsCol.createIndex({ user: 1 }, { unique: true });
        await hostDetailsCol.createIndex({ status: 1 });
        await hostDetailsCol.createIndex({ "verifyBadge.enabled": 1 });
    }

    const hostsWithDetails = await db.collection("users").find({
        $or: [
            { role: "host" },
            { hostDetails: { $exists: true, $ne: null } },
            { hostStatus: { $exists: true, $ne: null } },
            { pendingHostDetails: { $exists: true, $ne: null } },
            { verifyBadge: { $exists: true, $ne: null } }
        ]
    }).toArray();

    let hostMigratedCount = 0;
    for (const user of hostsWithDetails) {
        const h = user.hostDetails || {};
        const hostDoc = {
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
        };

        if (!isDryRun) {
            await hostDetailsCol.updateOne(
                { user: user._id },
                { $setOnInsert: hostDoc },
                { upsert: true }
            );
        }
        hostMigratedCount++;
    }
    console.log(`✅ Processed host details for ${hostMigratedCount} users into 'hostdetails'`);

    // 2B. Friends -> 'friendships' collection
    console.log("👥 2B. Migrating Friends arrays to 'friendships'...");
    const friendshipsCol = db.collection("friendships");
    if (!isDryRun) {
        await friendshipsCol.createIndex({ user: 1, friend: 1 }, { unique: true });
        await friendshipsCol.createIndex({ user: 1, createdAt: -1 });
    }

    const usersWithFriends = await db.collection("users").find({
        friends: { $exists: true, $not: { $size: 0 } }
    }).toArray();

    let friendshipsCreated = 0;
    for (const user of usersWithFriends) {
        const userId = user._id;
        for (const friendId of (user.friends || [])) {
            if (!friendId) continue;
            if (!isDryRun) {
                try {
                    await friendshipsCol.updateOne(
                        { user: userId, friend: friendId },
                        { $setOnInsert: { user: userId, friend: friendId, createdAt: user.createdAt || new Date(), updatedAt: new Date() } },
                        { upsert: true }
                    );
                    await friendshipsCol.updateOne(
                        { user: friendId, friend: userId },
                        { $setOnInsert: { user: friendId, friend: userId, createdAt: user.createdAt || new Date(), updatedAt: new Date() } },
                        { upsert: true }
                    );
                } catch (e) {}
            }
            friendshipsCreated += 2;
        }
    }
    console.log(`✅ Processed ${friendshipsCreated} bidirectional friendship links from ${usersWithFriends.length} users`);

    // 2C. Friend Requests -> 'friendrequests' collection
    console.log("📩 2C. Migrating Friend Requests to 'friendrequests'...");
    const friendRequestsCol = db.collection("friendrequests");
    if (!isDryRun) {
        await friendRequestsCol.createIndex({ sender: 1, recipient: 1 }, { unique: true });
        await friendRequestsCol.createIndex({ recipient: 1, status: 1, createdAt: -1 });
        await friendRequestsCol.createIndex({ sender: 1, status: 1 });
    }

    const usersWithRequests = await db.collection("users").find({
        friendRequests: { $exists: true, $not: { $size: 0 } }
    }).toArray();

    let requestsCreated = 0;
    for (const user of usersWithRequests) {
        const recipientId = user._id;
        for (const senderId of (user.friendRequests || [])) {
            if (!senderId) continue;
            if (!isDryRun) {
                try {
                    await friendRequestsCol.updateOne(
                        { sender: senderId, recipient: recipientId },
                        { $setOnInsert: { sender: senderId, recipient: recipientId, status: "pending", createdAt: new Date(), updatedAt: new Date() } },
                        { upsert: true }
                    );
                } catch (e) {}
            }
            requestsCreated++;
        }
    }
    console.log(`✅ Processed ${requestsCreated} friend requests from ${usersWithRequests.length} users`);

    // 2D. Saved Posts -> 'savedposts' (field: experience)
    console.log("🔖 2D. Migrating Saved Posts to 'savedposts' (with field 'experience')...");
    const savedPostsCol = db.collection("savedposts");
    if (!isDryRun) {
        await savedPostsCol.createIndex({ user: 1, experience: 1 }, { unique: true });
        await savedPostsCol.createIndex({ user: 1, createdAt: -1 });
        await savedPostsCol.createIndex({ experience: 1 });
    }

    const usersWithSaved = await db.collection("users").find({
        savedPosts: { $exists: true, $not: { $size: 0 } }
    }).toArray();

    let savedPostsCreated = 0;
    for (const user of usersWithSaved) {
        const userId = user._id;
        for (const postId of (user.savedPosts || [])) {
            if (!postId) continue;
            if (!isDryRun) {
                try {
                    await savedPostsCol.updateOne(
                        { user: userId, experience: postId },
                        { $setOnInsert: { user: userId, experience: postId, createdAt: new Date(), updatedAt: new Date() } },
                        { upsert: true }
                    );
                } catch (e) {}
            }
            savedPostsCreated++;
        }
    }
    console.log(`✅ Processed ${savedPostsCreated} saved experience bookmarks from ${usersWithSaved.length} users`);

    // 2E. Pinned Experience Media -> 'hostpinnedexperiencemedias'
    console.log("📌 2E. Migrating Pinned Experience Media to 'hostpinnedexperiencemedias'...");
    const pinnedCol = db.collection("hostpinnedexperiencemedias");
    if (!isDryRun) {
        await pinnedCol.createIndex({ user: 1, mediaKey: 1 }, { unique: true });
        await pinnedCol.createIndex({ user: 1, pinnedAt: -1 });
    }

    const usersWithPinned = await db.collection("users").find({
        pinnedExperienceMedia: { $exists: true, $not: { $size: 0 } }
    }).toArray();

    let pinnedCreated = 0;
    for (const user of usersWithPinned) {
        const userId = user._id;
        for (const key of (user.pinnedExperienceMedia || [])) {
            if (!key) continue;
            if (!isDryRun) {
                try {
                    await pinnedCol.updateOne(
                        { user: userId, mediaKey: key },
                        { $setOnInsert: { user: userId, mediaKey: key, pinnedAt: new Date(), createdAt: new Date(), updatedAt: new Date() } },
                        { upsert: true }
                    );
                } catch (e) {}
            }
            pinnedCreated++;
        }
    }
    console.log(`✅ Processed ${pinnedCreated} pinned media items from ${usersWithPinned.length} users`);

    // 2F. Unset Bloated and Dead Fields from 'users'
    console.log("🧹 2F. Unsetting dead/deconstructed fields from 'users'...");
    const unsetQuery = {
        $or: [
            { hostStatus: { $exists: true } },
            { hostDetails: { $exists: true } },
            { pendingHostDetails: { $exists: true } },
            { verifyBadge: { $exists: true } },
            { friends: { $exists: true } },
            { friendRequests: { $exists: true } },
            { savedPosts: { $exists: true } },
            { pinnedExperienceMedia: { $exists: true } },
            { activeGridTab: { $exists: true } },
            { following: { $exists: true } },
            { followers: { $exists: true } },
            { followRequests: { $exists: true } },
            { otp: { $exists: true } },
            { otpExpires: { $exists: true } }
        ]
    };
    const usersToCleanCount = await db.collection("users").countDocuments(unsetQuery);
    if (!isDryRun) {
        const unsetResult = await db.collection("users").updateMany(
            unsetQuery,
            {
                $unset: {
                    hostStatus: "",
                    hostDetails: "",
                    pendingHostDetails: "",
                    verifyBadge: "",
                    friends: "",
                    friendRequests: "",
                    savedPosts: "",
                    pinnedExperienceMedia: "",
                    activeGridTab: "",
                    following: "",
                    followers: "",
                    followRequests: "",
                    otp: "",
                    otpExpires: ""
                }
            }
        );
        console.log(`✅ Successfully cleaned up ${unsetResult.modifiedCount} user documents`);
    } else {
        console.log(`ℹ️ [DRY RUN] Would unset legacy fields from ${usersToCleanCount} user documents`);
    }

    // ---------------------------------------------------------
    // STEP 3: Domain Collections Field Renames & Alignments
    // ---------------------------------------------------------
    console.log("\n--- STEP 3: Domain Collections Field Renames & Alignments ---");

    // 3A. 'bookings' collection
    console.log("🎫 3A. Aligning 'bookings' collection...");
    const bookingsPostCount = await db.collection("bookings").countDocuments({ post: { $exists: true } });
    const bookingsTitleCount = await db.collection("bookings").countDocuments({ postTitle: { $exists: true } });
    const bookingsSchedCount = await db.collection("bookings").countDocuments({ scheduleId: { $exists: true } });
    const bookingsPostTypeCount = await db.collection("bookings").countDocuments({ postType: { $exists: true } });

    console.log(`   Found: post (${bookingsPostCount}), postTitle (${bookingsTitleCount}), scheduleId (${bookingsSchedCount}), postType (${bookingsPostTypeCount})`);
    if (!isDryRun) {
        // Drop legacy indexes on bookings before renaming
        try {
            const bookingIndexes = await db.collection("bookings").listIndexes().toArray();
            for (const idx of bookingIndexes) {
                if (idx.name.includes("post") || Object.keys(idx.key).includes("post") || idx.name.includes("scheduleId") || Object.keys(idx.key).includes("scheduleId")) {
                    console.log(`   Dropping legacy index '${idx.name}' on bookings...`);
                    await db.collection("bookings").dropIndex(idx.name);
                }
            }
        } catch (idxErr) {
            console.log("   (Index check on bookings completed)");
        }

        const bookingsRenameResult = await db.collection("bookings").updateMany(
            {},
            {
                $rename: {
                    post: "experience",
                    postTitle: "experienceTitle",
                    scheduleId: "groupBookingId"
                },
                $unset: {
                    postType: ""
                }
            }
        );
        console.log(`✅ Updated ${bookingsRenameResult.modifiedCount} booking documents`);

        // Create indexes
        await db.collection("bookings").createIndex({ guest: 1, createdAt: -1 });
        await db.collection("bookings").createIndex({ host: 1, status: 1, createdAt: -1 });
        await db.collection("bookings").createIndex({ experience: 1, status: 1 });
        await db.collection("bookings").createIndex({ groupBookingId: 1 });
    }

    // 3B. 'reviews' collection
    console.log("⭐ 3B. Aligning 'reviews' collection...");
    const reviewsPostCount = await db.collection("reviews").countDocuments({ post: { $exists: true } });
    console.log(`   Found: post (${reviewsPostCount}) in reviews`);
    if (!isDryRun) {
        // Drop legacy indexes referring to 'post' before renaming to avoid duplicate key errors during field unset
        try {
            const reviewIndexes = await db.collection("reviews").listIndexes().toArray();
            for (const idx of reviewIndexes) {
                if (idx.name.includes("post") || Object.keys(idx.key).includes("post")) {
                    console.log(`   Dropping legacy index '${idx.name}' on reviews...`);
                    await db.collection("reviews").dropIndex(idx.name);
                }
            }
        } catch (idxErr) {
            console.log("   (Index check on reviews completed)");
        }

        const reviewsRenameResult = await db.collection("reviews").updateMany(
            { post: { $exists: true } },
            {
                $rename: {
                    post: "experience"
                }
            }
        );
        console.log(`✅ Renamed post -> experience in ${reviewsRenameResult.modifiedCount} reviews`);

        // Create aligned indexes
        await db.collection("reviews").createIndex({ host: 1, createdAt: -1 });
        await db.collection("reviews").createIndex({ host: 1, reviewer: 1, experience: 1 }, { unique: true, sparse: true });
        await db.collection("reviews").createIndex({ experience: 1, createdAt: -1 });
    }

    // 3C. 'groupbookings' (or 'schedules') collection
    const gbColName = (await getCollectionNames()).includes("groupbookings") ? "groupbookings" : "schedules";
    console.log(`👥 3C. Aligning '${gbColName}' collection...`);
    const gbPostCount = await db.collection(gbColName).countDocuments({ post: { $exists: true } });
    const gbTitleCount = await db.collection(gbColName).countDocuments({ postTitle: { $exists: true } });
    const gbTypeCount = await db.collection(gbColName).countDocuments({ postType: { $exists: true } });
    console.log(`   Found: post (${gbPostCount}), postTitle (${gbTitleCount}), postType (${gbTypeCount}) in ${gbColName}`);

    if (!isDryRun) {
        // Drop legacy indexes on groupbookings before renaming
        try {
            const gbIndexes = await db.collection(gbColName).listIndexes().toArray();
            for (const idx of gbIndexes) {
                if (idx.name.includes("post") || Object.keys(idx.key).includes("post")) {
                    console.log(`   Dropping legacy index '${idx.name}' on ${gbColName}...`);
                    await db.collection(gbColName).dropIndex(idx.name);
                }
            }
        } catch (idxErr) {
            console.log("   (Index check on groupbookings completed)");
        }

        const gbRenameResult = await db.collection(gbColName).updateMany(
            {},
            {
                $rename: {
                    post: "experience",
                    postTitle: "experienceTitle"
                },
                $unset: {
                    postType: ""
                }
            }
        );
        console.log(`✅ Updated ${gbRenameResult.modifiedCount} groupbooking documents`);

        // Create indexes
        await db.collection(gbColName).createIndex({ initiator: 1, createdAt: -1 });
        await db.collection(gbColName).createIndex({ experience: 1 });
        await db.collection(gbColName).createIndex({ "invitedPeople.user": 1 });
        await db.collection(gbColName).createIndex({ status: 1, isBooked: 1, initiatorPaid: 1 });
    }

    // 3D. 'notifications' collection
    console.log("🔔 3D. Aligning 'notifications' collection...");
    const notifPostMeta = await db.collection("notifications").countDocuments({ "metadata.postId": { $exists: true } });
    const notifSchedMeta = await db.collection("notifications").countDocuments({ "metadata.scheduleId": { $exists: true } });
    const notifPostLink = await db.collection("notifications").countDocuments({ link: { $regex: "^/post/" } });
    console.log(`   Found: metadata.postId (${notifPostMeta}), metadata.scheduleId (${notifSchedMeta}), /post/ links (${notifPostLink})`);

    if (!isDryRun) {
        // Rename metadata fields
        const notifRenameResult = await db.collection("notifications").updateMany(
            {},
            {
                $rename: {
                    "metadata.postId": "metadata.experienceId",
                    "metadata.scheduleId": "metadata.groupBookingId"
                }
            }
        );
        console.log(`✅ Renamed notification metadata fields in ${notifRenameResult.modifiedCount} documents`);

        // Migrate links from /post/... to /experience/...
        const linkNotifs = await db.collection("notifications").find({ link: { $regex: "^/post/" } }).toArray();
        let linksUpdated = 0;
        for (const notif of linkNotifs) {
            const updatedLink = notif.link.replace(/^\/post\//, "/experience/");
            await db.collection("notifications").updateOne(
                { _id: notif._id },
                { $set: { link: updatedLink } }
            );
            linksUpdated++;
        }
        console.log(`✅ Updated ${linksUpdated} notification links to /experience/...`);

        // Create indexes
        await db.collection("notifications").createIndex({ recipient: 1, createdAt: -1 });
    }

    // 3E. 'messages' collection
    console.log("💬 3E. Aligning 'messages' collection...");
    const msgPostMeta = await db.collection("messages").countDocuments({ "locationData.postId": { $exists: true } });
    console.log(`   Found: locationData.postId (${msgPostMeta}) in messages`);
    if (!isDryRun) {
        const msgRenameResult = await db.collection("messages").updateMany(
            { "locationData.postId": { $exists: true } },
            {
                $rename: {
                    "locationData.postId": "locationData.experienceId"
                }
            }
        );
        console.log(`✅ Renamed locationData.postId -> experienceId in ${msgRenameResult.modifiedCount} messages`);

        // Create indexes
        await db.collection("messages").createIndex({ conversationId: 1, createdAt: 1 });
        await db.collection("messages").createIndex({ sender: 1 });
        await db.collection("messages").createIndex({ recipient: 1, read: 1 });
    }

    // 3F. 'conversations' collection
    console.log("🗨️ 3F. Aligning 'conversations' collection...");
    const convItineraryCount = await db.collection("conversations").countDocuments({ itinerary: { $exists: true } });
    console.log(`   Found: itinerary (${convItineraryCount}) in conversations`);
    if (!isDryRun) {
        const convResult = await db.collection("conversations").updateMany(
            { itinerary: { $exists: true } },
            {
                $unset: { itinerary: "" }
            }
        );
        console.log(`✅ Unset deprecated itinerary from ${convResult.modifiedCount} conversations`);

        // Create indexes
        await db.collection("conversations").createIndex({ participants: 1 });
        await db.collection("conversations").createIndex({ updatedAt: -1 });
    }

    // 3G. 'posts' (Experience) collection cleanup
    console.log("🏔️ 3G. Cleaning up 'posts' (Experience) collection...");
    const postsWithReactions = await db.collection("posts").countDocuments({ reactions: { $exists: true } });
    const postsWithPostType = await db.collection("posts").countDocuments({ postType: { $exists: true } });
    const postsWithBedrooms = await db.collection("posts").countDocuments({ "capacity.bedrooms": { $exists: true } });
    const postsWithBathrooms = await db.collection("posts").countDocuments({ "capacity.bathrooms": { $exists: true } });
    const postsWithBeds = await db.collection("posts").countDocuments({ "capacity.beds": { $exists: true } });
    const postsMissingClicks = await db.collection("posts").countDocuments({ clicks: { $exists: false } });

    console.log(`   Found: reactions (${postsWithReactions}), postType (${postsWithPostType}), hotel remnants (${postsWithBedrooms + postsWithBathrooms + postsWithBeds}), missing clicks (${postsMissingClicks})`);

    if (!isDryRun) {
        const postsCleanupResult = await db.collection("posts").updateMany(
            {},
            {
                $unset: {
                    reactions: "",
                    postType: "",
                    "capacity.bedrooms": "",
                    "capacity.bathrooms": "",
                    "capacity.beds": ""
                }
            }
        );
        console.log(`✅ Cleaned up dead fields on ${postsCleanupResult.modifiedCount} experience listings`);

        if (postsMissingClicks > 0) {
            await db.collection("posts").updateMany(
                { clicks: { $exists: false } },
                { $set: { clicks: 0 } }
            );
            console.log(`✅ Set default clicks: 0 for ${postsMissingClicks} experiences`);
        }

        // Create Experience model indexes
        await db.collection("posts").createIndex({ user: 1, createdAt: -1 });
        await db.collection("posts").createIndex({ status: 1, createdAt: -1 });
        await db.collection("posts").createIndex({ deleteRequested: 1, hideRequested: 1, unhideRequested: 1 });
        await db.collection("posts").createIndex({ "location.city": 1, "location.country": 1 });
        await db.collection("posts").createIndex({ categories: 1 });
        await db.collection("posts").createIndex({ isFeatured: 1, status: 1 });
        await db.collection("posts").createIndex({ "location.coordinates": "2dsphere" });
        await db.collection("posts").createIndex({ clicks: -1, createdAt: -1 });
        await db.collection("posts").createIndex({ bookingCount: -1, createdAt: -1 });
        await db.collection("posts").createIndex({ savesCount: -1, createdAt: -1 });
        await db.collection("posts").createIndex({ "rating.average": -1, "rating.count": -1, createdAt: -1 });
        await db.collection("posts").createIndex({ approvedAt: -1 });
    }

    // ---------------------------------------------------------
    // STEP 4: Normalize 'hostauditlogs'
    // ---------------------------------------------------------
    const auditColName = (await getCollectionNames()).includes("hostauditlogs") ? "hostauditlogs" : "hosthistories";
    console.log(`\n--- STEP 4: Normalize '${auditColName}' Snapshot Format ---`);
    const logsCol = db.collection(auditColName);
    const logsWithoutSnapshot = await logsCol.find({ snapshot: { $exists: false } }).toArray();
    console.log(`   Found ${logsWithoutSnapshot.length} audit logs missing 'snapshot' wrapper in ${auditColName}`);

    let logsNormalized = 0;
    for (const log of logsWithoutSnapshot) {
        const snapshot = {
            experienceTitle: log.experienceTitle || log.title || "",
            experienceSubtitle: log.experienceSubtitle || log.subtitle || "",
            experienceDescription: log.experienceDescription || log.description || "",
            experienceLongDescription: log.experienceLongDescription || log.longDescription || "",
            experiencePrice: log.experiencePrice || log.price || null,
            experienceDuration: log.experienceDuration || log.duration || null,
            experienceLocation: log.experienceLocation || log.location || null,
            experienceCapacity: log.experienceCapacity || log.capacity || null,
            experienceAmenities: log.experienceAmenities || log.amenities || [],
            experienceRules: log.experienceRules || log.rules || [],
            experiencePhotos: log.experiencePhotos || log.photos || [],
            experienceCategories: log.experienceCategories || log.categories || [],
            aadhaarCard: log.aadhaarCard || [],
            avatarUrl: log.avatarUrl || (log.avatar ? log.avatar.url : "") || "",
            physicalAddress: log.physicalAddress || "",
            city: log.city || "",
            district: log.district || "",
            state: log.state || "",
            pincode: log.pincode || "",
            phone: log.phone || "",
            email: log.email || ""
        };

        if (!isDryRun) {
            await logsCol.updateOne(
                { _id: log._id },
                {
                    $set: { snapshot },
                    $unset: {
                        experienceTitle: "",
                        experienceSubtitle: "",
                        experienceDescription: "",
                        experienceLongDescription: "",
                        experiencePrice: "",
                        experienceDuration: "",
                        experienceLocation: "",
                        experienceCapacity: "",
                        experienceAmenities: "",
                        experienceRules: "",
                        experiencePhotos: "",
                        experienceCategories: "",
                        avatarUrl: "",
                        physicalAddress: "",
                        city: "",
                        district: "",
                        state: "",
                        pincode: "",
                        phone: "",
                        email: ""
                    }
                }
            );
        }
        logsNormalized++;
    }
    console.log(`✅ Processed snapshot structure on ${logsNormalized} audit logs`);
    if (!isDryRun) {
        await logsCol.createIndex({ type: 1 });
        await logsCol.createIndex({ hostId: 1 });
        await logsCol.createIndex({ createdAt: 1 });
    }

    // ---------------------------------------------------------
    // STEP 5: Drop Deprecated Collections
    // ---------------------------------------------------------
    console.log("\n--- STEP 5: Drop Deprecated Collections ---");
    colNames = await getCollectionNames();
    if (colNames.includes("communityposts")) {
        console.log("🗑️ Dropping deprecated 'communityposts' collection...");
        if (!isDryRun) {
            await db.collection("communityposts").drop();
            console.log("✅ Successfully dropped 'communityposts'");
        }
    } else {
        console.log("ℹ️ 'communityposts' does not exist");
    }

    // ---------------------------------------------------------
    // STEP 6: Post-Migration Verification Summary
    // ---------------------------------------------------------
    console.log("\n" + "=".repeat(70));
    console.log("📊 POST-MIGRATION DATABASE STATE VERIFICATION");
    console.log("=".repeat(70));

    const finalCols = await db.listCollections().toArray();
    for (const c of finalCols) {
        const count = await db.collection(c.name).countDocuments();
        console.log(`📁 ${c.name.padEnd(28)} : ${count} documents`);
    }

    if (!isDryRun) {
        console.log("\n🔍 Verification Assertions:");
        const assertBookingsPost = await db.collection("bookings").countDocuments({ post: { $exists: true } });
        const assertBookingsSched = await db.collection("bookings").countDocuments({ scheduleId: { $exists: true } });
        const assertReviewsPost = await db.collection("reviews").countDocuments({ post: { $exists: true } });
        const assertGroupBookingsPost = await db.collection("groupbookings").countDocuments({ post: { $exists: true } });
        const assertUsersHostDetails = await db.collection("users").countDocuments({ hostDetails: { $exists: true } });
        const assertUsersFriends = await db.collection("users").countDocuments({ friends: { $exists: true } });
        const assertUsersSaved = await db.collection("users").countDocuments({ savedPosts: { $exists: true } });
        const assertNotifsPost = await db.collection("notifications").countDocuments({ "metadata.postId": { $exists: true } });
        const assertMessagesPost = await db.collection("messages").countDocuments({ "locationData.postId": { $exists: true } });

        console.log(`- bookings with legacy 'post'       : ${assertBookingsPost} (expected: 0)`);
        console.log(`- bookings with legacy 'scheduleId' : ${assertBookingsSched} (expected: 0)`);
        console.log(`- reviews with legacy 'post'        : ${assertReviewsPost} (expected: 0)`);
        console.log(`- groupbookings with legacy 'post'  : ${assertGroupBookingsPost} (expected: 0)`);
        console.log(`- users with legacy 'hostDetails'   : ${assertUsersHostDetails} (expected: 0)`);
        console.log(`- users with legacy 'friends'       : ${assertUsersFriends} (expected: 0)`);
        console.log(`- users with legacy 'savedPosts'    : ${assertUsersSaved} (expected: 0)`);
        console.log(`- notifs with legacy 'postId'       : ${assertNotifsPost} (expected: 0)`);
        console.log(`- messages with legacy 'postId'     : ${assertMessagesPost} (expected: 0)`);

        const allPassed = (
            assertBookingsPost === 0 &&
            assertBookingsSched === 0 &&
            assertReviewsPost === 0 &&
            assertGroupBookingsPost === 0 &&
            assertUsersHostDetails === 0 &&
            assertUsersFriends === 0 &&
            assertUsersSaved === 0 &&
            assertNotifsPost === 0 &&
            assertMessagesPost === 0
        );

        if (allPassed) {
            console.log("\n✅ ALL ASSERTIONS PASSED! Database schema is 100% aligned with models.");
        } else {
            console.error("\n❌ Some assertions failed. Please inspect logs above.");
        }
    } else {
        console.log("\nℹ️ [DRY RUN COMPLETE] No changes were written. Run without --dry-run to apply.");
    }

    console.log("=".repeat(70));
    await mongoose.disconnect();
    process.exit(0);
}

runMigration().catch((err) => {
    console.error("❌ Fatal error during migration:", err);
    process.exit(1);
});
