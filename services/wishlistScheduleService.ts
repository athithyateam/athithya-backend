import mongoose from "mongoose";
import { WishlistSchedule, Post, User } from "../db/mongoose";

export interface ScheduleWishlistInput {
    postId: string;
    scheduledDate: string;
    scheduledTime: string;
}

export class WishlistScheduleService {
    private static instance: WishlistScheduleService | null = null;
    private static instanceKey = Symbol("WishlistScheduleServiceInstanceKey");

    private wishlistScheduleModel: any;
    private postModel: any;
    private userModel: any;

    constructor(
        instanceKey: symbol,
        wishlistScheduleModel: any = WishlistSchedule,
        postModel: any = Post,
        userModel: any = User
    ) {
        if (instanceKey !== WishlistScheduleService.instanceKey) {
            throw new Error("Please use WishlistScheduleService.getInstance() to retrieve or create an instance");
        }
        this.wishlistScheduleModel = wishlistScheduleModel;
        this.postModel = postModel;
        this.userModel = userModel;
    }

    public static getInstance(
        wishlistScheduleModel?: any,
        postModel?: any,
        userModel?: any
    ): WishlistScheduleService {
        if (!this.instance) {
            this.instance = new WishlistScheduleService(
                this.instanceKey,
                wishlistScheduleModel || WishlistSchedule,
                postModel || Post,
                userModel || User
            );
        }
        return this.instance;
    }

    /**
     * Create or update a wishlist item with scheduled reminder
     */
    public async scheduleWishlistItem(userId: string, userRole: string, input: ScheduleWishlistInput): Promise<any> {
        if (userRole === 'host') {
            const err: any = new Error("Hosts cannot schedule experiences. Only guests can.");
            err.statusCode = 400;
            throw err;
        }

        const { postId, scheduledDate, scheduledTime } = input;
        if (!postId || !scheduledDate || !scheduledTime) {
            const err: any = new Error("Post ID, date, and time are required");
            err.statusCode = 400;
            throw err;
        }

        const post = await this.postModel.findById(postId);
        if (!post) {
            const err: any = new Error("Experience not found");
            err.statusCode = 404;
            throw err;
        }

        const [year, month, day] = scheduledDate.split('-').map(Number);
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        const targetDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);

        if (isNaN(targetDateTime.getTime())) {
            const err: any = new Error("Invalid date or time format");
            err.statusCode = 400;
            throw err;
        }

        if (targetDateTime <= new Date()) {
            const err: any = new Error("Scheduled date and time must be in the future");
            err.statusCode = 400;
            throw err;
        }

        let schedule = await this.wishlistScheduleModel.findOne({ user: userId, post: postId });
        if (schedule) {
            schedule.scheduledDate = scheduledDate;
            schedule.scheduledTime = scheduledTime;
            schedule.scheduledDateTime = targetDateTime;
            schedule.status = 'scheduled';
            await schedule.save();
        } else {
            schedule = await this.wishlistScheduleModel.create({
                user: userId,
                post: postId,
                postType: post.postType || 'experience',
                scheduledDate,
                scheduledTime,
                scheduledDateTime: targetDateTime,
                status: 'scheduled'
            });
        }

        await schedule.populate('post', 'title photos images price location rating reviewCount postType');
        return schedule;
    }

    /**
     * Get all active scheduled wishlist items for the logged-in guest
     */
    public async getMyWishlistSchedules(userId: string): Promise<any[]> {
        return await this.wishlistScheduleModel.find({
            user: userId,
            status: 'scheduled'
        })
        .populate('post', 'title photos images price location rating reviewCount postType clicks')
        .sort({ scheduledDateTime: 1 });
    }

    /**
     * Check if the logged-in user has a scheduled wishlist item for a specific post
     */
    public async checkWishlistScheduleStatus(userId: string, postId: string): Promise<any> {
        return await this.wishlistScheduleModel.findOne({
            user: userId,
            post: postId,
            status: 'scheduled'
        }).populate('post', 'title photos images price location rating reviewCount postType');
    }

    /**
     * Remove / unschedule a wishlist reminder
     */
    public async removeWishlistSchedule(userId: string, id: string): Promise<boolean> {
        const schedule = await this.wishlistScheduleModel.findOne({
            _id: id,
            user: userId
        });

        if (!schedule) {
            const err: any = new Error("Scheduled experience not found");
            err.statusCode = 404;
            throw err;
        }

        await this.wishlistScheduleModel.findByIdAndDelete(id);
        return true;
    }
}

export const wishlistScheduleService = WishlistScheduleService.getInstance();
export default WishlistScheduleService;
