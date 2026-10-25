import mongoose from "mongoose";
import { User, Post, Review, Notification, HostHistory } from "../../db/mongoose";
import { deleteFile } from "../storageService";
import { parseIfJson } from "../posts/postPayloadParser";
import { sendTemplateEmail } from "../emailService";
import { notificationService } from "../notificationService";
import { normalizePhoneNumber, renderDocumentListHtml } from "./verificationService";

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
    private postModel: any;
    private reviewModel: any;
    private notificationModel: any;
    private hostHistoryModel: any;
    private fileDeleter: (key: string) => Promise<any>;
    private emailNotifier: (options: any) => Promise<any>;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        postModel: any = Post,
        reviewModel: any = Review,
        notificationModel: any = Notification,
        hostHistoryModel: any = HostHistory,
        fileDeleter: (key: string) => Promise<any> = deleteFile,
        emailNotifier: (options: any) => Promise<any> = sendTemplateEmail
    ) {
        if (instanceKey !== ProfileService.instanceKey) {
            throw new Error("Please use ProfileService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.postModel = postModel;
        this.reviewModel = reviewModel;
        this.notificationModel = notificationModel;
        this.hostHistoryModel = hostHistoryModel;
        this.fileDeleter = fileDeleter;
        this.emailNotifier = emailNotifier;
    }

    public static getInstance(
        userModel?: any,
        postModel?: any,
        reviewModel?: any,
        notificationModel?: any,
        hostHistoryModel?: any,
        fileDeleter?: (key: string) => Promise<any>,
        emailNotifier?: (options: any) => Promise<any>
    ): ProfileService {
        if (!this.instance) {
            this.instance = new ProfileService(
                this.instanceKey,
                userModel,
                postModel,
                reviewModel,
                notificationModel,
                hostHistoryModel,
                fileDeleter,
                emailNotifier
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
     * Helper: Determine mutual friendship and pending request status
     */
    private getFriendshipStatus(user: any, currentUserIdStr?: string): { isFriend: boolean; isRequestedFriend: boolean } {
        if (!currentUserIdStr || user._id.toString() === currentUserIdStr) {
            return { isFriend: false, isRequestedFriend: false };
        }
        const isFriend = (user.friends || []).some((id: any) => id && id.toString() === currentUserIdStr);
        const isRequestedFriend = (user.friendRequests || []).some((id: any) => id && id.toString() === currentUserIdStr);
        return { isFriend, isRequestedFriend };
    }

    /**
     * Helper: Calculate host review statistics, distribution, and current user rating
     */
    public async calculateHostReviewStats(hostId: string, currentUserId?: string): Promise<{
        reviews: any[];
        reviewStats: any;
    }> {
        const hostObjectId = new mongoose.Types.ObjectId(hostId);
        const allHostReviews = await this.reviewModel.find({ host: hostId })
            .populate('reviewer', 'firstname lastname avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 });

        const writtenReviews = allHostReviews.filter((r: any) => r.comment && r.comment.trim() !== "");

        const totalStats = await this.reviewModel.aggregate([
            { $match: { host: hostObjectId } },
            { $group: { _id: '$host', average: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);

        let reviewStats: any = null;
        if (totalStats.length > 0) {
            const avg = totalStats[0].average || 0;
            const currentUserIdStr = currentUserId?.toString();
            const userRatingObj = currentUserIdStr
                ? await this.reviewModel.findOne({ host: hostId, reviewer: currentUserIdStr, post: null })
                : null;

            reviewStats = {
                totalRatings: totalStats[0].count,
                totalReviews: writtenReviews.length,
                averageRating: Number(avg.toFixed(1)),
                currentUserRating: userRatingObj ? userRatingObj.rating : null,
                ratings: {
                    5: allHostReviews.filter((r: any) => r.rating === 5).length,
                    4: allHostReviews.filter((r: any) => r.rating === 4).length,
                    3: allHostReviews.filter((r: any) => r.rating === 3).length,
                    2: allHostReviews.filter((r: any) => r.rating === 2).length,
                    1: allHostReviews.filter((r: any) => r.rating === 1).length
                }
            };
        }

        return { reviews: writtenReviews, reviewStats };
    }

    /**
     * Record host's previous details to HostHistory collection (scoped per host)
     */
    public async saveHostOldDetails(user: any, changedFields: string[] = []): Promise<void> {
        try {
            if (!user || user.role !== "host") return;
            const hostName = `${user.firstname} ${user.lastname}`;
            await this.hostHistoryModel.create({
                type: "profile_update",
                hostId: user._id,
                hostName: hostName,
                changedFields: changedFields,
                avatarUrl: user.avatar?.url || "",
                physicalAddress: user.hostDetails?.physicalAddress || "",
                city: user.hostDetails?.city || "",
                district: user.hostDetails?.district || "",
                state: user.hostDetails?.state || "",
                pincode: user.hostDetails?.pincode || "",
                phone: user.hostDetails?.phone || "",
                email: user.email || "",
                aadhaarCard: user.hostDetails?.aadhaarCard || []
            });

            // Prune to only keep last 10 entries per host
            const items = await this.hostHistoryModel.find({ hostId: user._id, type: "profile_update" }).sort({ createdAt: -1 });
            if (items.length > 10) {
                const idsToDelete = items.slice(10).map((item: any) => item._id);
                await this.hostHistoryModel.deleteMany({ _id: { $in: idsToDelete } });
            }
        } catch (err) {
            console.error("Error saving host old details to history:", err);
        }
    }

    /**
     * Format user response fields based on requester authorization
     */
    public getUserFields(user: any, isOwnProfileOrAdmin: boolean = false): any {
        let hostDetails = user.hostDetails
            ? (typeof user.hostDetails.toObject === 'function' ? user.hostDetails.toObject() : JSON.parse(JSON.stringify(user.hostDetails)))
            : undefined;
        let pendingHostDetails = user.pendingHostDetails
            ? (typeof user.pendingHostDetails.toObject === 'function' ? user.pendingHostDetails.toObject() : JSON.parse(JSON.stringify(user.pendingHostDetails)))
            : undefined;

        if (!isOwnProfileOrAdmin) {
            if (hostDetails) {
                delete hostDetails.aadhaarCard;
            }
            if (pendingHostDetails) {
                delete pendingHostDetails.aadhaarCard;
            }
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
            hostStatus: user.hostStatus,
            hostDetails: hostDetails,
            pendingHostDetails: pendingHostDetails,
            location: user.location,
            activeGridTab: user.activeGridTab || "experience",
            friendsCount: (user.friends || []).filter(Boolean).length,
            interests: user.interests || [],
            walletBalance: isOwnProfileOrAdmin ? (user.walletBalance || 0) : undefined,
            savedPosts: isOwnProfileOrAdmin ? (user.savedPosts || []) : undefined,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
    }

    /**
     * Service: Fetch a user by ID
     */
    public async getUserById(targetUserId: string, currentUserId?: string, currentUserRole?: string): Promise<any> {
        const user = await this.userModel.findById(targetUserId).select('-password -otp -otpExpires');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === targetUserId || currentUserRole === 'admin'));
        const { isFriend: isFollowing, isRequestedFriend: isRequested } = this.getFriendshipStatus(user, currentUserIdStr);

        const userData = this.getUserFields(user, isOwnProfileOrAdmin);
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
     * Service: Get user saved posts
     */
    public async getSavedPosts(userId: string): Promise<any[]> {
        const user = await this.userModel.findById(userId).populate({
            path: "savedPosts",
            populate: {
                path: "user",
                select: "firstname lastname avatar"
            }
        });

        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        return user.savedPosts || [];
    }

    /**
     * Service: Add post to user saved posts
     */
    public async addSavedPost(userId: string, postId: string): Promise<boolean> {
        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }
        const alreadySaved = user.savedPosts?.some((p: any) => p.toString() === postId.toString());
        if (!alreadySaved) {
            await this.userModel.findByIdAndUpdate(userId, { $addToSet: { savedPosts: postId } });
            return true;
        }
        return false;
    }

    /**
     * Service: Remove post from user saved posts
     */
    public async removeSavedPost(userId: string, postId: string): Promise<boolean> {
        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }
        const alreadySaved = user.savedPosts?.some((p: any) => p.toString() === postId.toString());
        if (alreadySaved) {
            await this.userModel.findByIdAndUpdate(userId, { $pull: { savedPosts: postId } });
            return true;
        }
        return false;
    }

    /**
     * Service: Calculate host rating statistics (average and count)
     */
    public async getHostRating(hostId: string): Promise<{ average: number; count: number }> {
        if (!hostId) return { average: 0, count: 0 };
        const hostObjectId = new mongoose.Types.ObjectId(hostId);
        const hostPosts = await this.postModel.find({ user: hostObjectId }).select('_id');
        const hostPostIds = hostPosts.map((p: any) => p._id);
        const baseMatch = hostPostIds.length > 0
            ? { $or: [{ host: hostObjectId }, { post: { $in: hostPostIds } }] }
            : { host: hostObjectId };

        const hostStats = await this.reviewModel.aggregate([
            { $match: baseMatch },
            { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);
        if (hostStats.length > 0) {
            return {
                average: Math.round(hostStats[0].average * 10) / 10,
                count: hostStats[0].count
            };
        }
        return { average: 0, count: 0 };
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

        const user = await this.userModel.findById(userId).select('-password -otp -otpExpires');
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

        const totalPosts = await this.postModel.countDocuments(baseQuery);
        const posts = await this.postModel.find(baseQuery)
            .populate('user', 'firstname lastname avatar role username isHostVerified verifiedBadge')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const postCounts = await this.postModel.aggregate([
            { $match: baseQuery },
            { $group: { _id: '$postType', count: { $sum: 1 } } }
        ]);
        const postCountsMap = new Map(postCounts.map((c: any) => [c._id, c.count]));

        const postStats = {
            total: totalPosts,
            experiences: postCountsMap.get('experience') || 0,
            services: postCountsMap.get('service') || 0,
            treks: postCountsMap.get('trek') || 0,
            plans: postCountsMap.get('plan') || 0
        };

        const totalPages = Math.ceil(totalPosts / limitNum);

        let reviews: any[] = [];
        let reviewStats: any = null;
        if (user.role === 'host') {
            const stats = await this.calculateHostReviewStats(userId, currentUserId);
            reviews = stats.reviews.slice(0, 10);
            reviewStats = stats.reviewStats;
        }

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
        const userData = this.getUserFields(user, isOwnProfileOrAdmin);

        const { isFriend, isRequestedFriend } = this.getFriendshipStatus(user, currentUserIdStr);
        userData.isFriend = isFriend;
        userData.isRequestedFriend = isRequestedFriend;

        return {
            user: userData,
            postStats,
            posts,
            pagination: {
                totalPosts,
                totalPages,
                currentPage: pageNum,
                limit: limitNum
            },
            reviews: user.role === 'host' ? reviews : undefined,
            reviewStats: user.role === 'host' ? reviewStats : undefined
        };
    }

    /**
     * Service: Get complete profile with categorized posts and stats
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

        const user = await this.userModel.findById(userId).select('-password -otp -otpExpires');
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        const posts = await this.postModel.find({ user: userId, status: 'active' }).sort({ createdAt: -1 });
        const experiences = posts.filter((p: any) => p.postType === 'experience');
        const services = posts.filter((p: any) => p.postType === 'service');
        const treks = posts.filter((p: any) => p.postType === 'trek');
        const plans = posts.filter((p: any) => p.postType === 'plan');
        const itineraries = plans;

        const reviewsWritten = await this.reviewModel.find({ reviewer: userId, comment: { $exists: true, $ne: "" } })
            .populate('host', 'firstname lastname avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 });

        let reviewsReceived: any[] = [];
        let reviewStats: any = null;
        if (user.role === 'host') {
            const stats = await this.calculateHostReviewStats(userId, currentUserId);
            reviewsReceived = stats.reviews;
            reviewStats = stats.reviewStats;
        }

        const stats = {
            posts: { total: posts.length, experiences: experiences.length, services: services.length, treks: treks.length, plans: plans.length },
            itineraries: { total: plans.length },
            reviews: { written: reviewsWritten.length, received: reviewsReceived.length }
        };

        const currentUserIdStr = currentUserId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
        const userData = this.getUserFields(user, isOwnProfileOrAdmin);

        const { isFriend, isRequestedFriend } = this.getFriendshipStatus(user, currentUserIdStr);
        userData.isFriend = isFriend;
        userData.isRequestedFriend = isRequestedFriend;

        return {
            user: userData,
            stats,
            posts: { all: posts, experiences, services, treks, plans },
            itineraries,
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
            role: 'host',
            hostStatus: 'approved'
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
                    latestReviewDate: { $ifNull: [{ $max: '$hostReviews.createdAt' }, new Date(0)] }
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
                    as: 'posts'
                }
            },
            {
                $project: {
                    _id: 1, firstname: 1, lastname: 1, email: 1,
                    role: 1, isVerified: 1, location: 1, avatar: 1,
                    verifyBadge: 1,
                    hostDetails: 1,
                    averageRating: { $round: ['$averageRating', 1] },
                    reviewCount: 1,
                    totalPosts: { $size: '$posts' },
                    posts: 1
                }
            }
        ]);

        const totalHostsCount = await this.userModel.countDocuments(hostMatch);

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

        // Rule 1: Unverified hosts cannot update any profile details
        if (user.role === "host" && user.hostStatus !== "approved") {
            const error: any = new Error("You cannot update your profile until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval.");
            error.statusCode = 400;
            error.isUnverifiedHost = true;
            throw error;
        }

        const currentDetails = user.hostDetails || {};
        const isYearsSupplied = yearsOfExperience !== undefined && yearsOfExperience !== null && yearsOfExperience !== "" && !isNaN(parseInt(yearsOfExperience));
        let parsedYears = currentDetails.yearsOfExperience || 0;
        if (isYearsSupplied) {
            parsedYears = Math.min(30, Math.max(0, parseInt(yearsOfExperience, 10) || 0));
        }

        // Rule 2: Approved hosts — sensitive changes must be reviewed by admin
        if (user.role === "host" && user.hostStatus === "approved") {
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
                if (!user.pendingHostDetails) {
                    user.pendingHostDetails = {};
                }
                user.pendingHostDetails.firstname = firstname || user.firstname;
                user.pendingHostDetails.lastname = lastname || user.lastname;
                user.pendingHostDetails.description = description !== undefined ? description : user.description;

                if (removeAvatar === "true" || removeAvatar === true) {
                    user.pendingHostDetails.avatar = null;
                } else if (avatarUrl) {
                    user.pendingHostDetails.avatar = { url: avatarUrl, public_id: avatarPublicId };
                } else {
                    user.pendingHostDetails.avatar = user.avatar;
                }

                user.pendingHostDetails.yearsOfExperience = hasYearsChanging ? parsedYears : (currentDetails.yearsOfExperience || 0);
                user.pendingHostDetails.phone = phone !== undefined && phone.trim() !== '' ? phone.trim() : currentDetails.phone;
                user.pendingHostDetails.physicalAddress = physicalAddress !== undefined && physicalAddress.trim() !== '' ? physicalAddress.trim() : currentDetails.physicalAddress;
                user.pendingHostDetails.pincode = pincode !== undefined && pincode.trim() !== '' ? pincode.trim() : currentDetails.pincode;
                user.pendingHostDetails.city = city !== undefined && city.trim() !== '' ? city.trim() : currentDetails.city;
                user.pendingHostDetails.district = district !== undefined && district.trim() !== '' ? district.trim() : currentDetails.district;
                user.pendingHostDetails.state = state !== undefined && state.trim() !== '' ? state.trim() : currentDetails.state;

                if (proposedAadhaar.length > 0) {
                    user.pendingHostDetails.aadhaarCard = proposedAadhaar;
                } else if (currentDetails.aadhaarCard && currentDetails.aadhaarCard.length > 0) {
                    user.pendingHostDetails.aadhaarCard = currentDetails.aadhaarCard;
                }

                if (user.hostDetails) {
                    user.hostDetails.tempVerifiedPhone = undefined;
                }

                if (interests !== undefined) {
                    user.interests = this.parseInterests(interests);
                }

                await user.save();

                // Send email notification to admin using renderDocumentListHtml
                const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
                const adminSubject = `Host Profile Update Review Request - Athithya`;
                const hostname = `${user.firstname} ${user.lastname}`;
                const docListHtml = renderDocumentListHtml(user.pendingHostDetails.aadhaarCard);

                this.emailNotifier({
                    to: adminEmail,
                    subject: adminSubject,
                    templateName: "admin-host-profile-update",
                    data: {
                        hostname,
                        email: user.email,
                        phone: user.pendingHostDetails.phone || "N/A",
                        address: user.pendingHostDetails.physicalAddress || "N/A",
                        city: user.pendingHostDetails.city || "N/A",
                        district: user.pendingHostDetails.district || "N/A",
                        state: user.pendingHostDetails.state || "N/A",
                        pincode: user.pendingHostDetails.pincode || "N/A",
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
                    user: this.getUserFields(user, true)
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
            user: this.getUserFields(user, true)
        };
    }
}

export const profileService = ProfileService.getInstance();
export default ProfileService;
