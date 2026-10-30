import { Conversation, Message, User, Booking } from "../db/mongoose";
const { storageService: defaultStorageService } = require("./storageService");
import {
    checkChatEligibility,
    notifyRecipientOfNewMessage,
    emitChatRealtime,
    buildDailyBreakdown,
    formatTopSenders,
    formatUserSummary,
    ChatEligibilityResult,
    SendMessagePayload,
    CreateGroupPayload,
    UpdateGroupPayload,
    ChatActivityMetrics,
    ChatSessionSummary
} from "./chat/chatHelper";

export {
    ChatEligibilityResult,
    SendMessagePayload,
    CreateGroupPayload,
    UpdateGroupPayload,
    ChatActivityMetrics,
    ChatSessionSummary
};

export class ChatService {
    private static instance: ChatService | null = null;
    private static instanceKey = Symbol("ChatServiceInstanceKey");

    private conversationModel: any;
    private messageModel: any;
    private userModel: any;
    private bookingModel: any;
    private storageService: any;

    constructor(instanceKey: symbol, ...args: any[]) {
        if (instanceKey !== ChatService.instanceKey) throw new Error("Use ChatService.getInstance()");
        const [cm = Conversation, mm = Message, um = User, bm = Booking, ss = defaultStorageService] = args;
        this.conversationModel = cm;
        this.messageModel = mm;
        this.userModel = um;
        this.bookingModel = bm;
        this.storageService = ss;
    }

    public static getInstance(...args: any[]): ChatService {
        if (!this.instance) this.instance = new ChatService(this.instanceKey, ...args);
        return this.instance;
    }

    // ==================== CONVERSATIONS ====================

    public async checkEligibility(userAId: string, userBId: string): Promise<ChatEligibilityResult> {
        return checkChatEligibility(userAId, userBId, this.userModel, this.conversationModel);
    }

    public async getChatEligibility(conversationId: string, userId: string): Promise<ChatEligibilityResult> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
        if (conv.isGroup) return { canChat: true };

        const targetUser = conv.participants.find((p: any) => String(p._id || p) !== String(userId));
        return this.checkEligibility(userId, String(targetUser?._id || targetUser || ""));
    }

    public async getUserConversations(userId: string): Promise<any[]> {
        return this.conversationModel.find({ participants: userId })
            .populate("participants", "firstname lastname avatar role")
            .sort({ updatedAt: -1 });
    }

    public async getMessages(conversationId: string, userId: string): Promise<any[]> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
        if (!conv.participants.some((p: any) => p.toString() === userId.toString())) {
            throw Object.assign(new Error("Unauthorized: You are not a participant in this conversation"), { statusCode: 403 });
        }
        return this.messageModel.find({ conversationId }).sort({ createdAt: 1 }).populate("sender", "firstname lastname avatar");
    }

    public async getOrCreateConversation(senderId: string, recipientId: string): Promise<any> {
        if (String(senderId) === String(recipientId)) throw Object.assign(new Error("Cannot start a chat with yourself"), { statusCode: 400 });

        const eligibility = await this.checkEligibility(senderId, recipientId);
        if (!eligibility.canChat) {
            throw Object.assign(new Error(eligibility.reason || "You are not eligible to start a conversation with this user."), { statusCode: 403, eligibility });
        }

        let conv = await this.conversationModel.findOne({ participants: { $all: [senderId, recipientId], $size: 2 } });
        if (!conv) {
            conv = await this.conversationModel.create({
                participants: [senderId, recipientId],
                unreadCounts: new Map([[senderId, 0], [recipientId, 0]])
            });
        }
        return this.conversationModel.findById(conv._id).populate("participants", "firstname lastname avatar role");
    }

    public async createGroup(adminId: string, payload: CreateGroupPayload, file?: any): Promise<any> {
        const { name, description, participantIds } = payload;
        let parsed: any[] = [];
        try { parsed = typeof participantIds === "string" ? JSON.parse(participantIds) : participantIds; } catch { parsed = participantIds as any[]; }

        if (!name || !parsed || !Array.isArray(parsed)) throw Object.assign(new Error("Name and participants are required"), { statusCode: 400 });

        const participants = [...new Set([...parsed.map(id => id.toString()), adminId.toString()])];
        let avatarData = undefined;
        if (file) {
            const res = await this.storageService.upload(file, "groups");
            avatarData = { url: res.secure_url, public_id: res.public_id };
        }

        const unreadMap = new Map();
        participants.forEach(p => unreadMap.set(p.toString(), 0));

        const group = await this.conversationModel.create({
            isGroup: true,
            participants,
            groupMetadata: { name, description, avatar: avatarData, admin: adminId },
            unreadCounts: unreadMap,
            lastMessage: { text: "Group plan created", sender: adminId, createdAt: new Date() }
        });

        const creator = await this.userModel.findById(adminId);
        await this.messageModel.create({
            conversationId: group._id, sender: adminId, messageType: "system",
            text: `${creator?.firstname || "Someone"} created this plan for everyone.`
        });

        return this.conversationModel.findById(group._id).populate("participants", "firstname lastname avatar role");
    }

    public async updateGroup(conversationId: string, userId: string, payload: UpdateGroupPayload, file?: any): Promise<any> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv || !conv.isGroup) throw Object.assign(new Error("Group not found"), { statusCode: 404 });
        if (String(conv.groupMetadata?.admin) !== String(userId)) throw Object.assign(new Error("Only admin can update group details"), { statusCode: 403 });

        const updates: any = {};
        if (payload.name) updates["groupMetadata.name"] = payload.name;
        if (payload.description) updates["groupMetadata.description"] = payload.description;
        if (file) {
            const res = await this.storageService.upload(file, "groups");
            updates["groupMetadata.avatar"] = { url: res.secure_url, public_id: res.public_id };
        }

        return this.conversationModel.findByIdAndUpdate(conversationId, { $set: updates }, { new: true })
            .populate("participants", "firstname lastname avatar role");
    }

    public async leaveGroup(conversationId: string, userId: string): Promise<any> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv || !conv.isGroup) throw Object.assign(new Error("Group not found"), { statusCode: 404 });
        if (!conv.participants.some((p: any) => String(p) === String(userId))) throw Object.assign(new Error("You are not a member of this group"), { statusCode: 403 });

        const updatedParticipants = conv.participants.filter((p: any) => String(p) !== String(userId));
        if (updatedParticipants.length === 0) {
            await this.conversationModel.findByIdAndDelete(conversationId);
            await this.messageModel.deleteMany({ conversationId });
            return { deleted: true, message: "Group deleted as last member left" };
        }

        const updateData: any = { participants: updatedParticipants };
        if (String(conv.groupMetadata?.admin) === String(userId)) updateData["groupMetadata.admin"] = updatedParticipants[0];

        const updatedGroup = await this.conversationModel.findByIdAndUpdate(conversationId, { $set: updateData }, { new: true })
            .populate("participants", "firstname lastname avatar role");
        return { deleted: false, conversation: updatedGroup };
    }

    public async deleteConversation(conversationId: string, userId: string): Promise<{ success: boolean; message: string }> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
        if (!conv.participants.some((p: any) => String(p) === String(userId))) throw Object.assign(new Error("Unauthorized to delete this conversation"), { statusCode: 403 });
        if (conv.isGroup && String(conv.groupMetadata?.admin) !== String(userId)) throw Object.assign(new Error("Only admin can delete the group plan"), { statusCode: 403 });

        await this.conversationModel.findByIdAndDelete(conversationId);
        await this.messageModel.deleteMany({ conversationId });
        return { success: true, message: "Conversation deleted permanently" };
    }

    public async clearConversation(conversationId: string, userId: string): Promise<{ success: boolean; message: string }> {
        const conv = await this.conversationModel.findOne({ _id: conversationId, participants: userId });
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });

        await this.messageModel.deleteMany({ conversationId });
        const resetUnread: Record<string, number> = {};
        (conv.participants || []).forEach((p: any) => { resetUnread[String(p)] = 0; });

        await this.conversationModel.findByIdAndUpdate(conversationId, { $set: { lastMessage: null, unreadCounts: resetUnread } });
        return { success: true, message: "Chat cleared successfully" };
    }

    // ==================== MESSAGES & REALTIME ====================

    public async sendMessage(senderId: string, payload: SendMessagePayload): Promise<any> {
        const { conversationId, text, recipientId, messageType = "text", locationData, attachments } = payload;
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
        if (!conv.participants.some((p: any) => p.toString() === senderId.toString())) {
            throw Object.assign(new Error("Unauthorized: You are not a participant in this conversation"), { statusCode: 403 });
        }

        if (!conv.isGroup) {
            const targetUserId = recipientId || conv.participants.find((p: any) => String(p) !== String(senderId));
            const eligibility = await this.checkEligibility(senderId, targetUserId);
            if (!eligibility.canChat) throw Object.assign(new Error(eligibility.reason || "Chat is disabled."), { statusCode: 403, eligibility });
        }

        let parsedAttachments: any[] = [];
        if (attachments) {
            const parsed = typeof attachments === "string" ? JSON.parse(attachments) : attachments;
            parsedAttachments = Array.isArray(parsed) ? parsed : [parsed];
        }

        const messageData: any = { conversationId, sender: senderId, text, messageType, attachments: parsedAttachments };
        if (locationData) messageData.locationData = locationData;
        if (!conv.isGroup) messageData.recipient = recipientId || conv.participants.find((p: any) => String(p) !== String(senderId));

        const message = await this.messageModel.create(messageData);

        const unreadInc: Record<string, number> = {};
        if (conv.isGroup) {
            conv.participants.forEach((p: any) => { if (String(p) !== String(senderId)) unreadInc[`unreadCounts.${p}`] = 1; });
        } else {
            const target = recipientId || conv.participants.find((p: any) => String(p) !== String(senderId));
            unreadInc[`unreadCounts.${target}`] = 1;
        }

        const lastText = text || (parsedAttachments.length ? "Sent an attachment" : messageType === "location" ? "Shared a location" : "Sent a message");
        await this.conversationModel.findByIdAndUpdate(conversationId, {
            $set: { lastMessage: { text: lastText, sender: senderId, createdAt: new Date() } },
            $inc: unreadInc
        });

        await message.populate("sender", "firstname lastname avatar");

        if (conv.isGroup) {
            conv.participants.forEach((p: any) => {
                const pid = String(p);
                if (pid !== String(senderId)) {
                    notifyRecipientOfNewMessage(message.sender, pid, this.userModel);
                    emitChatRealtime(pid, "new_message", message);
                }
            });
        } else {
            const rawTarget = recipientId || conv.participants.find((p: any) => String(p._id || p) !== String(senderId));
            const targetIdStr = String(rawTarget?._id || rawTarget);
            notifyRecipientOfNewMessage(message.sender, targetIdStr, this.userModel);
            emitChatRealtime(targetIdStr, "new_message", message);
        }
        emitChatRealtime(String(senderId), "message_sent", message);

        return message;
    }

    public async markConversationAsRead(conversationId: string, userId: string): Promise<void> {
        const conv = await this.conversationModel.findById(conversationId);
        if (!conv) throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
        if (!conv.participants.some((p: any) => p.toString() === userId.toString())) throw Object.assign(new Error("Unauthorized access"), { statusCode: 403 });

        const query: any = { conversationId, read: false };
        if (!conv.isGroup) query.recipient = userId;
        else query.sender = { $ne: userId };

        await this.messageModel.updateMany(query, { $set: { read: true } });
        await this.conversationModel.findByIdAndUpdate(conversationId, { $set: { [`unreadCounts.${userId}`]: 0 } });
    }

    public async deleteMessage(messageId: string, userId: string): Promise<void> {
        const message = await this.messageModel.findById(messageId);
        if (!message) throw Object.assign(new Error("Message not found"), { statusCode: 404 });
        if (message.sender.toString() !== String(userId)) throw Object.assign(new Error("Unauthorized to delete this message"), { statusCode: 403 });
        await this.messageModel.findByIdAndDelete(messageId);
    }

    // ==================== AUTOMATED WORKFLOWS ====================

    private async sendAutomatedDirectMessage(sender: any, recipient: any, text: string): Promise<any> {
        let conv = await this.conversationModel.findOne({ participants: { $all: [sender._id, recipient._id], $size: 2 } });
        if (!conv) {
            conv = await this.conversationModel.create({
                participants: [sender._id, recipient._id],
                unreadCounts: new Map([[sender._id.toString(), 0], [recipient._id.toString(), 1]])
            });
        }

        const message = await this.messageModel.create({
            conversationId: conv._id, sender: sender._id, recipient: recipient._id, text, messageType: "text"
        });

        await this.conversationModel.findByIdAndUpdate(conv._id, {
            $set: { lastMessage: { text, sender: sender._id, createdAt: new Date() } },
            $inc: { [`unreadCounts.${recipient._id}`]: 1 }
        });

        const populated = { ...message.toObject(), sender: { _id: sender._id, firstname: sender.firstname, lastname: sender.lastname, avatar: sender.avatar } };
        emitChatRealtime(recipient._id.toString(), "new_message", populated);
        emitChatRealtime(recipient._id.toString(), "new_chat_message", { conversationId: conv._id, message: populated });
        return message;
    }

    public async sendHostBookingWelcome(booking: any): Promise<void> {
        try {
            if (!booking) return;
            const guestId = booking.guest?._id || booking.guest;
            const hostId = booking.host?._id || booking.host;
            if (!guestId || !hostId) return;

            const [guest, host] = await Promise.all([
                this.userModel.findById(guestId, "firstname lastname email"),
                this.userModel.findById(hostId, "firstname lastname email role avatar")
            ]);
            if (!guest || !host) return;

            const experienceTitle = booking.experienceTitle || booking.experience?.title || "Experience";
            const text = `Dear ${guest.firstname || "Guest"}, thank you for booking my experience "${experienceTitle}"! I am ${host.firstname || "Host"}, your host for this journey. If you have any queries or details to discuss before we begin, feel free to message me here!`;
            await this.sendAutomatedDirectMessage(host, guest, text);
        } catch (err) {
            console.error("Error in sendHostBookingWelcome:", err);
        }
    }

    public async sendWelcomeChatMessage(user: any, adminUser?: any): Promise<any> {
        const isHost = user.role === "host";
        const roleText = isHost ? "host" : "guest";
        const firstName = user.firstname || (isHost ? "Host" : "Guest");
        const welcomeText = `Dear ${roleText} ${firstName}, Welcome to Athithya! Thank you for creating an account as a ${roleText} in Athithya! If you have any queries, feel free to share them with us.`;

        let admin = adminUser;
        if (!admin) {
            admin = await this.userModel.findOne({ role: "admin", isOfficial: true }) || await this.userModel.findOne({ role: "admin" });
        }
        if (!admin) return null;
        return this.sendAutomatedDirectMessage(admin, user, welcomeText);
    }

    // ==================== ADMIN CHAT ACTIVITY ====================

    public async getAdminChatActivity(): Promise<{ metrics: ChatActivityMetrics; sessions: ChatSessionSummary[] }> {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [totalMessages, totalConversations, weeklyMessages, dailyMessages, dailyBreakdownRaw, topSendersRaw] = await Promise.all([
            this.messageModel.countDocuments({}),
            this.conversationModel.countDocuments({}),
            this.messageModel.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            this.messageModel.countDocuments({ createdAt: { $gte: oneDayAgo } }),
            this.messageModel.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            this.messageModel.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo } } },
                { $group: { _id: "$sender", messageCount: { $sum: 1 } } },
                { $sort: { messageCount: -1 } },
                { $limit: 25 }
            ])
        ]);

        const dailyBreakdown = buildDailyBreakdown(dailyBreakdownRaw, now);
        const senderIds = topSendersRaw.map((s: any) => s._id).filter(Boolean);
        const senders = await this.userModel.find({ _id: { $in: senderIds } }, "firstname lastname role avatar");
        const { topHosts, topGuests } = formatTopSenders(topSendersRaw, senders);

        const conversations = await this.conversationModel.find({})
            .populate("participants", "firstname lastname role avatar email")
            .populate("groupMetadata.admin", "firstname lastname avatar")
            .sort({ updatedAt: -1 })
            .limit(30)
            .lean();

        const convIds = conversations.map((c: any) => c._id);
        const [countsByConv, recentMsgs] = await Promise.all([
            this.messageModel.aggregate([
                { $match: { conversationId: { $in: convIds } } },
                { $group: { _id: "$conversationId", count: { $sum: 1 } } }
            ]),
            this.messageModel.find({ conversationId: { $in: convIds } })
                .select("conversationId sender messageType read createdAt")
                .sort({ createdAt: -1 })
                .lean()
        ]);

        const countMap = new Map(countsByConv.map((c: any) => [String(c._id), c.count]));
        const msgsByConv = new Map<string, any[]>();
        recentMsgs.forEach((m: any) => {
            const cid = String(m.conversationId);
            if (!msgsByConv.has(cid)) msgsByConv.set(cid, []);
            const arr = msgsByConv.get(cid)!;
            if (arr.length < 8) arr.push(m);
        });

        const sessions: ChatSessionSummary[] = await Promise.all(conversations.map(async (conv: any) => {
            const cid = String(conv._id);
            const messageCount = countMap.get(cid) || 0;
            const msgs = msgsByConv.get(cid) || [];
            const lastMsg = msgs[0] || null;

            const timeline = msgs.map((m: any) => {
                const sender = conv.participants?.find((p: any) => String(p._id) === String(m.sender));
                return {
                    id: m._id,
                    senderName: sender ? `${sender.firstname || ""} ${sender.lastname || ""}`.trim() : "Participant",
                    senderRole: sender?.role || "user",
                    messageType: m.messageType || "text",
                    isSeen: !!m.read,
                    timestamp: m.createdAt
                };
            });

            if (conv.isGroup) {
                return {
                    id: cid,
                    isGroup: true,
                    title: conv.groupMetadata?.name || "Group Trip Plan",
                    avatar: conv.groupMetadata?.avatar?.url || null,
                    creator: conv.groupMetadata?.admin ? `${conv.groupMetadata.admin.firstname || ""} ${conv.groupMetadata.admin.lastname || ""}`.trim() : "Organizer",
                    participantsCount: conv.participants?.length || 0,
                    messageCount,
                    lastActivity: lastMsg?.createdAt || conv.updatedAt,
                    lastSeenStatus: lastMsg ? (lastMsg.read ? "seen" : "unseen") : "none",
                    timeline
                };
            }

            const pA = conv.participants?.[0] || null;
            const pB = conv.participants?.[1] || null;
            const hostUser = pA?.role === "host" ? pA : pB;
            const guestUser = pA?.role === "host" ? pB : pA;

            let bookingInfo = null;
            if (hostUser?._id && guestUser?._id) {
                const b = await this.bookingModel.findOne({
                    $or: [
                        { host: hostUser._id, guest: guestUser._id },
                        { host: guestUser._id, guest: hostUser._id }
                    ]
                }).select("experienceTitle startDate numberOfPeople totalAmount status").sort({ createdAt: -1 }).lean();
                if (b) {
                    const expTitle = b.experienceTitle || "Experience";
                    bookingInfo = { id: b._id, experienceTitle: expTitle, startDate: b.startDate, numberOfPeople: b.numberOfPeople, totalAmount: b.totalAmount, status: b.status };
                }
            }

            return {
                id: cid,
                isGroup: false,
                host: formatUserSummary(hostUser),
                guest: formatUserSummary(guestUser),
                booking: bookingInfo,
                messageCount,
                lastActivity: lastMsg?.createdAt || conv.updatedAt,
                lastSeenStatus: lastMsg ? (lastMsg.read ? "seen" : "delivered") : "none",
                timeline
            };
        }));

        return {
            metrics: { totalMessages, totalConversations, weeklyMessages, dailyMessages, dailyBreakdown, topHosts, topGuests },
            sessions
        };
    }
}

export const chatService = ChatService.getInstance();
export default ChatService;

module.exports = chatService;
module.exports.ChatService = ChatService;
module.exports.chatService = chatService;
module.exports.default = ChatService;
