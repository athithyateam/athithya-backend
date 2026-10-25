const { User, Conversation, Message, Booking } = require("../db/mongoose");
const { notificationService } = require("../services/notificationService");

/**
 * Automatically sends a welcome DM from the Host to the Guest upon successful booking:
 * "Dear ${guestFirstName}, thank you for booking my experience "${postTitle}"! I am ${hostFirstName}, your host for this journey. If you have any queries or details to discuss before we begin, feel free to message me here!"
 *
 * @param {Object} req - Express request object (access to req.app.get('io'))
 * @param {Object} booking - The Mongoose booking document (or object with populated guest/host/postTitle)
 */
async function triggerHostBookingWelcome(req, booking) {
    try {
        if (!booking) return;

        const guestId = booking.guest?._id || booking.guest;
        const hostId = booking.host?._id || booking.host;

        if (!guestId || !hostId) return;

        const guestObj = await User.findById(guestId, "firstname lastname email");
        const hostObj = await User.findById(hostId, "firstname lastname email role avatar");

        if (!guestObj || !hostObj) return;

        const guestFirstName = guestObj.firstname || "Guest";
        const hostFirstName = hostObj.firstname || "Host";
        const postTitle = booking.postTitle || booking.post?.title || "Experience";

        const welcomeText = `Dear ${guestFirstName}, thank you for booking my experience "${postTitle}"! I am ${hostFirstName}, your host for this journey. If you have any queries or details to discuss before we begin, feel free to message me here!`;

        // Create or locate 1-on-1 conversation between Host and Guest
        let conversation = await Conversation.findOne({
            participants: { $all: [hostObj._id, guestObj._id], $size: 2 }
        });

        if (!conversation) {
            const unreadMap = new Map();
            unreadMap.set(hostObj._id.toString(), 0);
            unreadMap.set(guestObj._id.toString(), 1);

            conversation = await Conversation.create({
                participants: [hostObj._id, guestObj._id],
                unreadCounts: unreadMap
            });
        }

        // Create Message from Host to Guest
        const message = await Message.create({
            conversationId: conversation._id,
            sender: hostObj._id,
            recipient: guestObj._id,
            text: welcomeText,
            messageType: 'text'
        });

        // Update Conversation metadata
        const guestIdStr = guestObj._id.toString();
        const currentUnread = (conversation.unreadCounts?.get(guestIdStr) || 0) + 1;

        await Conversation.findByIdAndUpdate(conversation._id, {
            $set: {
                lastMessage: {
                    text: welcomeText,
                    sender: hostObj._id,
                    createdAt: new Date()
                },
                [`unreadCounts.${guestIdStr}`]: currentUnread
            }
        });

        // Broadcast Socket.io realtime events if active
        const io = notificationService.getIo() || req?.app?.get("io") || req?.io;
        if (io) {
            const populatedMsg = {
                ...message.toObject(),
                sender: {
                    _id: hostObj._id,
                    firstname: hostObj.firstname,
                    lastname: hostObj.lastname,
                    avatar: hostObj.avatar
                }
            };
            io.to(guestIdStr).emit("new_message", populatedMsg);
            io.to(guestIdStr).emit("new_chat_message", {
                conversationId: conversation._id,
                message: populatedMsg
            });
        }

        console.log(`[HOST_WELCOME_DM] Sent automated DM from Host (${hostObj._id}) to Guest (${guestObj._id})`);
    } catch (error) {
        console.error("Error in triggerHostBookingWelcome:", error);
    }
}

/**
 * Checks if 1-on-1 chat between two users is currently eligible based on active booking timeline.
 * Admins, Official accounts, and Group plans are always exempt (canChat: true).
 * For Guest-Host 1-on-1 chats: returns canChat = true if current time <= active booking endDate.
 *
 * @param {String} userAId - Current authenticated user ID
 * @param {String} userBId - Target participant user ID
 */
/**
 * Checks if 1-on-1 chat between two users is currently eligible based on roles & conversations.
 * 
 * Rules:
 * 1. Admin or official accounts can chat freely.
 * 2. Host-to-Host: Hosts cannot send direct messages to other hosts.
 * 3. Guest-to-Guest: Unrestricted. Any user/guest can chat with any other user/guest freely.
 * 4. Guest-to-Host: Unrestricted. Any user/guest can message any host.
 * 5. Host-to-Guest: Host cannot initiate direct messages with guests from profiles,
 *    but if a conversation already exists (guest initiated or booking welcome), host can freely respond in chat.
 *
 * @param {String} userAId - Current authenticated user ID (Sender)
 * @param {String} userBId - Target participant user ID (Recipient)
 */
async function checkChatEligibility(userAId, userBId) {
    try {
        if (!userAId || !userBId) return { canChat: true };

        const cleanIdA = String(userAId?._id || userAId || "").trim();
        const cleanIdB = String(userBId?._id || userBId || "").trim();

        if (!cleanIdA || !cleanIdB || cleanIdA === cleanIdB) return { canChat: true };

        // 1. Fetch user roles & names
        const users = await User.find({ _id: { $in: [cleanIdA, cleanIdB] } }, "role firstname lastname");
        const userA = users.find(u => String(u._id) === cleanIdA);
        const userB = users.find(u => String(u._id) === cleanIdB);

        const isAdmin = users.some(u => u.role === "admin" || (u.firstname === "Athithya" && u.lastname === "Official"));
        if (isAdmin) {
            return { canChat: true };
        }

        const isHostA = userA?.role === 'host';
        const isHostB = userB?.role === 'host';

        // CASE 1: Host to Host
        if (isHostA && isHostB) {
            return {
                canChat: false,
                isHostToHost: true,
                reason: "Hosts cannot send direct messages to other hosts."
            };
        }

        // CASE 2: Guest to Guest (Neither is a host)
        // Chat is open without any restriction between users/guests
        if (!isHostA && !isHostB) {
            return {
                canChat: true,
                isGuestToGuest: true
            };
        }

        // CASE 3: Guest messaging Host
        // Any user or guest can send messages to any host
        if (!isHostA && isHostB) {
            return {
                canChat: true,
                isGuestToHost: true
            };
        }

        // CASE 4: Host messaging Guest
        // Host cannot initiate to a guest, but can respond to any existing conversation in chat
        if (isHostA && !isHostB) {
            const existingConv = await Conversation.findOne({
                participants: { $all: [cleanIdA, cleanIdB], $size: 2 }
            });

            if (existingConv) {
                return {
                    canChat: true,
                    isHostResponding: true
                };
            }

            return {
                canChat: false,
                isHostA: true,
                reason: "Hosts cannot initiate direct messages with guests. You can respond once a guest sends you a message."
            };
        }

        return { canChat: true };
    } catch (error) {
        console.error("Error in checkChatEligibility:", error);
        return { canChat: true };
    }
}

module.exports = {
    triggerHostBookingWelcome,
    checkChatEligibility
};
