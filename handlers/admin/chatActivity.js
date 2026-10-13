const { Conversation, Message, Booking, User } = require("../../db/mongoose");

/**
 * Returns privacy-preserving chat activity metrics and session summaries for the Admin Panel.
 * No private message body or sensitive text is ever exposed.
 */
exports.getChatActivity = async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // 1. Platform-wide Metrics
        const [
            totalMessages,
            totalConversations,
            weeklyMessages,
            dailyMessages
        ] = await Promise.all([
            Message.countDocuments({}),
            Conversation.countDocuments({}),
            Message.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            Message.countDocuments({ createdAt: { $gte: oneDayAgo } })
        ]);

        // Daily breakdown for the last 7 days
        const dailyBreakdownRaw = await Message.aggregate([
            { $match: { createdAt: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const dailyBreakdown = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = d.toISOString().split("T")[0];
            const match = dailyBreakdownRaw.find(item => item._id === dateStr);
            dailyBreakdown.push({
                date: dateStr,
                label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
                count: match ? match.count : 0
            });
        }

        // Top active senders (aggregate by sender)
        const topSendersRaw = await Message.aggregate([
            { $match: { createdAt: { $gte: sevenDaysAgo } } },
            { $group: { _id: "$sender", messageCount: { $sum: 1 } } },
            { $sort: { messageCount: -1 } },
            { $limit: 25 }
        ]);

        const senderIds = topSendersRaw.map(s => s._id).filter(Boolean);
        const users = await User.find({ _id: { $in: senderIds } }, "firstname lastname role avatar");

        const topHosts = [];
        const topGuests = [];

        topSendersRaw.forEach(senderItem => {
            const userObj = users.find(u => String(u._id) === String(senderItem._id));
            if (!userObj) return;

            const userData = {
                _id: userObj._id,
                name: `${userObj.firstname || ""} ${userObj.lastname || ""}`.trim() || "User",
                avatar: userObj.avatar?.url || userObj.avatar || null,
                role: userObj.role,
                messageCount: senderItem.messageCount
            };

            if (userObj.role === "host" && topHosts.length < 5) {
                topHosts.push(userData);
            } else if (userObj.role !== "host" && topGuests.length < 5) {
                topGuests.push(userData);
            }
        });

        // 2. Chat Sessions List
        const conversations = await Conversation.find({})
            .populate("participants", "firstname lastname role avatar email")
            .populate("groupMetadata.admin", "firstname lastname avatar")
            .sort({ updatedAt: -1 })
            .limit(30)
            .lean();

        const sessions = await Promise.all(conversations.map(async (conv) => {
            const convId = conv._id;

            // Message stats for this session (field is conversationId in Message schema)
            const messageCount = await Message.countDocuments({
                $or: [{ conversationId: convId }, { conversation: convId }]
            });

            // Privacy-preserving timeline: latest messages (no text!)
            const recentMsgs = await Message.find({
                $or: [{ conversationId: convId }, { conversation: convId }]
            })
                .select("sender messageType read createdAt")
                .sort({ createdAt: -1 })
                .limit(8)
                .lean();

            const timeline = recentMsgs.map(m => {
                const senderUser = conv.participants?.find(p => String(p._id) === String(m.sender));
                return {
                    id: m._id,
                    senderName: senderUser ? `${senderUser.firstname || ""} ${senderUser.lastname || ""}`.trim() : "Participant",
                    senderRole: senderUser?.role || "user",
                    messageType: m.messageType || "text",
                    isSeen: !!m.read,
                    timestamp: m.createdAt
                };
            });

            const lastMessage = recentMsgs[0] || null;

            if (conv.isGroup) {
                return {
                    id: convId,
                    isGroup: true,
                    title: conv.groupMetadata?.name || "Group Trip Plan",
                    avatar: conv.groupMetadata?.avatar?.url || null,
                    creator: conv.groupMetadata?.admin ? `${conv.groupMetadata.admin.firstname || ""} ${conv.groupMetadata.admin.lastname || ""}`.trim() : "Organizer",
                    participantsCount: conv.participants?.length || 0,
                    messageCount,
                    lastActivity: lastMessage?.createdAt || conv.updatedAt,
                    lastSeenStatus: lastMessage ? (lastMessage.read ? "seen" : "unseen") : "none",
                    timeline
                };
            }

            // 1-on-1 Conversation
            const participantA = conv.participants?.[0] || null;
            const participantB = conv.participants?.[1] || null;

            const formatUser = (u) => {
                if (!u) return null;
                const isHost = u.role === "host";
                const isAdmin = u.role === "admin" || (u.firstname === "Athithya" && u.lastname === "Official");
                const roleLabel = isHost ? "Host" : (isAdmin ? "Admin" : "Guest");
                return {
                    _id: u._id,
                    name: `${u.firstname || ""} ${u.lastname || ""}`.trim() || roleLabel,
                    avatar: u.avatar?.url || u.avatar || null,
                    role: u.role || "user",
                    roleLabel
                };
            };

            const isAHost = participantA?.role === "host";
            const isBHost = participantB?.role === "host";

            let hostUser = null;
            let guestUser = null;

            if (isAHost && !isBHost) {
                hostUser = participantA;
                guestUser = participantB;
            } else if (!isAHost && isBHost) {
                hostUser = participantB;
                guestUser = participantA;
            } else {
                // Neither or both are hosts (e.g. Guest to Guest, or Admin to Guest)
                hostUser = participantA;
                guestUser = participantB;
            }

            // Look up active or latest booking between them
            let bookingInfo = null;
            if (hostUser?._id && guestUser?._id) {
                const booking = await Booking.findOne({
                    $or: [
                        { host: hostUser._id, guest: guestUser._id },
                        { host: guestUser._id, guest: hostUser._id }
                    ]
                })
                .select("postTitle startDate numberOfPeople totalAmount status checkOutOtp")
                .sort({ createdAt: -1 })
                .lean();

                if (booking) {
                    bookingInfo = {
                        id: booking._id,
                        postTitle: booking.postTitle || "Experience",
                        startDate: booking.startDate,
                        numberOfPeople: booking.numberOfPeople,
                        totalAmount: booking.totalAmount,
                        status: booking.status
                    };
                }
            }

            return {
                id: convId,
                isGroup: false,
                host: formatUser(hostUser),
                guest: formatUser(guestUser),
                booking: bookingInfo,
                messageCount,
                lastActivity: lastMessage?.createdAt || conv.updatedAt,
                lastSeenStatus: lastMessage ? (lastMessage.read ? "seen" : "delivered") : "none",
                timeline
            };
        }));

        res.status(200).json({
            success: true,
            metrics: {
                totalMessages,
                totalConversations,
                weeklyMessages,
                dailyMessages,
                dailyBreakdown,
                topHosts,
                topGuests
            },
            sessions
        });
    } catch (error) {
        console.error("Error in getChatActivity:", error);
        res.status(500).json({ success: false, message: "Failed to load chat activity" });
    }
};
