import { Notification, User } from "../db/mongoose";
import { sendHtmlEmail } from "./emailService";
import { NotFoundError } from "../errors";

export interface SendNotificationOptions {
    recipient?: any;
    recipientId?: any;
    sender?: any;
    senderId?: any;
    title: string;
    message: string;
    type?: string;
    link?: string;
    metadata?: any;
    idempotencyKey?: string;
    emailSubject?: string;
    emailHtml?: string;
}

export interface NotifyAdminsOptions {
    senderId?: any;
    title: string;
    message: string;
    type?: string;
    link?: string;
    metadata?: any;
    emailSubject?: string;
    emailHtml?: string;
}

export interface NotificationQueryOptions {
    page?: number | string;
    limit?: number | string;
    unreadOnly?: boolean | string;
}

export interface CreateNotificationDto {
    recipientId?: string;
    senderId?: string;
    title: string;
    message: string;
    type?: string;
    link?: string;
    metadata?: any;
}

export class NotificationService {
    private static instance: NotificationService | null = null;
    private static instanceKey = Symbol("NotificationServiceKey");

    private io: any = null;
    private notificationModel: any;
    private userModel: any;

    constructor(
        instanceKey: symbol,
        io: any = null,
        notificationModel: any = Notification,
        userModel: any = User
    ) {
        if (instanceKey !== NotificationService.instanceKey) {
            throw new Error("Please use NotificationService.getInstance()");
        }
        this.io = io;
        this.notificationModel = notificationModel;
        this.userModel = userModel;

        this.setIo = this.setIo.bind(this);
        this.getIo = this.getIo.bind(this);
        this.sendNotification = this.sendNotification.bind(this);
        this.notifyAdmins = this.notifyAdmins.bind(this);
        this.emitToUser = this.emitToUser.bind(this);
        this.emitToAll = this.emitToAll.bind(this);
        this.getMyNotifications = this.getMyNotifications.bind(this);
        this.getBookingNotifications = this.getBookingNotifications.bind(this);
        this.getFollowNotifications = this.getFollowNotifications.bind(this);
        this.createNotification = this.createNotification.bind(this);
        this.markAsRead = this.markAsRead.bind(this);
        this.markAllAsRead = this.markAllAsRead.bind(this);
        this.deleteNotification = this.deleteNotification.bind(this);
        this.clearAllNotifications = this.clearAllNotifications.bind(this);
    }

    public static getInstance(io?: any): NotificationService {
        if (!this.instance) {
            this.instance = new NotificationService(this.instanceKey, io);
        } else if (io && !this.instance.io) {
            this.instance.setIo(io);
        }
        return this.instance;
    }

    public setIo(ioInstance: any): void {
        this.io = ioInstance;
    }

    public getIo(): any {
        return this.io;
    }

    /**
     * Send in-app notification with real-time Socket.io emit and optional email
     */
    public async sendNotification(options: SendNotificationOptions): Promise<any> {
        try {
            const recipient = options.recipient || options.recipientId;
            const sender = options.sender || options.senderId;
            const { title, message, type = "info", link = "/", metadata = {}, idempotencyKey, emailSubject, emailHtml } = options;
            if (!recipient) return null;

            const recipientIdStr = String(recipient._id || recipient);
            const senderId = sender?._id || sender || recipientIdStr;

            // Idempotency: Prevent duplicate notifications if key is specified
            const key = idempotencyKey || metadata?.idempotencyKey;
            if (key) {
                const existing = await this.notificationModel.findOne({
                    recipient: recipientIdStr,
                    "metadata.idempotencyKey": key
                });
                if (existing) return existing;
            }

            const notif = await this.notificationModel.create({
                recipient: recipientIdStr,
                sender: senderId,
                title,
                message,
                type,
                link,
                metadata: key ? { ...metadata, idempotencyKey: key } : metadata
            });

            // Populate sender if available
            if (sender) {
                try {
                    await notif.populate("sender", "firstname lastname avatar");
                } catch (e) {}
            }

            // Real-time Socket.io broadcast to recipient room
            if (this.io) {
                try {
                    this.io.to(recipientIdStr).emit("new_notification", notif);
                } catch (socketErr) {
                    console.error("Socket emit new_notification error:", socketErr);
                }
            }

            // Optional email notification
            if (emailSubject && emailHtml) {
                try {
                    const user = await this.userModel.findById(recipientIdStr, "email");
                    if (user?.email) {
                        sendHtmlEmail(user.email, emailSubject, emailHtml).catch((err: any) =>
                            console.error("Failed to send notification email:", err)
                        );
                    }
                } catch (emailErr) {
                    console.error("Failed to lookup email for notification:", emailErr);
                }
            }

            return notif;
        } catch (err) {
            console.error("Error in NotificationService.sendNotification:", err);
            return null;
        }
    }

    /**
     * Notify all administrators via in-app notification and email
     */
    public async notifyAdmins(options: NotifyAdminsOptions): Promise<void> {
        try {
            const { senderId, title, message, type = "info", link = "/admin", metadata = {}, emailSubject, emailHtml } = options;
            const admins = await this.userModel.find({ role: "admin" }, "_id email firstname lastname");
            const fallbackAdmin = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
            const emailedSet = new Set<string>();

            if (admins && admins.length > 0) {
                for (const admin of admins) {
                    try {
                        const notif = await this.notificationModel.create({
                            recipient: admin._id,
                            sender: senderId || admin._id,
                            title,
                            message,
                            type,
                            link,
                            metadata
                        });

                        if (this.io) {
                            this.io.to(admin._id.toString()).emit("new_notification", notif);
                        }
                    } catch (notifErr) {
                        console.error(`Failed to create notification for admin ${admin._id}:`, notifErr);
                    }

                    if (emailSubject && emailHtml && admin.email && !emailedSet.has(admin.email.toLowerCase())) {
                        sendHtmlEmail(admin.email, emailSubject, emailHtml).catch(() => {});
                        emailedSet.add(admin.email.toLowerCase());
                    }
                }
            }

            if (emailSubject && emailHtml && fallbackAdmin && !emailedSet.has(fallbackAdmin.toLowerCase())) {
                sendHtmlEmail(fallbackAdmin, emailSubject, emailHtml).catch(() => {});
            }
        } catch (err) {
            console.error("Error in NotificationService.notifyAdmins:", err);
        }
    }

    /**
     * Emit custom socket event directly to a user's private room
     */
    public emitToUser(userId: any, event: string, payload: any): void {
        if (!this.io || !userId) return;
        try {
            const room = String(userId._id || userId).trim();
            this.io.to(room).emit(event, payload);
        } catch (err) {
            console.error(`Error emitting ${event} to user ${userId}:`, err);
        }
    }

    /**
     * Emit broadcast event to all connected sockets
     */
    public emitToAll(event: string, payload: any): void {
        if (!this.io) return;
        try {
            this.io.emit(event, payload);
        } catch (err) {
            console.error(`Error emitting broadcast event ${event}:`, err);
        }
    }

    /**
     * Query: Get notifications for a specific user with pagination
     */
    public async getMyNotifications(userId: string, options: NotificationQueryOptions = {}): Promise<any> {
        const { page = 1, limit = 20, unreadOnly } = options;
        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 20;

        const filter: any = { recipient: userId };
        if (unreadOnly === true || unreadOnly === "true") filter.read = false;

        const skip = (pageNum - 1) * limitNum;
        const [notifications, total, unreadCount] = await Promise.all([
            this.notificationModel.find(filter)
                .populate("sender", "firstname lastname avatar")
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip(skip),
            this.notificationModel.countDocuments(filter),
            this.notificationModel.countDocuments({ recipient: userId, read: false })
        ]);

        return {
            count: notifications.length,
            total,
            unreadCount,
            page: pageNum,
            notifications
        };
    }

    /**
     * Query: Get booking-related notifications for a user
     */
    public async getBookingNotifications(userId: string, options: NotificationQueryOptions = {}): Promise<any> {
        const { page = 1, limit = 20 } = options;
        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 20;

        const filter = {
            recipient: userId,
            type: { $in: ["booking_request", "booking_accepted", "booking_declined", "booking_cancelled"] }
        };

        const skip = (pageNum - 1) * limitNum;
        const [notifications, total, unreadCount] = await Promise.all([
            this.notificationModel.find(filter)
                .populate("sender", "firstname lastname avatar")
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip(skip),
            this.notificationModel.countDocuments(filter),
            this.notificationModel.countDocuments({ ...filter, read: false })
        ]);

        return {
            count: notifications.length,
            total,
            unreadCount,
            page: pageNum,
            notifications
        };
    }

    /**
     * Query: Get follow-related notifications for a user
     */
    public async getFollowNotifications(userId: string, options: NotificationQueryOptions = {}): Promise<any> {
        const { page = 1, limit = 20 } = options;
        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 20;

        const filter = { recipient: userId, type: "follow" };
        const skip = (pageNum - 1) * limitNum;

        const [notifications, total, unreadCount] = await Promise.all([
            this.notificationModel.find(filter)
                .populate("sender", "firstname lastname avatar description")
                .sort({ createdAt: -1 })
                .limit(limitNum)
                .skip(skip),
            this.notificationModel.countDocuments(filter),
            this.notificationModel.countDocuments({ recipient: userId, read: false, type: "follow" })
        ]);

        return {
            count: notifications.length,
            total,
            unreadCount,
            page: pageNum,
            notifications
        };
    }

    /**
     * Mutation: Create notification (internal or controller use)
     */
    public async createNotification(data: CreateNotificationDto): Promise<any> {
        return this.sendNotification({
            recipient: data.recipientId,
            sender: data.senderId,
            title: data.title,
            message: data.message,
            type: data.type || "info",
            link: data.link,
            metadata: data.metadata
        });
    }

    /**
     * Mutation: Mark single notification as read
     */
    public async markAsRead(notificationId: string, userId: string): Promise<any> {
        const notification = await this.notificationModel.findOneAndUpdate(
            { _id: notificationId, recipient: userId },
            { read: true },
            { new: true }
        );
        if (!notification) {
            throw new NotFoundError("Notification not found");
        }
        return notification;
    }

    /**
     * Mutation: Mark all notifications as read for a user
     */
    public async markAllAsRead(userId: string): Promise<boolean> {
        await this.notificationModel.updateMany(
            { recipient: userId, read: false },
            { read: true }
        );
        return true;
    }

    /**
     * Mutation: Delete a single notification
     */
    public async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
        const notification = await this.notificationModel.findOneAndDelete({
            _id: notificationId,
            recipient: userId
        });
        if (!notification) {
            throw new NotFoundError("Notification not found");
        }
        return true;
    }

    /**
     * Mutation: Clear all notifications for a user
     */
    public async clearAllNotifications(userId: string): Promise<boolean> {
        await this.notificationModel.deleteMany({ recipient: userId });
        return true;
    }
}

export const notificationService = NotificationService.getInstance();
export default NotificationService;

// Convenience function exports
export const setIo = notificationService.setIo;
export const getIo = notificationService.getIo;
export const sendNotification = notificationService.sendNotification;
export const notifyAdmins = notificationService.notifyAdmins;
export const emitToUser = notificationService.emitToUser;
export const emitToAll = notificationService.emitToAll;

// CommonJS compatibility
module.exports = notificationService;
module.exports.default = NotificationService;
module.exports.NotificationService = NotificationService;
module.exports.notificationService = notificationService;
