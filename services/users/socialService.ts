const { User, Notification, Conversation, Message } = require("../../db/mongoose");
const { sendPlatformNotification } = require("../../utils/notificationHelper");

export class SocialService {
    private static instance: SocialService | null = null;
    private static instanceKey = Symbol("SocialServiceInstanceKey");

    private userModel: any;
    private notificationModel: any;
    private conversationModel: any;
    private messageModel: any;
    private notificationSender: (io: any, payload: any) => Promise<any>;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        notificationModel: any = Notification,
        conversationModel: any = Conversation,
        messageModel: any = Message,
        notificationSender: (io: any, payload: any) => Promise<any> = sendPlatformNotification
    ) {
        if (instanceKey !== SocialService.instanceKey) {
            throw new Error("Please use SocialService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.notificationModel = notificationModel;
        this.conversationModel = conversationModel;
        this.messageModel = messageModel;
        this.notificationSender = notificationSender;
    }

    public static getInstance(
        userModel?: any,
        notificationModel?: any,
        conversationModel?: any,
        messageModel?: any,
        notificationSender?: (io: any, payload: any) => Promise<any>
    ): SocialService {
        if (!this.instance) {
            this.instance = new SocialService(
                this.instanceKey,
                userModel,
                notificationModel,
                conversationModel,
                messageModel,
                notificationSender
            );
        }
        return this.instance;
    }

    /**
     * Service: Send friend request
     */
    public async sendFriendRequest(targetUserId: string, currentUserId: string, io: any = null): Promise<boolean> {
        if (targetUserId === currentUserId) {
            const error: any = new Error("Can't friend yourself");
            error.statusCode = 400;
            throw error;
        }

        const currentUser = await this.userModel.findById(currentUserId);
        if (!currentUser) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const targetUser = await this.userModel.findById(targetUserId);
        if (!targetUser) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (currentUser.friends?.some((id: any) => id.toString() === targetUserId)) {
            const error: any = new Error("Already friends");
            error.statusCode = 400;
            throw error;
        }

        if (targetUser.friendRequests?.some((id: any) => id.toString() === currentUserId)) {
            const error: any = new Error("Request already sent");
            error.statusCode = 400;
            throw error;
        }

        await this.userModel.findByIdAndUpdate(targetUserId, { $addToSet: { friendRequests: currentUserId } });

        await this.notificationSender(io, {
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
    }

    /**
     * Service: Accept friend request
     */
    public async acceptFriendRequest(requesterId: string, currentUserId: string, io: any = null): Promise<boolean> {
        const currentUser = await this.userModel.findById(currentUserId);
        if (!currentUser || !currentUser.friendRequests?.some((id: any) => id.toString() === requesterId)) {
            const error: any = new Error("No request found");
            error.statusCode = 400;
            throw error;
        }

        await this.userModel.findByIdAndUpdate(currentUserId, {
            $pull: { friendRequests: requesterId },
            $addToSet: { friends: requesterId }
        });
        await this.userModel.findByIdAndUpdate(requesterId, { $addToSet: { friends: currentUserId } });

        const requester = await this.userModel.findById(requesterId).select("firstname lastname email");

        const updatedNotif = await this.notificationModel.findOneAndUpdate(
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

        await this.notificationSender(io, {
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
    }

    /**
     * Service: Reject friend request
     */
    public async rejectFriendRequest(requesterId: string, currentUserId: string, io: any = null): Promise<boolean> {
        await this.userModel.findByIdAndUpdate(currentUserId, { $pull: { friendRequests: requesterId } });

        const requester = await this.userModel.findById(requesterId).select("firstname lastname");

        const updatedNotif = await this.notificationModel.findOneAndUpdate(
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
    }

    /**
     * Service: Unfriend user and clear direct conversation
     */
    public async unfriend(targetUserId: string, currentUserId: string, io: any = null): Promise<boolean> {
        await this.userModel.findByIdAndUpdate(currentUserId, { $pull: { friends: targetUserId } });
        await this.userModel.findByIdAndUpdate(targetUserId, { $pull: { friends: currentUserId, friendRequests: currentUserId } });

        // Find and delete direct 1-to-1 conversation and messages between them
        const conversation = await this.conversationModel.findOne({
            isGroup: false,
            participants: { $all: [currentUserId, targetUserId] }
        });
        if (conversation) {
            await this.messageModel.deleteMany({ conversationId: conversation._id });
            await this.conversationModel.deleteOne({ _id: conversation._id });
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
    }

    /**
     * Service: Get friends list for a user with pagination
     */
    public async getFriends(userId: string, page: number | string = 1, limit: number | string = 20): Promise<{ count: number; data: any[] }> {
        const userDoc = await this.userModel.findById(userId).select('friends');
        if (!userDoc) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const rawFriendIds = (userDoc.friends || []).filter(Boolean);

        const validFriends = await this.userModel.find({ _id: { $in: rawFriendIds } })
            .select('firstname lastname avatar description role')
            .sort({ firstname: 1 })
            .skip((Number(page) - 1) * Number(limit))
            .limit(Number(limit));

        const totalFriendsCount = await this.userModel.countDocuments({ _id: { $in: rawFriendIds } });

        // Clean up stale/deleted user IDs from friends array if counts mismatch
        if (rawFriendIds.length !== totalFriendsCount) {
            const existingIds = (await this.userModel.find({ _id: { $in: rawFriendIds } }).select('_id')).map((u: any) => u._id);
            await this.userModel.updateOne({ _id: userId }, { friends: existingIds });
        }

        return {
            count: totalFriendsCount,
            data: validFriends
        };
    }

    /**
     * Service: Get guests directory
     */
    public async getGuests(
        currentUserId?: string,
        search: string = "",
        page: number | string = 1,
        limit: number | string = 10,
        role?: string
    ): Promise<any> {
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const limitNum = Math.max(1, parseInt(String(limit), 10) || 10);

        const currentUser = currentUserId ? await this.userModel.findById(currentUserId).select("friends friendRequests") : null;
        const friendIds = (currentUser?.friends || []).map((id: any) => id.toString());
        const mySentRequests = currentUserId
            ? (await this.userModel.find({ friendRequests: currentUserId }).select("_id")).map((u: any) => u._id.toString())
            : [];

        const query: any = {
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

        const total = await this.userModel.countDocuments(query);
        const guests = await this.userModel.find(query)
            .select("firstname lastname avatar description role location city createdAt")
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum);

        const data = guests.map((guest: any) => {
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
    }
}

export const socialService = SocialService.getInstance();
export default SocialService;
