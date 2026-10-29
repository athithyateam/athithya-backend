import mongoose from "mongoose";
import { GroupBooking, Booking, Post, User, Notification } from "../../db/mongoose";

export interface FriendInviteInput {
    postId: string;
    friendId?: string;
    friendIds?: string[];
    bookingDate?: string | Date;
    groupBookingId?: string;
    scheduleId?: string;
    numberOfPeople?: number;
}

export interface CreateGroupBookingInput {
    postId: string;
    invitedUserIds: string[];
    bookingDate: string | Date;
    numberOfPeople?: number;
}

export class GroupBookingService {
    private static instance: GroupBookingService | null = null;
    private static instanceKey = Symbol("GroupBookingServiceInstanceKey");

    private groupBookingModel: any;
    private bookingModel: any;
    private postModel: any;
    private userModel: any;
    private notificationModel: any;

    constructor(
        instanceKey: symbol,
        groupBookingModel: any = GroupBooking,
        bookingModel: any = Booking,
        postModel: any = Post,
        userModel: any = User,
        notificationModel: any = Notification
    ) {
        if (instanceKey !== GroupBookingService.instanceKey) {
            throw new Error("Please use GroupBookingService.getInstance() to retrieve or create an instance");
        }
        this.groupBookingModel = groupBookingModel;
        this.bookingModel = bookingModel;
        this.postModel = postModel;
        this.userModel = userModel;
        this.notificationModel = notificationModel;
    }

    public static getInstance(
        groupBookingModel?: any,
        bookingModel?: any,
        postModel?: any,
        userModel?: any,
        notificationModel?: any
    ): GroupBookingService {
        if (!this.instance) {
            this.instance = new GroupBookingService(
                this.instanceKey,
                groupBookingModel || GroupBooking,
                bookingModel || Booking,
                postModel || Post,
                userModel || User,
                notificationModel || Notification
            );
        }
        return this.instance;
    }

    /**
     * Send immediate invitation to friends (Bulk Support)
     */
    public async sendFriendInvite(initiatorUserId: string, input: FriendInviteInput, io?: any): Promise<any> {
        const initiator = await this.userModel.findById(initiatorUserId);
        if (!initiator) {
            const err: any = new Error("User not found");
            err.statusCode = 404;
            throw err;
        }

        if (initiator.role === 'host') {
            const err: any = new Error("Hosts cannot engage with another host's experience. Only guests can.");
            err.statusCode = 400;
            throw err;
        }

        const post = await this.postModel.findById(input.postId);
        if (!post) {
            const err: any = new Error("Post not found");
            err.statusCode = 404;
            throw err;
        }

        let targetIds: string[] = [];
        if (Array.isArray(input.friendIds) && input.friendIds.length > 0) {
            targetIds = input.friendIds;
        } else if (input.friendId) {
            targetIds = [input.friendId];
        }

        if (targetIds.length === 0) {
            const err: any = new Error("No friends selected");
            err.statusCode = 400;
            throw err;
        }

        let groupBooking = null;
        const targetBookingId = input.groupBookingId || input.scheduleId;
        if (targetBookingId && mongoose.Types.ObjectId.isValid(targetBookingId)) {
            groupBooking = await this.groupBookingModel.findById(targetBookingId);
            if (groupBooking && String(groupBooking.initiator) !== String(initiatorUserId)) {
                const err: any = new Error("Only the group initiator can invite friends to this group");
                err.statusCode = 403;
                throw err;
            }
        }

        if (!groupBooking) {
            groupBooking = new this.groupBookingModel({
                initiator: initiatorUserId,
                post: input.postId,
                postType: post.postType,
                postTitle: post.title,
                invitedPeople: [],
                bookingDate: input.bookingDate ? new Date(input.bookingDate) : new Date(),
                numberOfPeople: input.numberOfPeople || 1,
                status: 'planning'
            });
        }

        const currentInvitedCount = groupBooking.invitedPeople.length;
        const initiatorCount = Number(groupBooking.numberOfPeople || input.numberOfPeople || 1);
        const newInvitesCount = targetIds.filter(fId => !groupBooking.invitedPeople.some((inv: any) => String(inv.user) === String(fId))).length;

        if (currentInvitedCount + newInvitesCount > 2) {
            const err: any = new Error("You can invite a maximum of 2 friends");
            err.statusCode = 400;
            throw err;
        }

        if (initiatorCount + currentInvitedCount + newInvitesCount > 3) {
            const err: any = new Error("Total group size (travelers + invited friends) cannot exceed 3");
            err.statusCode = 400;
            throw err;
        }

        for (const fId of targetIds) {
            const alreadyInvited = groupBooking.invitedPeople.some((inv: any) => String(inv.user) === String(fId));
            if (!alreadyInvited) {
                groupBooking.invitedPeople.push({
                    user: fId,
                    status: 'pending',
                    invitedAt: new Date()
                });

                const notification = await this.notificationModel.create({
                    recipient: fId,
                    sender: initiatorUserId,
                    title: "Experience Invitation",
                    message: `${initiator.firstname} ${initiator.lastname} invited you to join: "${post.title}"`,
                    type: 'invite_sent',
                    link: `/post/${input.postId}?groupBookingId=${groupBooking._id}`,
                    metadata: { postId: input.postId, groupBookingId: groupBooking._id }
                });

                if (io) {
                    io.to(fId.toString()).emit('new_notification', notification);
                }
            } else {
                const idx = groupBooking.invitedPeople.findIndex((inv: any) => String(inv.user) === String(fId));
                groupBooking.invitedPeople[idx].invitedAt = new Date();
                groupBooking.invitedPeople[idx].status = 'pending';
            }
        }

        await groupBooking.save();
        return await this.groupBookingModel.findById(groupBooking._id)
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
    }

    /**
     * Remove an invited friend from a group booking
     */
    public async removeInvitedFriend(postId: string, friendId: string, initiatorId: string): Promise<any> {
        const groupBooking = await this.groupBookingModel.findOne({ post: postId, initiator: initiatorId, status: 'planning' });
        if (!groupBooking) {
            const err: any = new Error("Group booking not found");
            err.statusCode = 404;
            throw err;
        }

        groupBooking.invitedPeople = groupBooking.invitedPeople.filter((p: any) => String(p.user?._id || p.user) !== String(friendId));

        await this.notificationModel.deleteMany({
            recipient: friendId,
            type: 'invite_sent',
            'metadata.postId': postId
        });

        await groupBooking.save();
        return await groupBooking.populate([
            { path: 'initiator', select: 'firstname lastname avatar' },
            { path: 'invitedPeople.user', select: 'firstname lastname avatar' }
        ]);
    }

    /**
     * Get user's initiated group bookings
     */
    public async getMyGroupBookings(userId: string): Promise<any[]> {
        return await this.groupBookingModel.find({ initiator: userId })
            .populate('post', 'title photos images price location')
            .populate('invitedPeople.user', 'firstname lastname avatar')
            .populate('bookingId')
            .sort({ createdAt: -1 });
    }

    /**
     * Get group booking invites received by user
     */
    public async getReceivedInvites(userId: string): Promise<any[]> {
        return await this.groupBookingModel.find({ 'invitedPeople.user': userId })
            .populate('initiator', 'firstname lastname avatar')
            .populate('post', 'title photos images price location')
            .populate('bookingId')
            .sort({ createdAt: -1 });
    }

    /**
     * Create group booking session and invite friends
     */
    public async createGroupBooking(initiatorUserId: string, input: CreateGroupBookingInput, io?: any): Promise<any> {
        const initiator = await this.userModel.findById(initiatorUserId);
        if (!initiator) {
            const err: any = new Error("User not found");
            err.statusCode = 404;
            throw err;
        }

        if (initiator.role === 'host') {
            const err: any = new Error("Hosts cannot engage with another host's experience. Only guests can.");
            err.statusCode = 400;
            throw err;
        }

        const post = await this.postModel.findById(input.postId);
        if (!post) {
            const err: any = new Error("Post not found");
            err.statusCode = 404;
            throw err;
        }

        const validUsers = await this.userModel.find({ _id: { $in: input.invitedUserIds }, role: { $ne: 'host' } });
        const numTravelers = Number(input.numberOfPeople || 1);

        if (validUsers.length > 2) {
            const err: any = new Error("You can invite a maximum of 2 friends");
            err.statusCode = 400;
            throw err;
        }

        if (numTravelers + validUsers.length > 3) {
            const err: any = new Error("Total group size (travelers + invited friends) cannot exceed 3");
            err.statusCode = 400;
            throw err;
        }

        const invitedPeople = validUsers.map((u: any) => ({
            user: u._id,
            status: 'pending'
        }));

        const groupBooking = new this.groupBookingModel({
            initiator: initiatorUserId,
            post: input.postId,
            postType: post.postType,
            postTitle: post.title,
            invitedPeople,
            bookingDate: new Date(input.bookingDate),
            numberOfPeople: input.numberOfPeople || 1,
            status: 'planning'
        });

        await groupBooking.save();

        await Promise.all(validUsers.map(async (friend: any) => {
            const notification = await this.notificationModel.create({
                recipient: friend._id,
                sender: initiatorUserId,
                title: "Experience Invitation",
                message: `${initiator.firstname} ${initiator.lastname} invited you to join: "${post.title}"`,
                type: 'invite_sent',
                link: `/post/${input.postId}?groupBookingId=${groupBooking._id}`,
                metadata: { postId: input.postId, groupBookingId: groupBooking._id }
            });
            if (io) io.to(friend._id.toString()).emit('new_notification', notification);
        }));

        return groupBooking;
    }

    /**
     * Respond to invitation (accept / reject)
     */
    public async respondToInvite(userId: string, groupBookingId: string, status: string, io?: any): Promise<any> {
        const groupBooking = await this.groupBookingModel.findById(groupBookingId);
        if (!groupBooking) {
            const err: any = new Error("Group booking not found");
            err.statusCode = 404;
            throw err;
        }

        const inviteIndex = groupBooking.invitedPeople.findIndex((inv: any) => inv.user.toString() === userId.toString());
        if (inviteIndex === -1) {
            const err: any = new Error("Unauthorized");
            err.statusCode = 403;
            throw err;
        }

        groupBooking.invitedPeople[inviteIndex].status = status;
        groupBooking.invitedPeople[inviteIndex].respondedAt = new Date();

        if (status === 'accepted') {
            const allAccepted = groupBooking.invitedPeople.every((p: any) => p.status === 'accepted');
            if (allAccepted) {
                groupBooking.status = 'confirmed';
                const groupReadyNotification = await this.notificationModel.create({
                    recipient: groupBooking.initiator,
                    sender: userId,
                    title: "Group Ready!",
                    message: `Everyone accepted for "${groupBooking.postTitle}"!`,
                    type: 'booking_accepted',
                    metadata: { groupBookingId: groupBooking._id }
                });
                if (io) io.to(groupBooking.initiator.toString()).emit('new_notification', groupReadyNotification);
            }
        }

        await groupBooking.save();
        return groupBooking;
    }

    /**
     * Get group booking status with timeout and auto-accept logic
     */
    public async getGroupBookingStatus(postId: string, groupBookingId?: string, currentUserId?: string): Promise<any> {
        let groupBooking = null;

        // 1. Priority: Find by ID
        if (groupBookingId && mongoose.Types.ObjectId.isValid(groupBookingId)) {
            groupBooking = await this.groupBookingModel.findOne({
                _id: groupBookingId,
                post: postId,
                status: { $in: ['planning', 'confirmed'] }
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar')
            .populate({
                path: 'bookingId',
                populate: [
                    { path: 'guest', select: 'firstname lastname avatar' },
                    { path: 'joinedUsers.user', select: 'firstname lastname avatar' }
                ]
            });

            if (groupBooking && currentUserId) {
                const isInitiator = String(groupBooking.initiator?._id || groupBooking.initiator) === String(currentUserId);
                const isInvited = groupBooking.invitedPeople.some((inv: any) => String(inv.user?._id || inv.user) === String(currentUserId));

                if (!isInitiator && !isInvited) {
                    const Obj = groupBooking.toObject();
                    Obj.isInviteExpired = true;
                    return Obj;
                }
            }
        }

        // 2. Fallback: Initiator
        if (!groupBooking && currentUserId) {
            groupBooking = await this.groupBookingModel.findOne({
                post: postId,
                initiator: currentUserId,
                status: 'planning'
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
        }

        // 3. Fallback: Invited Participants
        if (!groupBooking && currentUserId) {
            groupBooking = await this.groupBookingModel.findOne({
                post: postId,
                'invitedPeople.user': currentUserId,
                status: 'planning'
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
        }

        if (groupBooking && currentUserId) {
            const inviteIndex = groupBooking.invitedPeople.findIndex((inv: any) => String(inv.user?._id || inv.user) === String(currentUserId));
            if (inviteIndex !== -1) {
                const invite = groupBooking.invitedPeople[inviteIndex];
                const isInitiator = String(groupBooking.initiator?._id || groupBooking.initiator) === String(currentUserId);

                const ONE_HOUR = 60 * 60 * 1000;
                const isPending = invite.status === 'pending';
                const isTimedOut = (new Date().getTime() - new Date(invite.invitedAt).getTime()) > ONE_HOUR;

                if (!isInitiator && isPending && isTimedOut) {
                    const Obj = groupBooking.toObject();
                    Obj.isInviteExpired = true;
                    return Obj;
                }

                if (isPending && !isTimedOut) {
                    groupBooking.invitedPeople[inviteIndex].status = 'accepted';
                    groupBooking.invitedPeople[inviteIndex].respondedAt = new Date();
                    await groupBooking.save();
                }
            }
        }

        return groupBooking;
    }

    /**
     * Delete experience/group session (Full Reset)
     */
    public async deleteGroupBooking(groupBookingId: string, currentUserId: string): Promise<boolean> {
        const groupBooking = await this.groupBookingModel.findById(groupBookingId);
        if (!groupBooking) return true; // Idempotent

        if (String(groupBooking.initiator) !== String(currentUserId)) {
            const err: any = new Error("Forbidden: only the initiator can cancel the session");
            err.statusCode = 403;
            throw err;
        }

        await this.groupBookingModel.findByIdAndDelete(groupBookingId);
        return true;
    }

    /**
     * Update traveler count on group booking
     */
    public async updateGroupBooking(groupBookingId: string, currentUserId: string, numberOfPeople: number): Promise<any> {
        const groupBooking = await this.groupBookingModel.findById(groupBookingId);
        if (!groupBooking) {
            const err: any = new Error("Group booking not found");
            err.statusCode = 404;
            throw err;
        }

        if (String(groupBooking.initiator) !== String(currentUserId)) {
            const err: any = new Error("Only the initiator can update the group booking");
            err.statusCode = 403;
            throw err;
        }

        const num = Number(numberOfPeople);
        if (isNaN(num) || num < 1) {
            const err: any = new Error("Invalid traveler count");
            err.statusCode = 400;
            throw err;
        }

        const invitedCount = groupBooking.invitedPeople?.length || 0;
        if (num + invitedCount > 3) {
            const err: any = new Error("Total group size (travelers + invited friends) cannot exceed 3");
            err.statusCode = 400;
            throw err;
        }

        groupBooking.numberOfPeople = num;
        await groupBooking.save();

        return await this.groupBookingModel.findById(groupBooking._id)
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
    }
}

export const groupBookingService = GroupBookingService.getInstance();
export default GroupBookingService;
