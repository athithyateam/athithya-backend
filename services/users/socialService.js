const { User, Notification, Conversation, Message } = require("../../db/mongoose");
const { sendPlatformNotification } = require("../../utils/notificationHelper");

/**
 * Service: Send friend request
 */
const sendFriendRequest = async ({ targetUserId, currentUserId, io = null }) => {
    if (targetUserId === currentUserId) {
        const error = new Error("Can't friend yourself");
        error.statusCode = 400;
        throw error;
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    if (currentUser.friends?.some(id => id.toString() === targetUserId)) {
        const error = new Error("Already friends");
        error.statusCode = 400;
        throw error;
    }

    if (targetUser.friendRequests?.some(id => id.toString() === currentUserId)) {
        const error = new Error("Request already sent");
        error.statusCode = 400;
        throw error;
    }

    await User.findByIdAndUpdate(targetUserId, { $addToSet: { friendRequests: currentUserId } });

    await sendPlatformNotification(io, {
        recipientId: targetUserId,
        senderId: currentUserId,
        title: "Friend Request",
        message: `${currentUser.firstname} wants to be friends`,
        type: "friend_request",
        link: `/profile/${currentUserId}`,
        metadata: { userId: currentUserId }
    });

    if (io) {
        io.to(targetUserId.toString()).emit("social_status_updated", {
            requesterId: currentUserId,
            targetId: targetUserId,
            status: "requested"
        });
        io.to(currentUserId.toString()).emit("social_status_updated", {
            requesterId: currentUserId,
            targetId: targetUserId,
            status: "requested"
        });
    }

    return true;
};

/**
 * Service: Accept friend request
 */
const acceptFriendRequest = async ({ requesterId, currentUserId, io = null }) => {
    const currentUser = await User.findById(currentUserId);
    if (!currentUser || !currentUser.friendRequests?.some(id => id.toString() === requesterId)) {
        const error = new Error("No request found");
        error.statusCode = 400;
        throw error;
    }

    await User.findByIdAndUpdate(currentUserId, { $pull: { friendRequests: requesterId }, $addToSet: { friends: requesterId } });
    await User.findByIdAndUpdate(requesterId, { $addToSet: { friends: currentUserId } });

    const requester = await User.findById(requesterId).select("firstname lastname email");

    const updatedNotif = await Notification.findOneAndUpdate(
        { recipient: currentUserId, sender: requesterId, type: "friend_request" },
        { 
            $set: { 
                read: true, 
                status: "accepted", 
                title: "Friend Request Accepted", 
                message: `You accepted ${requester?.firstname || "user"}'s friend request` 
            } 
        },
        { new: true }
    );

    if (io && updatedNotif) {
        io.to(currentUserId.toString()).emit("notification_updated", updatedNotif);
    }

    await sendPlatformNotification(io, {
        recipientId: requesterId,
        senderId: currentUserId,
        title: "Friend Request Accepted",
        message: `${currentUser.firstname} accepted your request`,
        type: "friend_accepted",
        link: `/profile/${currentUserId}`,
        metadata: { userId: currentUserId }
    });

    if (io) {
        io.to(requesterId.toString()).emit("social_status_updated", {
            requesterId,
            targetId: currentUserId,
            status: "friends"
        });
        io.to(currentUserId.toString()).emit("social_status_updated", {
            requesterId,
            targetId: currentUserId,
            status: "friends"
        });
    }

    return true;
};

/**
 * Service: Reject friend request
 */
const rejectFriendRequest = async ({ requesterId, currentUserId, io = null }) => {
    await User.findByIdAndUpdate(currentUserId, { $pull: { friendRequests: requesterId } });

    const requester = await User.findById(requesterId).select("firstname lastname");

    const updatedNotif = await Notification.findOneAndUpdate(
        { recipient: currentUserId, sender: requesterId, type: "friend_request" },
        { 
            $set: { 
                read: true, 
                status: "rejected", 
                title: "Friend Request Declined", 
                message: `You declined ${requester?.firstname || "user"}'s friend request` 
            } 
        },
        { new: true }
    );

    if (io && updatedNotif) {
        io.to(currentUserId.toString()).emit("notification_updated", updatedNotif);
    }

    if (io) {
        io.to(requesterId.toString()).emit("social_status_updated", {
            requesterId,
            targetId: currentUserId,
            status: "none"
        });
        io.to(currentUserId.toString()).emit("social_status_updated", {
            requesterId,
            targetId: currentUserId,
            status: "none"
        });
    }

    return true;
};

/**
 * Service: Unfriend user and clear direct conversation
 */
const unfriend = async ({ targetUserId, currentUserId, io = null }) => {
    await User.findByIdAndUpdate(currentUserId, { $pull: { friends: targetUserId } });
    await User.findByIdAndUpdate(targetUserId, { $pull: { friends: currentUserId, friendRequests: currentUserId } });

    // Find and delete direct 1-to-1 conversation and messages between them
    const conversation = await Conversation.findOne({
        isGroup: false,
        participants: { $all: [currentUserId, targetUserId] }
    });
    if (conversation) {
        await Message.deleteMany({ conversationId: conversation._id });
        await Conversation.deleteOne({ _id: conversation._id });
    }

    if (io) {
        io.to(targetUserId.toString()).emit("social_status_updated", {
            requesterId: currentUserId,
            targetId: targetUserId,
            status: "none"
        });
        io.to(currentUserId.toString()).emit("social_status_updated", {
            requesterId: currentUserId,
            targetId: targetUserId,
            status: "none"
        });
    }

    return true;
};

/**
 * Service: Get friends list for a user with pagination
 */
const getFriends = async ({ userId, page = 1, limit = 20 }) => {
    const userDoc = await User.findById(userId).select('friends');
    if (!userDoc) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    const rawFriendIds = (userDoc.friends || []).filter(Boolean);

    const validFriends = await User.find({ _id: { $in: rawFriendIds } })
        .select('firstname lastname avatar description role')
        .sort({ firstname: 1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

    const totalFriendsCount = await User.countDocuments({ _id: { $in: rawFriendIds } });

    // Clean up stale/deleted user IDs from friends array if counts mismatch
    if (rawFriendIds.length !== totalFriendsCount) {
        const existingIds = (await User.find({ _id: { $in: rawFriendIds } }).select('_id')).map(u => u._id);
        await User.updateOne({ _id: userId }, { friends: existingIds });
    }

    return {
        count: totalFriendsCount,
        data: validFriends
    };
};

/**
 * Service: Get guests directory
 */
const getGuests = async ({ currentUserId, search = "", page = 1, limit = 10, role }) => {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 10);

    const currentUser = currentUserId ? await User.findById(currentUserId).select("friends friendRequests") : null;
    const friendIds = (currentUser?.friends || []).map(id => id.toString());
    const mySentRequests = currentUserId
        ? (await User.find({ friendRequests: currentUserId }).select("_id")).map(u => u._id.toString())
        : [];

    const query = {
        isDeleted: { $ne: true }
    };
    if (role) {
        query.role = role;
    } else {
        query.role = { $ne: "admin" };
    }
    if (currentUserId) {
        query._id = { $ne: currentUserId };
    }

    if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [
            { firstname: regex },
            { lastname: regex },
            { email: regex }
        ];
    }

    const total = await User.countDocuments(query);
    const guests = await User.find(query)
        .select("firstname lastname avatar description role location city createdAt")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum);

    const data = guests.map(guest => {
        const gid = guest._id.toString();
        const isFriend = friendIds.includes(gid);
        const isRequested = mySentRequests.includes(gid);
        const friendshipStatus = isFriend ? "friends" : isRequested ? "requested" : "none";
        const city = guest.city || guest.location?.city || guest.location?.name || (typeof guest.location === "string" ? guest.location : "") || "";

        return {
            _id: guest._id,
            firstname: guest.firstname,
            lastname: guest.lastname,
            avatar: guest.avatar,
            description: guest.description,
            role: guest.role,
            location: guest.location,
            city,
            isFriend,
            isRequested,
            friendshipStatus
        };
    });

    return {
        total,
        page: pageNum,
        hasMore: total > pageNum * limitNum,
        guests: data,
        data
    };
};

module.exports = {
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    unfriend,
    getFriends,
    getGuests
};
