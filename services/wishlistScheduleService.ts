import mongoose from "mongoose";
import { BadRequestError, NotFoundError } from "../errors";
const { WishlistSchedule, Experience, User } = require("../db/mongoose");

export interface ScheduleWishlistInput {
    experienceId: string;
    scheduledDate: string;
    scheduledTime: string;
}

export class WishlistScheduleService {
    private static instance: WishlistScheduleService | null = null;
    private static instanceKey = Symbol("WishlistScheduleServiceInstanceKey");

    private wishlistScheduleModel: any;
    private experienceModel: any;
    private userModel: any;

    constructor(
        instanceKey: symbol,
        wishlistScheduleModel: any = WishlistSchedule,
        experienceModel: any = Experience,
        userModel: any = User
    ) {
        if (instanceKey !== WishlistScheduleService.instanceKey) {
            throw new Error("Please use WishlistScheduleService.getInstance() to retrieve or create an instance");
        }
        this.wishlistScheduleModel = wishlistScheduleModel;
        this.experienceModel = experienceModel;
        this.userModel = userModel;
    }

    public static getInstance(
        wishlistScheduleModel?: any,
        experienceModel?: any,
        userModel?: any
    ): WishlistScheduleService {
        if (!this.instance) {
            this.instance = new WishlistScheduleService(
                this.instanceKey,
                wishlistScheduleModel || WishlistSchedule,
                experienceModel || Experience,
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
            throw new BadRequestError("Hosts cannot schedule experiences. Only guests can.");
        }

        const expId = input.experienceId;
        const { scheduledDate, scheduledTime } = input;
        if (!expId || !scheduledDate || !scheduledTime) {
            throw new BadRequestError("Experience ID, date, and time are required");
        }

        const experience = await this.experienceModel.findById(expId);
        if (!experience) {
            throw new NotFoundError("Experience not found");
        }

        const [year, month, day] = scheduledDate.split('-').map(Number);
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        const targetDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);

        if (isNaN(targetDateTime.getTime())) {
            throw new BadRequestError("Invalid date or time format");
        }

        if (targetDateTime <= new Date()) {
            throw new BadRequestError("Scheduled date and time must be in the future");
        }

        let schedule = await this.wishlistScheduleModel.findOne({ user: userId, $or: [{ experience: expId }, { post: expId }] });
        if (schedule) {
            schedule.scheduledDate = scheduledDate;
            schedule.scheduledTime = scheduledTime;
            schedule.scheduledDateTime = targetDateTime;
            schedule.status = 'scheduled';
            await schedule.save();
        } else {
            schedule = await this.wishlistScheduleModel.create({
                user: userId,
                experience: expId,
                post: expId,
                scheduledDate,
                scheduledTime,
                scheduledDateTime: targetDateTime,
                status: 'scheduled'
            });
        }

        await schedule.populate([
            { path: 'experience', select: 'title photos images price location rating reviewCount' },
            { path: 'post', select: 'title photos images price location rating reviewCount' }
        ]);
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
        .populate('experience', 'title photos images price location rating reviewCount clicks')
        .populate('post', 'title photos images price location rating reviewCount clicks')
        .sort({ scheduledDateTime: 1 });
    }

    /**
     * Check if the logged-in user has a scheduled wishlist item for a specific post
     */
    public async checkWishlistScheduleStatus(userId: string, targetId: string): Promise<any> {
        return await this.wishlistScheduleModel.findOne({
            user: userId,
            $or: [{ experience: targetId }, { post: targetId }],
            status: 'scheduled'
        })
        .populate('experience', 'title photos images price location rating reviewCount')
        .populate('post', 'title photos images price location rating reviewCount');
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
            throw new NotFoundError("Scheduled experience not found");
        }

        await this.wishlistScheduleModel.findByIdAndDelete(id);
        return true;
    }
}

export const wishlistScheduleService = WishlistScheduleService.getInstance();
export default WishlistScheduleService;
