import { User, Notification, Conversation, Message, Friendship, FriendRequest } from "../../db/mongoose";
import { notificationService } from "../notificationService";
import { BadRequestError, NotFoundError } from "../../errors";

export class SocialService {
    private static instance: SocialService | null = null;
    private static instanceKey = Symbol("SocialServiceInstanceKey");

    private userModel: any;
    private friendshipModel: any;
    private friendRequestModel: any;
    private notificationModel: any;
    private conversationModel: any;
    private messageModel: any;
    private notificationSvc: any;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        friendshipModel: any = Friendship,
        friendRequestModel: any = FriendRequest,
        notificationModel: any = Notification,
        conversationModel: any = Conversation,
        messageModel: any = Message,
        notificationSvc: any = notificationService
    ) {
        if (instanceKey !== SocialService.instanceKey) {
            throw new Error("Please use SocialService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.friendshipModel = friendshipModel;
        this.friendRequestModel = friendRequestModel;
        this.notificationModel = notificationModel;
        this.conversationModel = conversationModel;
        this.messageModel = messageModel;
        this.notificationSvc = notificationSvc;
    }

    public static getInstance(
        userModel?: any,
        friendshipModel?: any,
        friendRequestModel?: any,
        notificationModel?: any,
        conversationModel?: any,
        messageModel?: any,
        notificationSvc?: any
    ): SocialService {
        if (!this.instance) {
            this.instance = new SocialService(
                this.instanceKey,
                userModel || User,
                friendshipModel || Friendship,
                friendRequestModel || FriendRequest,
                notificationModel || Notification,
                conversationModel || Conversation,
                messageModel || Message,
                notificationSvc || notificationService
            );
        }
        return this.instance;
    }

    /**
     * Broadcast social status update to both involved users
     */
    private emitSocialStatus(user1: string, user2: string, status: string): void {
        const payload = { requesterId: user1, targetId: user2, status };
        this.notificationSvc.emitToUser(user1, "social_status_updated", payload);
        this.notificationSvc.emitToUser(user2, "social_status_updated", payload);
    }

    /**
     * Service: Send friend request
     */
    public async sendFriendRequest(targetUserId: string, currentUserId: string): Promise<boolean> {
        if (targetUserId === currentUserId) {
            throw new BadRequestError("Can't friend yourself");
        }

        const currentUser = await this.userModel.findById(currentUserId).select("firstname lastname");
        if (!currentUser) {
            throw new NotFoundError("User not found");
        }

        const targetUser = await this.userModel.findById(targetUserId).select("_id");
        if (!targetUser) {
            throw new NotFoundError("User not found");
        }

        // Check if already friends via dedicated Friendship collection (O(1) indexed check)
        const areFriends = await this.friendshipModel.exists({ user: currentUserId, friend: targetUserId });
        if (areFriends) {
            throw new BadRequestError("Already friends");
        }

        // Check if request already pending
        const existingReq = await this.friendRequestModel.findOne({
            sender: currentUserId,
            recipient: targetUserId,
            status: "pending"
        });
        if (existingReq) {
            throw new BadRequestError("Request already sent");
        }

        // Upsert friend request record
        await this.friendRequestModel.findOneAndUpdate(
            { sender: currentUserId, recipient: targetUserId },
            { $set: { status: "pending" } },
            { upsert: true, new: true }
        );

        await this.notificationSvc.sendNotification({
            recipient: targetUserId,
            sender: currentUserId,
            title: "Friend Request",
            message: `${currentUser.firstname} wants to be friends`,
            type: "friend_request",
            link: `/profile/${currentUserId}`,
            metadata: { userId: currentUserId },
            idempotencyKey: `friend_req_${currentUserId}_${targetUserId}`
        });

        this.emitSocialStatus(currentUserId, targetUserId, "requested");
        return true;
    }

    /**
     * Service: Accept friend request
     */
    public async acceptFriendRequest(requesterId: string, currentUserId: string): Promise<boolean> {
        const pendingRequest = await this.friendRequestModel.findOne({
            sender: requesterId,
            recipient: currentUserId,
            status: "pending"
        });

        if (!pendingRequest) {
            throw new BadRequestError("No request found");
        }

        // Remove the friend request
        await this.friendRequestModel.deleteOne({ _id: pendingRequest._id });

        // Create bidirectional friendship entries
        await this.friendshipModel.updateOne(
            { user: currentUserId, friend: requesterId },
            { $set: { user: currentUserId, friend: requesterId } },
            { upsert: true }
        );
        await this.friendshipModel.updateOne(
            { user: requesterId, friend: currentUserId },
            { $set: { user: requesterId, friend: currentUserId } },
            { upsert: true }
        );

        const currentUser = await this.userModel.findById(currentUserId).select("firstname lastname");
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

        if (updatedNotif) {
            this.notificationSvc.emitToUser(currentUserId, "notification_updated", updatedNotif);
        }

        await this.notificationSvc.sendNotification({
            recipient: requesterId,
            sender: currentUserId,
            title: "Friend Request Accepted",
            message: `${currentUser?.firstname || "User"} accepted your request`,
            type: "friend_accepted",
            link: `/profile/${currentUserId}`,
            metadata: { userId: currentUserId },
            idempotencyKey: `friend_accept_${requesterId}_${currentUserId}`
        });

        this.emitSocialStatus(requesterId, currentUserId, "friends");
        return true;
    }

    /**
     * Service: Reject friend request
     */
    public async rejectFriendRequest(requesterId: string, currentUserId: string): Promise<boolean> {
        await this.friendRequestModel.deleteOne({ sender: requesterId, recipient: currentUserId });

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

        if (updatedNotif) {
            this.notificationSvc.emitToUser(currentUserId, "notification_updated", updatedNotif);
        }

        this.emitSocialStatus(requesterId, currentUserId, "none");
        return true;
    }

    /**
     * Service: Unfriend user and clear direct conversation
     */
    public async unfriend(targetUserId: string, currentUserId: string): Promise<boolean> {
        // Remove bidirectional friendship records
        await this.friendshipModel.deleteMany({
            $or: [
                { user: currentUserId, friend: targetUserId },
                { user: targetUserId, friend: currentUserId }
            ]
        });

        // Also clean up any lingering friend requests
        await this.friendRequestModel.deleteMany({
            $or: [
                { sender: currentUserId, recipient: targetUserId },
                { sender: targetUserId, recipient: currentUserId }
            ]
        });

        // Find and delete direct 1-to-1 conversation and messages between them
        const conversation = await this.conversationModel.findOne({
            isGroup: false,
            participants: { $all: [currentUserId, targetUserId] }
        });
        if (conversation) {
            await this.messageModel.deleteMany({ conversationId: conversation._id });
            await this.conversationModel.deleteOne({ _id: conversation._id });
        }

        this.emitSocialStatus(currentUserId, targetUserId, "none");
        return true;
    }

    /**
     * Service: Get friends list for a user with pagination
     */
    public async getFriends(userId: string, page: number | string = 1, limit: number | string = 20): Promise<{ count: number; data: any[] }> {
        const userExists = await this.userModel.exists({ _id: userId });
        if (!userExists) {
            throw new NotFoundError("User not found");
        }

        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const limitNum = Math.max(1, parseInt(String(limit), 10) || 20);

        const totalFriendsCount = await this.friendshipModel.countDocuments({ user: userId });

        const friendships = await this.friendshipModel.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .populate({
                path: 'friend',
                select: 'firstname lastname avatar description role'
            });

        const validFriends = friendships.map((f: any) => f.friend).filter(Boolean);

        return {
            count: totalFriendsCount,
            data: validFriends
        };
    }

    /**
     * Service: Get directory of users/guests with pagination and friend status
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

        let friendIds: string[] = [];
        let mySentRequests: string[] = [];

        if (currentUserId) {
            const friendships = await this.friendshipModel.find({ user: currentUserId }).select("friend");
            friendIds = friendships.map((f: any) => f.friend ? f.friend.toString() : "").filter(Boolean);

            const sentReqs = await this.friendRequestModel.find({ sender: currentUserId, status: "pending" }).select("recipient");
            mySentRequests = sentReqs.map((r: any) => r.recipient ? r.recipient.toString() : "").filter(Boolean);
        }

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
