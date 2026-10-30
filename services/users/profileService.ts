import mongoose from "mongoose";
const { 
    User, Experience, Notification, HostDetails, HostAuditLog, 
    Friendship, FriendRequest, SavedExperience, Booking, Conversation, 
    Message, HostPinnedExperienceMedia, WishlistSchedule 
} = require("../../db/mongoose");
import { deleteFile } from "../storageService";
import { parseIfJson, recordHostAuditLog } from "../experiences/experiencePayloadParser";
import { sendTemplateEmail } from "../emailService";
import { notificationService } from "../notificationService";
import { normalizePhoneNumber, renderDocumentListHtml } from "./verificationService";
import { reviewService as defaultReviewService, ReviewService } from "../reviewService";

export interface LocationData {
    latitude: number | string;
    longitude: number | string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
}

export class ProfileService {
    private static instance: ProfileService | null = null;
    private static instanceKey = Symbol("ProfileServiceInstanceKey");

    private userModel: any;
    private experienceModel: any;
    private notificationModel: any;
    private hostDetailsModel: any;
    private hostAuditLogModel: any;
    private friendshipModel: any;
    private friendRequestModel: any;
    private savedExperienceModel: any;
    private bookingModel: any;
    private conversationModel: any;
    private messageModel: any;
    private pinnedExperienceMediaModel: any;
    private wishlistScheduleModel: any;
    private reviewService: ReviewService;
    private fileDeleter: (key: string) => Promise<any>;
    private emailNotifier: (options: any) => Promise<any>;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        experienceModel: any = Experience,
        notificationModel: any = Notification,
        hostDetailsModel: any = HostDetails,
        hostAuditLogModel: any = HostAuditLog,
        friendshipModel: any = Friendship,
        friendRequestModel: any = FriendRequest,
        savedExperienceModel: any = SavedExperience,
        fileDeleter: (key: string) => Promise<any> = deleteFile,
        emailNotifier: (options: any) => Promise<any> = sendTemplateEmail,
        reviewService: ReviewService = defaultReviewService,
        bookingModel: any = Booking,
        conversationModel: any = Conversation,
        messageModel: any = Message,
        pinnedExperienceMediaModel: any = HostPinnedExperienceMedia,
        wishlistScheduleModel: any = WishlistSchedule
    ) {
        if (instanceKey !== ProfileService.instanceKey) {
            throw new Error("Please use ProfileService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.experienceModel = experienceModel;
        this.notificationModel = notificationModel;
        this.hostDetailsModel = hostDetailsModel;
        this.hostAuditLogModel = hostAuditLogModel;
        this.friendshipModel = friendshipModel;
        this.friendRequestModel = friendRequestModel;
        this.savedExperienceModel = savedExperienceModel;
        this.fileDeleter = fileDeleter;
        this.emailNotifier = emailNotifier;
        this.reviewService = reviewService;
        this.bookingModel = bookingModel;
        this.conversationModel = conversationModel;
        this.messageModel = messageModel;
        this.pinnedExperienceMediaModel = pinnedExperienceMediaModel;
        this.wishlistScheduleModel = wishlistScheduleModel;
    }

    public static getInstance(
        userModel?: any,
        experienceModel?: any,
        notificationModel?: any,
        hostDetailsModel?: any,
        hostAuditLogModel?: any,
        friendshipModel?: any,
        friendRequestModel?: any,
        savedExperienceModel?: any,
        fileDeleter?: (key: string) => Promise<any>,
        emailNotifier?: (options: any) => Promise<any>,
        reviewService?: ReviewService,
        bookingModel?: any,
        conversationModel?: any,
        messageModel?: any,
        pinnedExperienceMediaModel?: any,
        wishlistScheduleModel?: any
    ): ProfileService {
        if (!this.instance) {
            this.instance = new ProfileService(
                this.instanceKey,
                userModel || User,
                experienceModel || Experience,
                notificationModel || Notification,
                hostDetailsModel || HostDetails,
                hostAuditLogModel || HostAuditLog,
                friendshipModel || Friendship,
                friendRequestModel || FriendRequest,
                savedExperienceModel || SavedExperience,
                fileDeleter || deleteFile,
                emailNotifier || sendTemplateEmail,
                reviewService || defaultReviewService,
                bookingModel || Booking,
                conversationModel || Conversation,
                messageModel || Message,
                pinnedExperienceMediaModel || HostPinnedExperienceMedia,
                wishlistScheduleModel || WishlistSchedule
            );
        }
        return this.instance;
    }

    /**
     * Helper: Parse interests array from various input formats
     */
    private parseInterests(interests: any): string[] {
        if (!interests) return [];
        if (Array.isArray(interests)) return interests;
        const parsed = parseIfJson(interests);
        if (Array.isArray(parsed)) return parsed;
        if (typeof interests === 'string') {
            return interests.split(',').map((i: string) => i.trim()).filter(Boolean);
        }
        return [];
    }

    /**
     * Helper: Determine mutual friendship and pending request status via indexed collections
     */
    private async getFriendshipStatus(user: any, currentUserIdStr?: string): Promise<{ isFriend: boolean; isRequestedFriend: boolean }> {
        const targetUserIdStr = (user._id || user).toString();
        if (!currentUserIdStr || targetUserIdStr === currentUserIdStr) {
            return { isFriend: false, isRequestedFriend: false };
        }
        const isFriend = await this.friendshipModel.exists({ user: currentUserIdStr, friend: targetUserIdStr });
        const isRequestedFriend = await this.friendRequestModel.exists({
            sender: currentUserIdStr,
            recipient: targetUserIdStr,
            status: "pending"
        });
        return { isFriend: !!isFriend, isRequestedFriend: !!isRequestedFriend };
    }



    /**
     * Record host's previous details to HostAuditLog collection (scoped per host)
     */
    public async saveHostOldDetails(user: any, changedFields: string[] = []): Promise<void> {
        if (!user || user.role !== "host") return;
        const hostDetails = await this.hostDetailsModel.findOne({ user: user._id });
        const hostName = `${user.firstname} ${user.lastname}`;
        await recordHostAuditLog(
            this.hostAuditLogModel,
            {
                type: "profile_update",
                hostId: user._id,
                hostName: hostName,
                changedFields: changedFields,
                snapshot: {
                    avatarUrl: user.avatar?.url || "",
                    physicalAddress: hostDetails?.physicalAddress || "",
                    city: hostDetails?.city || "",
                    district: hostDetails?.district || "",
                    state: hostDetails?.state || "",
                    pincode: hostDetails?.pincode || "",
                    phone: hostDetails?.phone || "",
                    email: user.email || "",
                    aadhaarCard: hostDetails?.aadhaarCard || []
                }
            },
            { hostId: user._id, type: "profile_update" },
            10
        );
    }

    /**
     * Format user response fields based on requester authorization
     */
    public async getUserFields(user: any, isOwnProfileOrAdmin: boolean = false): Promise<any> {
        let hostStatus: string | undefined = undefined;
        let hostDetails: any = undefined;
        let pendingHostDetails: any = undefined;

        if (user.role === "host") {
            const hostDoc = await this.hostDetailsModel.findOne({ user: user._id });
            if (hostDoc) {
                hostStatus = hostDoc.status;
                hostDetails = hostDoc.toObject ? hostDoc.toObject() : JSON.parse(JSON.stringify(hostDoc));
                pendingHostDetails = hostDoc.pendingHostDetails
                    ? (typeof hostDoc.pendingHostDetails.toObject === 'function' ? hostDoc.pendingHostDetails.toObject() : JSON.parse(JSON.stringify(hostDoc.pendingHostDetails)))
                    : undefined;

                if (!isOwnProfileOrAdmin) {
                    if (hostDetails) {
                        delete hostDetails.aadhaarCard;
                    }
                    if (pendingHostDetails) {
                        delete pendingHostDetails.aadhaarCard;
                    }
                }
            }
        }

        const friendsCount = await this.friendshipModel.countDocuments({ user: user._id });
        let savedExperiences: any[] | undefined = undefined;
        if (isOwnProfileOrAdmin) {
            const saved = await this.savedExperienceModel.find({ user: user._id }).select('experience');
            savedExperiences = saved.map((s: any) => s.experience);
        }

        return {
            id: user._id.toString(),
            _id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
            email: isOwnProfileOrAdmin ? user.email : undefined,
            role: user.role,
            avatar: user.avatar,
            description: user.description,
            isVerified: user.isVerified,
            hostStatus: hostStatus,
            hostDetails: hostDetails,
            pendingHostDetails: pendingHostDetails,
            location: user.location,
            activeGridTab: "experience",
            friendsCount,
            interests: user.interests || [],
            walletBalance: isOwnProfileOrAdmin ? (user.walletBalance || 0) : undefined,
            savedExperiences,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
    }

    /**
     * Service: Fetch a user by ID
     */
    public async getUserById(targetUserId: string, currentUserId?: string, currentUserRole?: string): Promise<any> {
        const user = await this.userModel.findById(targetUserId).select('-password');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === targetUserId || currentUserRole === 'admin'));
        const { isFriend: isFollowing, isRequestedFriend: isRequested } = await this.getFriendshipStatus(user, currentUserIdStr);

        const userData = await this.getUserFields(user, isOwnProfileOrAdmin);
        return { ...userData, isFollowing, isRequested };
    }

    /**
     * Service: Update user geographic/text location
     */
    public async updateUserLocation(userId: string, locationData: LocationData): Promise<any> {
        const { latitude, longitude, address, city, state, country } = locationData;
        if (!latitude || !longitude) {
            const error: any = new Error("Coordinates required");
            error.statusCode = 400;
            throw error;
        }

        const updatedUser = await this.userModel.findByIdAndUpdate(
            userId,
            {
                location: {
                    latitude: parseFloat(String(latitude)),
                    longitude: parseFloat(String(longitude)),
                    address: address || '',
                    city: city || '',
                    state: state || '',
                    country: country || '',
                    lastUpdated: new Date()
                }
            },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        return {
            userId: updatedUser._id,
            location: updatedUser.location
        };
    }

    /**
     * Service: Get saved location for user
     */
    public async getUserLocation(userId: string): Promise<any> {
        const user = await this.userModel.findById(userId).select('location role firstname lastname');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        return {
            userId: user._id,
            role: user.role,
            name: `${user.firstname} ${user.lastname}`,
            location: user.location || null
        };
    }

    /**
     * Service: Get user saved experiences
     */
    public async getSavedExperiences(userId: string): Promise<any[]> {
        const userExists = await this.userModel.exists({ _id: userId });
        if (!userExists) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const savedDocs = await this.savedExperienceModel.find({ user: userId })
            .sort({ createdAt: -1 })
            .populate({
                path: "experience",
                populate: {
                    path: "user",
                    select: "firstname lastname avatar"
                }
            });

        return savedDocs.map((s: any) => s.experience).filter(Boolean);
    }

    /**
     * Service: Add experience to user saved experiences
     */
    public async addSavedExperience(userId: string, experienceId: string): Promise<boolean> {
        const userExists = await this.userModel.exists({ _id: userId });
        if (!userExists) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const existing = await this.savedExperienceModel.findOne({
            user: userId,
            experience: experienceId
        });
        if (!existing) {
            await this.savedExperienceModel.create({ user: userId, experience: experienceId });
            return true;
        }
        return false;
    }

    /**
     * Service: Remove experience from user saved experiences
     */
    public async removeSavedExperience(userId: string, experienceId: string): Promise<boolean> {
        const userExists = await this.userModel.exists({ _id: userId });
        if (!userExists) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const result = await this.savedExperienceModel.deleteOne({
            user: userId,
            experience: experienceId
        });
        return result.deletedCount > 0;
    }



    /**
     * Service: Get user profile with posts and ratings
     */
    public async getProfile(
        userId: string,
        page: number | string = 1,
        limit: number | string = 12,
        currentUserId?: string,
        currentUserRole?: string
    ): Promise<any> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            const error: any = new Error("Invalid user ID format");
            error.statusCode = 400;
            throw error;
        }

        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 12;
        const skip = (pageNum - 1) * limitNum;

        const user = await this.userModel.findById(userId).select('-password');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const isOwner = currentUserId && String(currentUserId) === String(userId);
        const baseQuery: any = { user: userId, status: 'active' };
        if (!isOwner) {
            baseQuery.isHidden = { $ne: true };
        }

        const totalExperiences = await this.experienceModel.countDocuments(baseQuery);
        const experiences = await this.experienceModel.find(baseQuery)
            .populate('user', 'firstname lastname avatar role username isHostVerified verifiedBadge')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const experienceStats = {
            total: totalExperiences,
            experiences: totalExperiences
        };

        const totalPages = Math.ceil(totalExperiences / limitNum);

        let reviews: any[] = [];
        let reviewStats: any = null;
        if (user.role === 'host') {
            const stats = await this.reviewService.calculateHostReviewStats(userId, currentUserId);
            reviews = stats.reviews.slice(0, 10);
            reviewStats = stats.reviewStats;
        }

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
        const userData = await this.getUserFields(user, isOwnProfileOrAdmin);

        const { isFriend, isRequestedFriend } = await this.getFriendshipStatus(user, currentUserIdStr);
        userData.isFriend = isFriend;
        userData.isRequestedFriend = isRequestedFriend;

        return {
            user: userData,
            experienceStats,
            experiences,
            pagination: {
                totalExperiences,
                totalPages,
                currentPage: pageNum,
                limit: limitNum
            },
            reviews: user.role === 'host' ? reviews : undefined,
            reviewStats: user.role === 'host' ? reviewStats : undefined
        };
    }

    /**
     * Service: Get complete profile with categorized experiences and stats
     */
    public async getCompleteProfile(
        userId: string,
        currentUserId?: string,
        currentUserRole?: string
    ): Promise<any> {
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            const error: any = new Error("Invalid user ID format");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findById(userId).select('-password');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const experiences = await this.experienceModel.find({ user: userId, status: 'active' }).sort({ createdAt: -1 });

        const reviewsWritten = await this.reviewService.getWrittenReviewsForProfile(userId);

        let reviewsReceived: any[] = [];
        let reviewStats: any = null;
        if (user.role === 'host') {
            const stats = await this.reviewService.calculateHostReviewStats(userId, currentUserId);
            reviewsReceived = stats.reviews;
            reviewStats = stats.reviewStats;
        }

        const stats = {
            experiences: { total: experiences.length },
            reviews: { written: reviewsWritten.length, received: reviewsReceived.length }
        };

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
        const userData = await this.getUserFields(user, isOwnProfileOrAdmin);

        const { isFriend, isRequestedFriend } = await this.getFriendshipStatus(user, currentUserIdStr);
        userData.isFriend = isFriend;
        userData.isRequestedFriend = isRequestedFriend;

        return {
            user: userData,
            stats,
            experiences,
            reviews: { written: reviewsWritten, received: user.role === 'host' ? reviewsReceived : [] },
            reviewStats: user.role === 'host' ? reviewStats : null
        };
    }

    /**
     * Service: Get top rated hosts with calculated review averages
     */
    public async getTopRatedHosts(
        limit: number | string = 100,
        page: number | string = 1,
        minRating: number | string = 0,
        location?: string
    ): Promise<any> {
        const ratingValue = Number(minRating);
        const limitValue = Number(limit);
        const skipValue = (Number(page) - 1) * limitValue;

        const hostMatch: any = {
            role: 'host'
        };

        if (location && location.trim()) {
            const locRegex = new RegExp(location.trim(), 'i');
            hostMatch.$or = [
                { 'location.city': locRegex },
                { 'location.state': locRegex },
                { 'location.country': locRegex },
                { 'location.address': locRegex }
            ];
        }

        const topRatedHosts = await this.userModel.aggregate([
            { $match: hostMatch },
            {
                $lookup: {
                    from: 'hostdetails',
                    localField: '_id',
                    foreignField: 'user',
                    as: 'hostDetailsDoc'
                }
            },
            { $unwind: '$hostDetailsDoc' },
            { $match: { 'hostDetailsDoc.status': 'approved' } },
            {
                $lookup: {
                    from: 'reviews',
                    localField: '_id',
                    foreignField: 'host',
                    as: 'hostReviews'
                }
            },
            {
                $addFields: {
                    averageRating: { $ifNull: [{ $avg: '$hostReviews.rating' }, 0] },
                    reviewCount: { $size: '$hostReviews' },
                    hasReviews: { $cond: [{ $gt: [{ $size: '$hostReviews' }, 0] }, 1, 0] },
                    latestReviewDate: { $ifNull: [{ $max: '$hostReviews.createdAt' }, new Date(0)] },
                    hostDetails: '$hostDetailsDoc',
                    verifyBadge: '$hostDetailsDoc.verifyBadge',
                    hostStatus: '$hostDetailsDoc.status'
                }
            },
            { $match: { averageRating: { $gte: ratingValue } } },
            { $sort: { hasReviews: -1, averageRating: -1, reviewCount: -1, latestReviewDate: -1, _id: 1 } },
            { $skip: skipValue },
            { $limit: limitValue },
            {
                $lookup: {
                    from: 'posts',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$user', '$$userId'] }, status: 'active', isHidden: { $ne: true } } },
                        { $project: { _id: 1, title: 1, photos: { $slice: ['$photos', 1] }, price: 1, location: 1 } },
                        { $limit: 3 }
                    ],
                    as: 'experiences'
                }
            },
            {
                $project: {
                    _id: 1, firstname: 1, lastname: 1, email: 1,
                    role: 1, isVerified: 1, location: 1, avatar: 1,
                    verifyBadge: 1,
                    hostStatus: 1,
                    hostDetails: {
                        yearsOfExperience: '$hostDetails.yearsOfExperience',
                        city: '$hostDetails.city',
                        district: '$hostDetails.district',
                        state: '$hostDetails.state',
                        pincode: '$hostDetails.pincode'
                    },
                    averageRating: { $round: ['$averageRating', 1] },
                    reviewCount: 1,
                    totalExperiences: { $size: '$experiences' },
                    experiences: 1
                }
            }
        ]);

        let totalHostsCount = 0;
        if (location && location.trim()) {
            const countAgg = await this.userModel.aggregate([
                { $match: hostMatch },
                {
                    $lookup: {
                        from: 'hostdetails',
                        localField: '_id',
                        foreignField: 'user',
                        as: 'hostDetailsDoc'
                    }
                },
                { $unwind: '$hostDetailsDoc' },
                { $match: { 'hostDetailsDoc.status': 'approved' } },
                { $count: 'total' }
            ]);
            totalHostsCount = countAgg.length > 0 ? countAgg[0].total : 0;
        } else {
            totalHostsCount = await this.hostDetailsModel.countDocuments({ status: 'approved' });
        }

        return {
            count: topRatedHosts.length,
            total: totalHostsCount,
            page: Number(page),
            totalPages: Math.ceil(totalHostsCount / limitValue) || 1,
            hosts: topRatedHosts
        };
    }

    /**
     * Service: Update user profile (guest or host)
     */
    public async updateProfile(userId: string, profileData: any): Promise<any> {
        const {
            firstname, lastname, description, removeAvatar, interests, avatarUrl, avatarPublicId,
            phone, physicalAddress, pincode, existingAadhaar, city, district, state, yearsOfExperience,
            locationCity, locationState, country, locationCountry, address, locationAddress, aadhaar
        } = profileData;

        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const hostDoc = user.role === "host" ? await this.hostDetailsModel.findOne({ user: userId }) : null;

        // Rule 1: Unverified hosts cannot update any profile details
        if (user.role === "host" && (!hostDoc || hostDoc.status !== "approved")) {
            const error: any = new Error("You cannot update your profile until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval.");
            error.statusCode = 400;
            error.isUnverifiedHost = true;
            throw error;
        }

        const currentDetails = hostDoc || {};
        const isYearsSupplied = yearsOfExperience !== undefined && yearsOfExperience !== null && yearsOfExperience !== "" && !isNaN(parseInt(yearsOfExperience));
        let parsedYears = currentDetails.yearsOfExperience || 0;
        if (isYearsSupplied) {
            parsedYears = Math.min(30, Math.max(0, parseInt(yearsOfExperience, 10) || 0));
        }

        // Rule 2: Approved hosts — sensitive changes must be reviewed by admin
        if (user.role === "host" && hostDoc && hostDoc.status === "approved") {
            const isNameChanging = (firstname && (firstname || "").trim() !== (user.firstname || "").trim()) ||
                                   (lastname && (lastname || "").trim() !== (user.lastname || "").trim());
            const isDescriptionChanging = description !== undefined && (description || "").trim() !== (user.description || "").trim();
            let isAvatarChanging = false;
            if (removeAvatar === "true" || removeAvatar === true) {
                if (user.avatar && user.avatar.url) isAvatarChanging = true;
            } else if (avatarUrl && (!user.avatar || user.avatar.url !== avatarUrl)) {
                isAvatarChanging = true;
            }

            let parsedExisting: any[] = [];
            if (existingAadhaar) {
                parsedExisting = parseIfJson(existingAadhaar) || (Array.isArray(existingAadhaar) ? existingAadhaar : [existingAadhaar]);
            }
            let newAadhaar: any[] = [];
            if (aadhaar) {
                newAadhaar = Array.isArray(aadhaar) ? aadhaar : (parseIfJson(aadhaar) || []);
            }
            const rawProposed = [...(Array.isArray(parsedExisting) ? parsedExisting : [parsedExisting]), ...(Array.isArray(newAadhaar) ? newAadhaar : [newAadhaar])];
            const proposedAadhaar = rawProposed.map((item: any) => {
                if (typeof item === 'string') {
                    return { url: item, public_id: '' };
                }
                if (item && typeof item === 'object') {
                    return {
                        url: item.url || item.fileUrl || '',
                        public_id: item.public_id || item.key || ''
                    };
                }
                return null;
            }).filter((item: any) => item && item.url);

            let isVerifChanging = false;
            const hasYearsChanging = isYearsSupplied && parsedYears !== (currentDetails.yearsOfExperience || 0);
            if (hasYearsChanging) isVerifChanging = true;
            if (phone !== undefined && phone.trim() !== '' && phone.trim() !== (currentDetails.phone || '').trim()) {
                const normPhone = normalizePhoneNumber(phone);
                const normTemp = normalizePhoneNumber(currentDetails.tempVerifiedPhone || '');
                if (!normTemp || normPhone !== normTemp) {
                    const error: any = new Error("Please verify your updated phone number first using OTP");
                    error.statusCode = 400;
                    throw error;
                }
                isVerifChanging = true;
            }
            if (physicalAddress !== undefined && physicalAddress.trim() !== '' && physicalAddress.trim() !== (currentDetails.physicalAddress || '').trim()) isVerifChanging = true;
            if (pincode !== undefined && pincode.trim() !== '' && pincode.trim() !== (currentDetails.pincode || '').trim()) isVerifChanging = true;
            if (city !== undefined && city.trim() !== '' && city.trim() !== (currentDetails.city || '').trim()) isVerifChanging = true;
            if (district !== undefined && district.trim() !== '' && district.trim() !== (currentDetails.district || '').trim()) isVerifChanging = true;
            if (state !== undefined && state.trim() !== '' && state.trim() !== (currentDetails.state || '').trim()) isVerifChanging = true;

            const currentAadhaar = currentDetails.aadhaarCard || [];
            if (proposedAadhaar.length > 0 && proposedAadhaar.length !== currentAadhaar.length) {
                isVerifChanging = true;
            } else if (proposedAadhaar.length > 0) {
                for (let i = 0; i < proposedAadhaar.length; i++) {
                    if (proposedAadhaar[i].url !== currentAadhaar[i]?.url || proposedAadhaar[i].public_id !== currentAadhaar[i]?.public_id) {
                        isVerifChanging = true;
                        break;
                    }
                }
            }

            const isAnyModified = isNameChanging || isDescriptionChanging || isAvatarChanging || isVerifChanging;

            if (isAnyModified) {
                const pendingUpdates: any = {
                    firstname: firstname || user.firstname,
                    lastname: lastname || user.lastname,
                    description: description !== undefined ? description : user.description,
                    yearsOfExperience: hasYearsChanging ? parsedYears : (currentDetails.yearsOfExperience || 0),
                    phone: phone !== undefined && phone.trim() !== '' ? phone.trim() : currentDetails.phone,
                    physicalAddress: physicalAddress !== undefined && physicalAddress.trim() !== '' ? physicalAddress.trim() : currentDetails.physicalAddress,
                    pincode: pincode !== undefined && pincode.trim() !== '' ? pincode.trim() : currentDetails.pincode,
                    city: city !== undefined && city.trim() !== '' ? city.trim() : currentDetails.city,
                    district: district !== undefined && district.trim() !== '' ? district.trim() : currentDetails.district,
                    state: state !== undefined && state.trim() !== '' ? state.trim() : currentDetails.state,
                };

                if (removeAvatar === "true" || removeAvatar === true) {
                    pendingUpdates.avatar = null;
                } else if (avatarUrl) {
                    pendingUpdates.avatar = { url: avatarUrl, public_id: avatarPublicId };
                } else {
                    pendingUpdates.avatar = user.avatar;
                }

                if (proposedAadhaar.length > 0) {
                    pendingUpdates.aadhaarCard = proposedAadhaar;
                } else if (currentDetails.aadhaarCard && currentDetails.aadhaarCard.length > 0) {
                    pendingUpdates.aadhaarCard = currentDetails.aadhaarCard;
                }

                await this.hostDetailsModel.findOneAndUpdate(
                    { user: user._id },
                    {
                        $set: { pendingHostDetails: pendingUpdates },
                        $unset: { tempVerifiedPhone: 1 }
                    }
                );

                if (interests !== undefined) {
                    user.interests = this.parseInterests(interests);
                    await user.save();
                }

                // Send email notification to admin using renderDocumentListHtml
                const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
                const adminSubject = `Host Profile Update Review Request - Athithya`;
                const hostname = `${user.firstname} ${user.lastname}`;
                const docListHtml = renderDocumentListHtml(pendingUpdates.aadhaarCard);

                this.emailNotifier({
                    to: adminEmail,
                    subject: adminSubject,
                    templateName: "admin-host-profile-update",
                    data: {
                        hostname,
                        email: user.email,
                        phone: pendingUpdates.phone || "N/A",
                        address: pendingUpdates.physicalAddress || "N/A",
                        city: pendingUpdates.city || "N/A",
                        district: pendingUpdates.district || "N/A",
                        state: pendingUpdates.state || "N/A",
                        pincode: pendingUpdates.pincode || "N/A",
                        docListHtml
                    }
                }).catch((err: any) => console.error("Failed to send admin host profile update verification email:", err));

                // Notify admins via centralized NotificationService
                try {
                    await notificationService.notifyAdmins({
                        senderId: user._id,
                        title: "Host Profile Update Request",
                        message: `Host ${user.firstname} ${user.lastname} has requested to update verification details.`,
                        type: 'info',
                        link: `/admin`,
                        metadata: { userId: user._id }
                    });

                    notificationService.emitToAll("admin_new_verification_request", {
                        userId: user._id,
                        name: `${user.firstname} ${user.lastname}`,
                        isProfileUpdate: true
                    });
                } catch (notifErr: any) {
                    console.error("Failed to notify admins:", notifErr);
                }

                return {
                    isPendingReview: true,
                    message: "Your profile updates have been submitted to the admin panel for review. Once approved, your profile will be updated successfully.",
                    user: await this.getUserFields(user, true)
                };
            }
        }

        // Regular guest profile updates
        if (firstname) user.firstname = firstname;
        if (lastname) user.lastname = lastname;
        if (description !== undefined) user.description = description;

        const targetCity = city || locationCity;
        const targetState = state || locationState;
        const targetCountry = country || locationCountry;
        const targetAddress = address || locationAddress;

        if (targetCity !== undefined || targetState !== undefined || targetCountry !== undefined || targetAddress !== undefined) {
            if (!user.location) user.location = {};
            if (targetCity !== undefined) user.location.city = targetCity;
            if (targetState !== undefined) user.location.state = targetState;
            if (targetCountry !== undefined) user.location.country = targetCountry;
            if (targetAddress !== undefined) user.location.address = targetAddress;
            user.location.lastUpdated = new Date();
        }

        if (removeAvatar === "true" || removeAvatar === true) {
            if (user.avatar && user.avatar.public_id) {
                try { await this.fileDeleter(user.avatar.public_id); } catch (err) {}
            }
            user.avatar = undefined;
        } else if (avatarUrl) {
            if (user.avatar && user.avatar.public_id && user.avatar.public_id !== avatarPublicId) {
                try { await this.fileDeleter(user.avatar.public_id); } catch (err) {}
            }
            user.avatar = { url: avatarUrl, public_id: avatarPublicId };
        }

        if (interests !== undefined) {
            user.interests = this.parseInterests(interests);
        }

        await user.save();

        return {
            isPendingReview: false,
            message: "Profile updated successfully",
            user: await this.getUserFields(user, true)
        };
    }

    /**
     * Delete account and cascade delete all associated data across models and S3
     */
    public async deleteAccount(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        // 1. Delete Avatar from S3
        if (user.avatar && user.avatar.public_id) {
            try { await this.fileDeleter(user.avatar.public_id); } catch (err) {}
        }

        // 2. Delete Host Documents (Aadhaar) from S3
        const hostDoc = await this.hostDetailsModel.findOne({ user: userId });
        if (hostDoc?.aadhaarCard) {
            const docs = Array.isArray(hostDoc.aadhaarCard) ? hostDoc.aadhaarCard : [hostDoc.aadhaarCard];
            for (const doc of docs) {
                if (doc?.public_id) {
                    try { await this.fileDeleter(doc.public_id); } catch (err) {}
                }
            }
        }

        // 3. Delete all Experiences and their media from S3
        const userExperiences = await this.experienceModel.find({ user: userId });
        for (const exp of userExperiences) {
            if (exp.photos && Array.isArray(exp.photos)) {
                for (const img of exp.photos) {
                    if (img?.public_id) {
                        try { await this.fileDeleter(img.public_id); } catch (err) {}
                    }
                }
            }
            if (exp.videos && Array.isArray(exp.videos)) {
                for (const vid of exp.videos) {
                    if (vid?.public_id) {
                        try { await this.fileDeleter(vid.public_id); } catch (err) {}
                    }
                }
            }
        }
        await this.experienceModel.deleteMany({ user: userId });

        // 4. Delete Bookings (where user is host or guest)
        await this.bookingModel.deleteMany({ $or: [{ guest: userId }, { host: userId }] });

        // 5. Delete Reviews and recalculate affected experience ratings via ReviewService
        await this.reviewService.cleanupUserReviews(userId);

        // 6. Delete Notifications
        await this.notificationModel.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

        // 7. Delete Conversations and Messages
        const userConversations = await this.conversationModel.find({ participants: userId });
        for (const conv of userConversations) {
            await this.messageModel.deleteMany({ conversationId: conv._id });
        }
        await this.conversationModel.deleteMany({ participants: userId });

        // 8. Clean up social relationships, requests, bookmarks, pinned media, wishlist schedules, host details, host audit logs
        await Promise.all([
            this.friendshipModel.deleteMany({ $or: [{ user: userId }, { friend: userId }] }),
            this.friendRequestModel.deleteMany({ $or: [{ sender: userId }, { recipient: userId }] }),
            this.savedExperienceModel.deleteMany({ user: userId }),
            this.pinnedExperienceMediaModel.deleteMany({ user: userId }),
            this.wishlistScheduleModel.deleteMany({ user: userId }),
            this.hostDetailsModel.deleteOne({ user: userId }),
            this.hostAuditLogModel.deleteMany({ hostId: userId })
        ]);

        // 9. Finally, delete the user record
        await this.userModel.findByIdAndDelete(userId);
    }
}

export const profileService = ProfileService.getInstance();
export default ProfileService;
