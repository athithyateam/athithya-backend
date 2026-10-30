import mongoose from "mongoose";
import { User, Conversation } from "../../db/mongoose";
import { sendHtmlEmail } from "../emailService";
import { notificationService } from "../notificationService";

export interface ChatEligibilityResult {
    canChat: boolean;
    isHostToHost?: boolean;
    isGuestToGuest?: boolean;
    isGuestToHost?: boolean;
    isHostResponding?: boolean;
    isHostA?: boolean;
    hostId?: string;
    reason?: string;
}

export interface SendMessagePayload {
    conversationId: string;
    text?: string;
    recipientId?: string;
    messageType?: 'text' | 'location' | 'system' | 'request_payment';
    locationData?: {
        lat: number;
        lng: number;
        cityName?: string;
        experienceId?: string;
    };
    attachments?: Array<{
        url: string;
        public_id?: string;
        resource_type?: string;
    }> | string;
}

export interface CreateGroupPayload {
    name: string;
    description?: string;
    participantIds: string[] | string;
}

export interface UpdateGroupPayload {
    name?: string;
    description?: string;
}

export interface ChatActivityMetrics {
    totalMessages: number;
    totalConversations: number;
    weeklyMessages: number;
    dailyMessages: number;
    dailyBreakdown: Array<{ date: string; label: string; count: number }>;
    topHosts: any[];
    topGuests: any[];
}

export interface ChatSessionSummary {
    id: string;
    isGroup: boolean;
    title?: string;
    avatar?: string | null;
    creator?: string;
    participantsCount?: number;
    host?: any;
    guest?: any;
    booking?: any;
    messageCount: number;
    lastActivity: Date | string;
    lastSeenStatus: string;
    timeline: any[];
}

// In-memory debounce cache: Map<recipientId_senderId, timestamp>
const lastEmailedMap = new Map<string, number>();
const EMAIL_DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes

function pruneDebounceCache() {
    if (lastEmailedMap.size > 500) {
        const threshold = Date.now() - EMAIL_DEBOUNCE_MS;
        for (const [key, timestamp] of lastEmailedMap.entries()) {
            if (timestamp < threshold) lastEmailedMap.delete(key);
        }
    }
}

/**
 * Checks if 1-on-1 chat between two users is eligible based on Athithya's business rules:
 * 1. Admin or official accounts can chat freely.
 * 2. Host-to-Host: Hosts cannot send direct messages to other hosts.
 * 3. Guest-to-Guest: Unrestricted. Any guest can message any other guest.
 * 4. Guest-to-Host: Unrestricted. Any guest can message any host.
 * 5. Host-to-Guest: Host cannot initiate DM with guests, but can respond to any existing conversation.
 */
export async function checkChatEligibility(
    userAId: any,
    userBId: any,
    userModel: any = User,
    conversationModel: any = Conversation
): Promise<ChatEligibilityResult> {
    try {
        if (!userAId || !userBId) return { canChat: true };

        const cleanIdA = String(userAId?._id || userAId || "").trim();
        const cleanIdB = String(userBId?._id || userBId || "").trim();

        if (!cleanIdA || !cleanIdB || cleanIdA === cleanIdB) return { canChat: true };

        const isValidA = mongoose.Types.ObjectId.isValid(cleanIdA);
        const isValidB = mongoose.Types.ObjectId.isValid(cleanIdB);
        if (!isValidA || !isValidB) {
            return { canChat: false, reason: "Invalid participant identifier" };
        }

        const users = await userModel.find({ _id: { $in: [cleanIdA, cleanIdB] } }, "role firstname lastname");
        const userA = users.find((u: any) => String(u._id) === cleanIdA);
        const userB = users.find((u: any) => String(u._id) === cleanIdB);

        if (!userA || !userB) {
            return { canChat: false, reason: "One or more participants do not exist." };
        }

        const isAdmin = users.some((u: any) => u.role === "admin" || (u.firstname === "Athithya" && u.lastname === "Official"));
        if (isAdmin) return { canChat: true };

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

        // CASE 2: Guest to Guest (neither is host)
        if (!isHostA && !isHostB) {
            return { canChat: true, isGuestToGuest: true };
        }

        // CASE 3: Guest messaging Host
        if (!isHostA && isHostB) {
            return { canChat: true, isGuestToHost: true };
        }

        // CASE 4: Host messaging Guest (can only respond to existing conversation)
        if (isHostA && !isHostB) {
            const existingConv = await conversationModel.findOne({
                isGroup: { $ne: true },
                participants: { $all: [cleanIdA, cleanIdB], $size: 2 }
            });

            if (existingConv) {
                return { canChat: true, isHostResponding: true };
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

/**
 * Sends a privacy-preserving email alert to recipient of a new direct message
 * Debounced per sender-recipient pair to prevent spam.
 */
export async function notifyRecipientOfNewMessage(
    sender: any,
    recipientId: any,
    userModel: any = User
): Promise<void> {
    try {
        if (!recipientId || !sender) return;

        const cleanSenderId = String(sender._id || sender.id || sender);
        const cleanRecipientId = String(recipientId?._id || recipientId?.id || recipientId);

        if (cleanSenderId === cleanRecipientId) return;

        const debounceKey = `${cleanRecipientId}_${cleanSenderId}`;
        const lastSent = lastEmailedMap.get(debounceKey);
        const now = Date.now();

        pruneDebounceCache();
        if (lastSent && (now - lastSent) < EMAIL_DEBOUNCE_MS) return;
        lastEmailedMap.set(debounceKey, now);

        const recipient = await userModel.findById(cleanRecipientId).select("email firstname lastname");
        if (!recipient?.email) return;

        const senderFirstName = sender.firstname || "A user";
        const senderLastName = sender.lastname ? ` ${sender.lastname}` : "";
        const senderDisplayName = `${senderFirstName}${senderLastName}`.trim();

        const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
        const loginUrl = `${frontendUrl}/login?redirect=/chat`;

        const subject = `You have a new message from ${senderFirstName} on Athithya`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; background-color: #ffffff;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 24px; text-align: center;">
                    <h2 style="color: #1a1a1a; margin-top: 0; font-size: 20px;">You Have a New Message</h2>
                    <p style="color: #555; font-size: 15px; line-height: 1.6;">Hello ${recipient.firstname || "there"},</p>
                    <p style="color: #555; font-size: 15px; line-height: 1.6;">
                        You received a new message from <strong>${senderDisplayName}</strong> on Athithya.
                    </p>
                    <div style="margin: 32px 0;">
                        <a href="${loginUrl}" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(197, 154, 47, 0.3);">
                            View Message
                        </a>
                    </div>
                    <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">
                        For privacy, message contents are not displayed in this email. Please log in to your Athithya account to view and reply.
                    </p>
                </div>
            </div>
        `;

        sendHtmlEmail(recipient.email, subject, html).catch((err: any) => {
            console.error(`Failed to send message notification email to ${recipient.email}:`, err);
        });
    } catch (err) {
        console.error("Error in notifyRecipientOfNewMessage:", err);
    }
}

/**
 * Emit realtime chat event to a user or room via notificationService
 */
export function emitChatRealtime(targetUserId: string, eventName: string, data: any): void {
    try {
        notificationService.emitToUser(targetUserId, eventName, data);
    } catch (err) {
        console.error(`Error emitting realtime event ${eventName} to user ${targetUserId}:`, err);
    }
}

export function buildDailyBreakdown(raw: any[], now: Date = new Date()): Array<{ date: string; label: string; count: number }> {
    const list = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().split("T")[0];
        const match = raw.find((item: any) => item._id === dateStr);
        list.push({
            date: dateStr,
            label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
            count: match ? match.count : 0
        });
    }
    return list;
}

export function formatTopSenders(rawSenders: any[], users: any[]): { topHosts: any[]; topGuests: any[] } {
    const topHosts: any[] = [];
    const topGuests: any[] = [];
    rawSenders.forEach((item: any) => {
        const u = users.find((user: any) => String(user._id) === String(item._id));
        if (!u) return;
        const data = { _id: u._id, name: `${u.firstname || ""} ${u.lastname || ""}`.trim() || "User", avatar: u.avatar?.url || u.avatar || null, role: u.role, messageCount: item.messageCount };
        if (u.role === "host" && topHosts.length < 5) topHosts.push(data);
        else if (u.role !== "host" && topGuests.length < 5) topGuests.push(data);
    });
    return { topHosts, topGuests };
}

export function formatUserSummary(u: any): any {
    if (!u) return null;
    const isHost = u.role === "host";
    const isAdmin = u.role === "admin" || (u.firstname === "Athithya" && u.lastname === "Official");
    const roleLabel = isHost ? "Host" : (isAdmin ? "Admin" : "Guest");
    return { _id: u._id, name: `${u.firstname || ""} ${u.lastname || ""}`.trim() || roleLabel, avatar: u.avatar?.url || u.avatar || null, role: u.role || "user", roleLabel };
}

module.exports = {
    checkChatEligibility,
    notifyRecipientOfNewMessage,
    emitChatRealtime,
    buildDailyBreakdown,
    formatTopSenders,
    formatUserSummary
};
