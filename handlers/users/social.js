const { User, Notification, Conversation, Message } = require("../../db/mongoose");
const { sendPlatformNotification } = require("../../utils/notificationHelper");

exports.sendFriendRequest = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;
        const currentUser = await User.findById(currentUserId);
        if (targetUserId === currentUserId) return res.status(400).json({ success: false, message: "Can't friend yourself" });

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ success: false, message: "User not found" });
        
        if (currentUser.friends?.some(id => id.toString() === targetUserId)) return res.status(400).json({ success: false, message: "Already friends" });
        if (targetUser.friendRequests?.some(id => id.toString() === currentUserId)) return res.status(400).json({ success: false, message: "Request already sent" });

        await User.findByIdAndUpdate(targetUserId, { $addToSet: { friendRequests: currentUserId } });
        
        const io = req.app.get("io");
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

        return res.status(200).json({ success: true, message: "Friend request sent" });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error sending request" });
    }
};

exports.acceptFriendRequest = async (req, res) => {
    try {
        const requesterId = req.params.id;
        const currentUserId = req.user.userId;
        const currentUser = await User.findById(currentUserId);
        if (!currentUser.friendRequests?.some(id => id.toString() === requesterId)) return res.status(400).json({ success: false, message: "No request found" });

        await User.findByIdAndUpdate(currentUserId, { $pull: { friendRequests: requesterId }, $addToSet: { friends: requesterId } });
        await User.findByIdAndUpdate(requesterId, { $addToSet: { friends: currentUserId } });

        const io = req.app.get("io");
        const requester = await User.findById(requesterId).select("firstname lastname email");

        // Update existing incoming friend_request notification for current user
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

        // Notify the requester in real-time and via email
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

        return res.status(200).json({ success: true, message: "Friend request accepted" });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error accepting request" });
    }
};

exports.rejectFriendRequest = async (req, res) => {
    try {
        const requesterId = req.params.id;
        const currentUserId = req.user.userId;
        await User.findByIdAndUpdate(currentUserId, { $pull: { friendRequests: requesterId } });

        const io = req.app.get("io");
        const requester = await User.findById(requesterId).select("firstname lastname");

        // Update existing incoming friend_request notification for current user
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

        return res.status(200).json({ success: true, message: "Friend request rejected" });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error rejecting request" });
    }
};

exports.unfriend = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;
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

        const io = req.app.get("io");
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

        return res.status(200).json({ success: true, message: "Unfriended and chat cleared" });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error unfriending" });
    }
};

exports.getFriends = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const userDoc = await User.findById(id).select('friends');
        if (!userDoc) return res.status(404).json({ success: false, message: "User not found" });

        const rawFriendIds = (userDoc.friends || []).filter(Boolean);

        // Fetch valid existing friend documents
        const validFriends = await User.find({ _id: { $in: rawFriendIds } })
            .select('firstname lastname avatar description role')
            .sort({ firstname: 1 })
            .skip((Number(page) - 1) * Number(limit))
            .limit(Number(limit));

        const totalFriendsCount = await User.countDocuments({ _id: { $in: rawFriendIds } });

        // Clean up stale/deleted user IDs from friends array if counts mismatch
        if (rawFriendIds.length !== totalFriendsCount) {
            const existingIds = (await User.find({ _id: { $in: rawFriendIds } }).select('_id')).map(u => u._id);
            await User.updateOne({ _id: id }, { friends: existingIds });
        }

        return res.status(200).json({ success: true, count: totalFriendsCount, data: validFriends });
    } catch (error) {
        console.error("Error fetching friends:", error);
        return res.status(500).json({ success: false, message: "Error fetching friends" });
    }
};

exports.getGuests = async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        const { search = "", page = 1, limit = 10 } = req.query;
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
        if (req.query.role) {
            query.role = req.query.role;
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

        return res.status(200).json({
            success: true,
            total,
            page: pageNum,
            hasMore: total > pageNum * limitNum,
            guests: data,
            data
        });
    } catch (error) {
        console.error("Error fetching guests:", error);
        return res.status(500).json({ success: false, message: "Error fetching guests" });
    }
};
