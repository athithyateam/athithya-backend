const { Post, User, Notification, HostHistory, Booking, Review } = require("../../db/mongoose");
const { storageService: defaultStorageService } = require("../storageService");
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
const { emailService: defaultEmailService } = require("../emailService");
import { notificationService } from "../notificationService";
const defaultNotifyAdmins = (reqOrApp: any, payload?: any) => {
    const opts = payload || reqOrApp;
    return notificationService.notifyAdmins(opts);
};
const { userService: defaultUserService } = require("../userService");
import { PostReactionService, postReactionService as defaultPostReactionService } from "./postReactionService";
import { 
    parsePostPayload, 
    calculatePricingAndFees, 
    isValidS3MediaUrl,
    parseIfJson, 
    calculateDistance, 
    buildCategoryFilter, 
    attachDistanceToTreks, 
    LISTING_CARD_PROJECTION 
} from "./postPayloadParser";

export interface GetPostsOptions {
    postType?: string;
    userRole?: string;
    city?: string;
    country?: string;
    state?: string;
    minPrice?: number | string;
    maxPrice?: number | string;
    status?: string;
    difficulty?: string;
    categories?: string | string[];
    isFeatured?: boolean | string;
    page?: number | string;
    limit?: number | string;
    sort?: string;
    postTypeFilter?: string | string[];
}

export interface PaginatedPostsResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    posts: any[];
}

export interface PostDetailResult {
    post: any;
    reviews: { count: number; data: any[] };
    similarPosts: any[];
}

export interface GetTopRatedTreksOptions {
    limit?: number | string;
    page?: number | string;
    minRating?: number | string;
}

export interface TopRatedTreksResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    treks: any[];
}

export interface GetNearbyTreksOptions {
    latitude?: string | number;
    longitude?: string | number;
    limit?: number | string;
    page?: number | string;
    difficulty?: string;
    minPrice?: number | string;
    maxPrice?: number | string;
    categories?: string | string[];
}

export interface NearbyTreksResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    treks: any[];
}

export interface GetPendingPostsOptions {
    postType?: string;
    page?: number | string;
    limit?: number | string;
}

export interface CategoryActivityResult {
    category: string;
    normalizedCategory: string;
    latestApprovedAt: Date | string;
    count: number;
    isNew: boolean;
}

export class PostActionService {
    private static instance: PostActionService | null = null;
    private static instanceKey = Symbol("PostActionServiceInstanceKey");

    private postModel: any;
    private userModel: any;
    private notificationModel: any;
    private hostHistoryModel: any;
    private bookingModel: any;
    private reviewModel: any;
    private storageService: any;
    private googleDriveService: any;
    private emailService: any;
    private adminNotifier: (reqOrApp: any, payload: any) => Promise<any>;
    private userService: any;
    private reactionService: PostReactionService;

    constructor(
        instanceKey: symbol,
        postModel: any = Post,
        userModel: any = User,
        notificationModel: any = Notification,
        hostHistoryModel: any = HostHistory,
        bookingModel: any = Booking,
        storageServiceInstance: any = defaultStorageService,
        googleDriveServiceInstance: any = defaultGoogleDriveService,
        emailServiceInstance: any = defaultEmailService,
        adminNotifier: (reqOrApp: any, payload: any) => Promise<any> = defaultNotifyAdmins,
        userServiceInstance: any = defaultUserService,
        reactionServiceInstance: PostReactionService = defaultPostReactionService,
        reviewModel: any = Review
    ) {
        if (instanceKey !== PostActionService.instanceKey) {
            throw new Error("Please use PostActionService.getInstance() to retrieve or create an instance");
        }
        this.postModel = postModel;
        this.userModel = userModel;
        this.notificationModel = notificationModel;
        this.hostHistoryModel = hostHistoryModel;
        this.bookingModel = bookingModel;
        this.storageService = storageServiceInstance;
        this.googleDriveService = googleDriveServiceInstance;
        this.emailService = emailServiceInstance;
        this.adminNotifier = adminNotifier;
        this.userService = userServiceInstance;
        this.reactionService = reactionServiceInstance;
        this.reviewModel = reviewModel;
    }

    public static getInstance(
        postModel?: any,
        userModel?: any,
        notificationModel?: any,
        hostHistoryModel?: any,
        bookingModel?: any,
        storageServiceInstance?: any,
        googleDriveServiceInstance?: any,
        emailServiceInstance?: any,
        adminNotifier?: (reqOrApp: any, payload: any) => Promise<any>,
        userServiceInstance?: any,
        reactionServiceInstance?: PostReactionService,
        reviewModel?: any
    ): PostActionService {
        if (!this.instance) {
            this.instance = new PostActionService(
                this.instanceKey,
                postModel,
                userModel,
                notificationModel,
                hostHistoryModel,
                bookingModel,
                storageServiceInstance,
                googleDriveServiceInstance,
                emailServiceInstance,
                adminNotifier,
                userServiceInstance,
                reactionServiceInstance,
                reviewModel
            );
        }
        return this.instance;
    }

    /**
     * Helper to process photos/videos (parsing JSON, checking S3 origin, uploading multer files)
     */
    private async processMediaInputs(
        rawPhotos: any,
        rawVideos: any,
        files: any = null,
        initialPhotos: any[] = [],
        initialVideos: any[] = []
    ): Promise<{ photos: any[]; videos: any[] }> {
        let photos = rawPhotos ? (parseIfJson(rawPhotos) || []) : [...initialPhotos];
        let videos = rawVideos ? (parseIfJson(rawVideos) || []) : [...initialVideos];

        if (photos.some((p: any) => !isValidS3MediaUrl(p)) || videos.some((v: any) => !isValidS3MediaUrl(v))) {
            const error: any = new Error("Invalid media URL. All photos and videos must be hosted on Athithya's S3 storage.");
            error.statusCode = 400;
            throw error;
        }

        if (files) {
            if (files["photos"]) {
                for (const file of files["photos"]) {
                    const result = await this.storageService.upload(file, "posts");
                    photos.push({ url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type || "image" });
                }
            }
            if (files["videos"]) {
                for (const file of files["videos"]) {
                    const result = await this.storageService.upload(file, "posts");
                    videos.push({ url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type || "video" });
                }
            }
        }

        return { photos, videos };
    }

    /**
     * Service: Create a new experience / post
     */
    public async createPost(
        userId: string,
        userRole: string,
        postPayload: any,
        files: any = null,
        reqOrApp: any = null
    ): Promise<any> {
        const hostUser = await this.userModel.findById(userId);
        if (!hostUser) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (userRole === "host" && hostUser.hostStatus !== "approved") {
            const error: any = new Error("You cannot add experiences until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval.");
            error.statusCode = 403;
            throw error;
        }

        if (!postPayload.title || !postPayload.description) {
            const error: any = new Error("Title and description are required");
            error.statusCode = 400;
            throw error;
        }

        const { photos, videos } = await this.processMediaInputs(postPayload.photos, postPayload.videos, files);
        const normalizedFields = parsePostPayload(postPayload);

        const postData = {
            ...normalizedFields,
            user: userId,
            userRole: userRole,
            postType: postPayload.postType || "experience",
            photos,
            videos,
            status: "pending"
        };

        const post = await this.postModel.create(postData);

        // Delegate Google Drive sync cleanly to googleDriveService without loop bloat
        setImmediate(async () => {
            const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
            const photosUpdated = await this.googleDriveService.syncMediaItems(post.photos, `EXP_${cleanTitle}_${post._id}_photo`, "experiences");
            const videosUpdated = await this.googleDriveService.syncMediaItems(post.videos, `EXP_${cleanTitle}_${post._id}_video`, "experiences", "video/mp4");
            if (photosUpdated || videosUpdated) {
                await this.postModel.findByIdAndUpdate(post._id, { photos: post.photos, videos: post.videos });
            }
        });

        // Notify Admin via email template and bell notification
        try {
            const hostname = `${hostUser.firstname} ${hostUser.lastname}`;
            const hostEmail = hostUser.email || "N/A";
            const adminSubject = `New Experience Awaiting Approval - Athithya`;

            let locationDetails = "N/A";
            if (post.location) {
                locationDetails = `${post.location.address || ""}<br/>${post.location.city || ""}, ${post.location.state || ""}, ${post.location.country || ""}`;
            }

            const { formattedDetails: priceDetails } = calculatePricingAndFees(post.price);

            const emailHtml = this.emailService.renderTemplate("admin-new-post-approval", {
                hostname,
                hostEmail,
                title: post.title,
                category: (post.categories || []).join(", ") || "N/A",
                locationDetails,
                priceDetails,
                description: post.description
            });

            await this.adminNotifier(reqOrApp, {
                senderId: userId,
                title: "New Experience Approval Request",
                message: `Host ${hostname} submitted "${post.title}" for approval.`,
                link: `/admin?reviewId=${post._id}`,
                type: "info",
                emailSubject: adminSubject,
                emailHtml,
                metadata: { postId: post._id, userId }
            });
        } catch (mailErr: any) {
            console.error("Error sending experience notification:", mailErr);
        }

        return post;
    }

    /**
     * Service: Update post details
     */
    public async updatePost(
        postId: string,
        userId: string,
        userRole: string,
        updatePayload: any,
        files: any = null,
        reqOrApp: any = null
    ): Promise<any> {
        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        if (post.user.toString() !== userId && userRole !== "admin") {
            const error: any = new Error("You can only edit your own posts");
            error.statusCode = 403;
            throw error;
        }

        const existingPhotos = parseIfJson(updatePayload.existingPhotos) || [];
        const existingVideos = parseIfJson(updatePayload.existingVideos) || [];

        const isLive = post.status === "active";
        const isHost = userRole !== "admin";

        // Clean up removed S3 media if admin or editing non-live post
        if (!isLive || !isHost) {
            const currentPhotoIds = existingPhotos.map((p: any) => p.public_id).filter(Boolean);
            for (const photo of (post.photos || [])) {
                if (photo.public_id && !currentPhotoIds.includes(photo.public_id)) {
                    await this.storageService.delete(photo.public_id);
                }
            }
            const currentVideoIds = existingVideos.map((v: any) => v.public_id).filter(Boolean);
            for (const video of (post.videos || [])) {
                if (video.public_id && !currentVideoIds.includes(video.public_id)) {
                    await this.storageService.delete(video.public_id);
                }
            }
        }

        const { photos, videos } = await this.processMediaInputs(
            updatePayload.photos,
            updatePayload.videos,
            files,
            existingPhotos,
            existingVideos
        );

        const normalizedFields = parsePostPayload(updatePayload, post);

        if (isHost && isLive) {
            post.pendingUpdate = {
                ...normalizedFields,
                photos,
                videos
            };
            await post.save();

            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

            const emailSubject = `Experience Update Submitted - ${post.title}`;
            const emailHtml = this.emailService.renderTemplate("admin-post-update-approval", {
                hostName,
                title: post.title
            });

            await this.adminNotifier(reqOrApp, {
                senderId: userId,
                title: "Experience Update Pending Approval",
                message: `Host ${hostName} submitted changes to "${post.title}" for your review.`,
                link: `/admin?reviewId=${post._id}`,
                type: "info",
                emailSubject,
                emailHtml,
                metadata: { postId: post._id, userId }
            });

            return {
                isPendingReview: true,
                message: "Changes submitted for admin approval. The experience remains active with original details.",
                post
            };
        } else {
            Object.assign(post, normalizedFields);
            post.photos = photos;
            post.videos = videos;

            if (isHost) {
                post.status = "pending";
            } else if (updatePayload.status) {
                post.status = updatePayload.status;
            }
            post.pendingUpdate = null;

            await post.save();

            if (isHost) {
                try {
                    const admins = await this.userModel.find({ role: "admin" });
                    const notifications = admins.map((admin: any) => ({
                        recipient: admin._id,
                        sender: userId,
                        title: "Experience Re-submitted for Approval",
                        message: `A host has updated and re-submitted "${post.title}" for your review.`,
                        type: "info",
                        link: `/admin?reviewId=${post._id}`,
                        metadata: { postId: post._id, userId }
                    }));
                    await this.notificationModel.insertMany(notifications);
                } catch (notifErr: any) {
                    console.error("Failed to notify admins about post re-submission:", notifErr);
                }
            }

            return {
                isPendingReview: false,
                message: "Post updated successfully",
                post
            };
        }
    }

    /**
     * Service: Update post status (e.g. approve pendingUpdate or change status)
     */
    public async updatePostStatus(postId: string, status: string, remarks?: string): Promise<any> {
        if (!["active", "inactive", "archived", "pending"].includes(status)) {
            const error: any = new Error("Invalid status");
            error.statusCode = 400;
            throw error;
        }

        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        if (status === "active") {
            if (post.pendingUpdate) {
                const oldPhotos = post.photos || [];
                const oldVideos = post.videos || [];
                const newPhotos = post.pendingUpdate.photos || [];
                const newVideos = post.pendingUpdate.videos || [];

                const newPhotoIds = newPhotos.map((p: any) => p.public_id).filter(Boolean);
                for (const photo of oldPhotos) {
                    if (photo.public_id && !newPhotoIds.includes(photo.public_id)) {
                        await this.storageService.delete(photo.public_id);
                    }
                }
                const newVideoIds = newVideos.map((v: any) => v.public_id).filter(Boolean);
                for (const video of oldVideos) {
                    if (video.public_id && !newVideoIds.includes(video.public_id)) {
                        await this.storageService.delete(video.public_id);
                    }
                }

                Object.assign(post, post.pendingUpdate);
                post.pendingUpdate = null;
            }
            post.status = "active";
            if (remarks !== undefined) post.remarks = remarks;
        } else {
            post.status = status;
            if (remarks !== undefined) post.remarks = remarks;
        }

        await post.save();
        return post;
    }

    /**
     * Service: Request hide or unhide of an experience
     */
    public async toggleHideExperience(
        postId: string,
        userId: string,
        userRole: string,
        action: string,
        reason: string = "",
        reqOrApp: any = null
    ): Promise<any> {
        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        if (post.user.toString() !== userId && userRole !== "admin") {
            const error: any = new Error("Not authorized to hide this experience");
            error.statusCode = 403;
            throw error;
        }

        if (action === "unhide") {
            post.isHidden = false;
            post.hideRequested = false;
            post.unhideRequested = false;
            post.hideReason = "";
            await post.save();

            return {
                message: "Experience unhidden successfully and is now active on the platform.",
                isHidden: false,
                hideRequested: false,
                unhideRequested: false
            };
        }

        if (!reason || !reason.trim()) {
            const error: any = new Error("Reason is required to hide an experience.");
            error.statusCode = 400;
            throw error;
        }

        post.hideRequested = true;
        post.unhideRequested = false;
        post.hideReason = reason.trim();
        await post.save();

        const hostUser = await this.userModel.findById(userId);
        const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

        const emailSubject = `Experience Hide Request - ${post.title}`;
        const emailHtml = this.emailService.renderTemplate("admin-post-hide-request", {
            hostName,
            title: post.title,
            reason: reason.trim()
        });

        await this.adminNotifier(reqOrApp, {
            senderId: userId,
            title: "Experience Hide Request",
            message: `Host ${hostName} requested to hide "${post.title}". Reason: "${reason.trim()}"`,
            link: `/admin?tab=approvals`,
            type: "info",
            emailSubject,
            emailHtml,
            metadata: { postId: post._id, userId }
        });

        return {
            message: "Request to hide experience submitted for admin review.",
            hideRequested: post.hideRequested,
            unhideRequested: false
        };
    }

    /**
     * Service: Delete experience (host request or admin permanent delete)
     */
    public async deletePost(
        postId: string,
        userId: string,
        userRole: string,
        reqOrApp: any = null
    ): Promise<{ success: boolean; message: string; pendingReview?: boolean }> {
        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        if (post.user.toString() !== userId && userRole !== "admin") {
            const error: any = new Error("You can only delete your own posts");
            error.statusCode = 403;
            throw error;
        }

        if (userRole !== "admin") {
            post.deleteRequested = true;
            await post.save();

            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

            const emailSubject = `Experience Deletion Request - ${post.title}`;
            const emailHtml = this.emailService.renderTemplate("admin-post-deletion-request", {
                hostName,
                title: post.title
            });

            await this.adminNotifier(reqOrApp, {
                senderId: userId,
                title: "Experience Deletion Request",
                message: `Host ${hostName} requested to delete experience "${post.title}".`,
                link: `/admin?tab=approvals`,
                type: "warning",
                emailSubject,
                emailHtml,
                metadata: { postId: post._id, userId }
            });

            return {
                success: true,
                message: "Deletion request submitted for review",
                pendingReview: true
            };
        }

        // Admin permanent deletion
        try {
            const hostUser = await this.userModel.findById(post.user);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Unknown Host";

            await this.hostHistoryModel.create({
                type: "experience_delete",
                hostId: post.user,
                hostName,
                experienceTitle: post.title || "",
                experienceSubtitle: post.subtitle || "",
                experienceDescription: post.description || "",
                experienceLongDescription: post.longDescription || "",
                experiencePrice: post.price,
                experienceDuration: post.duration,
                experienceLocation: post.location,
                experienceCapacity: post.capacity,
                experienceAmenities: post.amenities || [],
                experienceRules: post.privacyPolicy || [],
                experiencePhotos: post.photos || [],
                experienceCategories: post.categories || []
            });

            const items = await this.hostHistoryModel.find({ type: "experience_delete" }).sort({ createdAt: -1 });
            if (items.length > 10) {
                const idsToDelete = items.slice(10).map((item: any) => item._id);
                await this.hostHistoryModel.deleteMany({ _id: { $in: idsToDelete } });
            }
        } catch (historyErr: any) {
            console.error("Error logging deleted experience to history:", historyErr);
        }

        const assets = [...(post.photos || []), ...(post.videos || [])];
        for (const asset of assets) {
            if (asset.public_id) {
                await this.storageService.delete(asset.public_id);
            }
            if (asset.googleDriveFileId) {
                await this.googleDriveService.deleteMedia(asset.googleDriveFileId);
            }
        }

        await this.bookingModel.updateMany(
            { post: postId, status: { $in: ["pending", "accepted", "in_progress", "cancel_requested"] } },
            { $set: { status: "cancelled" } }
        );
        await this.postModel.findByIdAndDelete(postId);

        return {
            success: true,
            message: "Post deleted successfully"
        };
    }

    /**
     * Service: Save / Bookmark a post
     */
    public async savePost(postId: string, userId: string, userRole: string): Promise<{ success: boolean; message: string }> {
        if (userRole === 'host') {
            const error: any = new Error("Hosts cannot engage with another host's experience. Only guests can.");
            error.statusCode = 400;
            throw error;
        }

        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        const added = await this.userService.addSavedPost(userId, postId);
        if (added) {
            await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: 1 } });
        }

        return { success: true, message: "Post saved successfully" };
    }

    /**
     * Service: Unsave / Remove bookmark from a post
     */
    public async unsavePost(postId: string, userId: string): Promise<{ success: boolean; message: string }> {
        const removed = await this.userService.removeSavedPost(userId, postId);
        if (removed) {
            await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: -1 } });
        }

        return { success: true, message: "Post removed from saved list" };
    }

    /**
     * Service: Query posts with filters, pagination, and sorting
     */
    public async getPosts(options: GetPostsOptions = {}): Promise<PaginatedPostsResult> {
        const {
            postType, userRole, city, country, state, minPrice, maxPrice, status,
            difficulty, categories, isFeatured, page = 1, limit = 20, sort = 'latest',
            postTypeFilter
        } = options;

        const filter: any = {};
        if (postType) {
            if (postType.includes(',')) filter.postType = { $in: postType.split(',') };
            else filter.postType = postType;
        } else if (postTypeFilter) {
            if (Array.isArray(postTypeFilter)) filter.postType = { $in: postTypeFilter };
            else filter.postType = postTypeFilter;
        }

        if (userRole) filter.userRole = userRole;
        if (city) filter['location.city'] = new RegExp(city, 'i');
        if (state) filter['location.state'] = new RegExp(state, 'i');
        if (country) filter['location.country'] = new RegExp(country, 'i');
        filter.status = status || 'active';
        filter.isHidden = { $ne: true };

        if (difficulty) filter.difficulty = difficulty;
        if (categories) {
            const catFilter = buildCategoryFilter(categories);
            if (catFilter) filter.categories = catFilter;
        }
        if (isFeatured !== undefined) filter.isFeatured = isFeatured === 'true' || isFeatured === true;

        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const skip = (Number(page) - 1) * Number(limit);

        // One-by-one round-robin mix: Most Saved -> Most Booked -> Most Clicked -> 2nd Saved -> 2nd Booked -> 2nd Clicked...
        if (sort === 'bookings' || sort === 'loved') {
            const total = await this.postModel.countDocuments(filter);
            const neededLimit = skip + Number(limit);

            const [topSaved, topBooked, topClicked] = await Promise.all([
                this.postModel.find({ ...filter, savesCount: { $gt: 0 } })
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ savesCount: -1, createdAt: -1 })
                    .limit(neededLimit),
                this.postModel.find({ ...filter, bookingCount: { $gt: 0 } })
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ bookingCount: -1, createdAt: -1 })
                    .limit(neededLimit),
                this.postModel.find(filter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ clicks: -1, createdAt: -1 })
                    .limit(neededLimit)
            ]);

            const mergedPosts: any[] = [];
            const seenIds = new Set<string>();
            const maxLen = Math.max(topSaved.length, topBooked.length, topClicked.length);

            for (let i = 0; i < maxLen; i++) {
                if (i < topSaved.length) {
                    const idStr = topSaved[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topSaved[i]);
                    }
                }
                if (i < topBooked.length) {
                    const idStr = topBooked[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topBooked[i]);
                    }
                }
                if (i < topClicked.length) {
                    const idStr = topClicked[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topClicked[i]);
                    }
                }
            }

            const paginatedPosts = mergedPosts.slice(skip, skip + Number(limit));

            return {
                count: paginatedPosts.length,
                total,
                page: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                posts: paginatedPosts
            };
        }

        let sortObj: any = { createdAt: -1 }; // Default to newest
        if (sort === 'latest') sortObj = { createdAt: -1 };
        else if (sort === 'clicks') sortObj = { clicks: -1, createdAt: -1 };
        else if (sort === 'rating') sortObj = { 'rating.average': -1, 'rating.count': -1, createdAt: -1 };
        else if (isFeatured === 'true' || isFeatured === true) sortObj = { clicks: -1, createdAt: -1 };
        else sortObj = { clicks: -1, createdAt: -1 }; // Fallback clicks sort

        const posts = await this.postModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort(sortObj)
            .limit(Number(limit))
            .skip(skip);

        const total = await this.postModel.countDocuments(filter);

        return {
            count: posts.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            posts
        };
    }

    /**
     * Service: Get single post details including reviews, reaction statistics, and host rating
     */
    public async getPostDetail(postId: string): Promise<PostDetailResult> {
        const post = await this.postModel.findById(postId)
            .populate('user', 'firstname lastname email role avatar description location hostDetails hostStatus isHostVerified verifiedBadge createdAt');

        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        post.clicks = (post.clicks || 0) + 1;
        await this.postModel.updateOne({ _id: post._id }, { $inc: { clicks: 1 } });

        const reviews = await this.reactionService.getPostReviews(postId);

        const reactionStats: Record<string, number> = {};
        if (post.reactions) {
            post.reactions.forEach((r: any) => {
                if (r.emoji) reactionStats[r.emoji] = (reactionStats[r.emoji] || 0) + 1;
            });
        }

        const similarPosts = await this.postModel.find({
            postType: post.postType,
            status: 'active',
            _id: { $ne: post._id },
            $or: [
                { categories: { $in: post.categories || [] } },
                { 'location.city': post.location?.city }
            ]
        }).limit(6);

        // Host rating calculated via userService (separation of concerns)
        const hostId = post.user?._id;
        let hostRating = { average: 0, count: 0 };
        if (hostId) {
            hostRating = await this.userService.getHostRating(hostId.toString());
        }

        return {
            post: {
                ...(typeof post.toObject === 'function' ? post.toObject() : post),
                reactionStats,
                reactionCount: post.reactions?.length || 0,
                user: post.user ? { ...(typeof post.user.toObject === 'function' ? post.user.toObject() : post.user), hostRating } : null
            },
            reviews: { count: reviews.length, data: reviews },
            similarPosts
        };
    }

    /**
     * Service: Get top-rated treks aggregated from reviews
     */
    public async getTopRatedTreks(options: GetTopRatedTreksOptions = {}): Promise<TopRatedTreksResult> {
        const { limit = 10, page = 1, minRating = 0 } = options;
        const skip = (Number(page) - 1) * Number(limit);

        const totalFilter = { postType: 'trek', status: 'active' };
        const total = await this.postModel.countDocuments(totalFilter);

        const topRatedTreks = await this.reviewModel.aggregate([
            { $match: { post: { $exists: true, $ne: null } } },
            { $group: { _id: '$post', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
            { $match: { averageRating: { $gte: Number(minRating) } } },
            { $sort: { averageRating: -1, reviewCount: -1 } },
            { $lookup: { from: 'posts', localField: '_id', foreignField: '_id', as: 'postDetails' } },
            { $unwind: '$postDetails' },
            { $match: { 'postDetails.postType': 'trek', 'postDetails.status': 'active' } },
            { $skip: skip },
            { $limit: Number(limit) },
            { $lookup: { from: 'users', localField: 'postDetails.user', foreignField: '_id', as: 'userDetails' } },
            { $project: {
                _id: '$postDetails._id',
                title: '$postDetails.title',
                description: '$postDetails.description',
                postType: '$postDetails.postType',
                photos: '$postDetails.photos',
                location: '$postDetails.location',
                price: '$postDetails.price',
                duration: '$postDetails.duration',
                difficulty: '$postDetails.difficulty',
                categories: '$postDetails.categories',
                isFeatured: '$postDetails.isFeatured',
                status: '$postDetails.status',
                approvedAt: '$postDetails.approvedAt',
                createdAt: '$postDetails.createdAt',
                user: { $arrayElemAt: ['$userDetails', 0] },
                averageRating: { $round: ['$averageRating', 1] },
                reviewCount: '$reviewCount'
            }}
        ]);

        return {
            count: topRatedTreks.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            treks: topRatedTreks
        };
    }

    /**
     * Service: Get nearby treks / experiences by geographic coordinates (or Dehradun fallback)
     */
    public async getNearbyTreks(options: GetNearbyTreksOptions = {}): Promise<NearbyTreksResult> {
        const { latitude, longitude, limit = 20, page = 1, difficulty, minPrice, maxPrice, categories } = options;
        const skip = (Number(page) - 1) * Number(limit);

        const filter: any = {
            postType: { $in: ['experience', 'service', 'trek', 'plan'] },
            status: 'active'
        };

        if (difficulty) filter.difficulty = difficulty;
        if (categories) {
            const catFilter = buildCategoryFilter(categories);
            if (catFilter) filter.categories = catFilter;
        }
        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const total = await this.postModel.countDocuments(filter);

        const lat = parseFloat(String(latitude));
        const lng = parseFloat(String(longitude));
        const hasValidCoords = !isNaN(lat) && !isNaN(lng);

        if (hasValidCoords) {
            filter['location.coordinates'] = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] }
                }
            };
            const treks = await this.postModel.find(filter)
                .select(LISTING_CARD_PROJECTION)
                .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                .limit(Number(limit))
                .skip(skip);
            const treksWithDistance = attachDistanceToTreks(treks, lat, lng);
            return {
                count: treksWithDistance.length,
                total,
                page: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                treks: treksWithDistance
            };
        } else {
            // No coordinates or invalid coordinates provided: return Dehradun (lat 30.3165, lng 78.0322) experiences first (within 50km), then remaining sorted by newest
            const dehradunLat = 30.3165;
            const dehradunLng = 78.0322;
            const maxNeeded = skip + Number(limit);

            // 1. Fetch experiences near Dehradun (within 50km)
            const dehradunFilter = { ...filter };
            dehradunFilter['location.coordinates'] = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [dehradunLng, dehradunLat] },
                    $maxDistance: 50000 // 50km in meters
                }
            };

            let dehradunTreks: any[] = [];
            try {
                dehradunTreks = await this.postModel.find(dehradunFilter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .limit(maxNeeded);
            } catch (err: any) {
                console.error("Error fetching Dehradun fallback treks:", err);
            }

            const dehradunTreksWithDistance = attachDistanceToTreks(dehradunTreks, dehradunLat, dehradunLng);

            // 2. Fetch other active experiences excluding Dehradun ones, sorted by newest
            const dehradunIds = dehradunTreks.map((t: any) => t._id.toString());
            const fallbackFilter = { ...filter, _id: { $nin: dehradunIds } };
            
            const remainingLimit = Math.max(0, maxNeeded - dehradunTreks.length);
            let fallbackTreks: any[] = [];
            if (remainingLimit > 0) {
                fallbackTreks = await this.postModel.find(fallbackFilter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ createdAt: -1 })
                    .limit(remainingLimit);
            }

            const combinedTreks = [...dehradunTreksWithDistance, ...fallbackTreks];
            const paginatedTreks = combinedTreks.slice(skip, skip + Number(limit));

            return { 
                count: paginatedTreks.length, 
                total, 
                page: Number(page), 
                totalPages: Math.ceil(total / Number(limit)), 
                treks: paginatedTreks 
            };
        }
    }

    /**
     * Service: Get posts by a specific user
     */
    public async getUserPosts(userId: string, postType?: string): Promise<any[]> {
        const filter: any = { user: userId };
        if (postType) filter.postType = postType;

        return await this.postModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort({ createdAt: -1 });
    }

    /**
     * Service: Get pending posts for admin review
     */
    public async getPendingPosts(options: GetPendingPostsOptions = {}): Promise<PaginatedPostsResult> {
        const { postType = 'experience', page = 1, limit = 20 } = options;
        const skip = (Number(page) - 1) * Number(limit);
        const filter = { postType, status: 'pending' };

        const posts = await this.postModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);
        const total = await this.postModel.countDocuments(filter);

        return {
            count: posts.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            posts
        };
    }

    /**
     * Service: Get category recent activity and highlight status
     */
    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const activity = await this.postModel.aggregate([
            { 
                $match: { 
                    status: 'active', 
                    isHidden: { $ne: true } 
                } 
            },
            { $unwind: "$categories" },
            {
                $group: {
                    _id: { $toLower: "$categories" },
                    categoryName: { $first: "$categories" },
                    latestApprovedAt: {
                        $max: {
                            $ifNull: ["$approvedAt", "$createdAt"]
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { latestApprovedAt: -1 } }
        ]);

        return activity.map((item: any) => ({
            category: item.categoryName,
            normalizedCategory: item._id,
            latestApprovedAt: item.latestApprovedAt,
            count: item.count,
            isNew: item.latestApprovedAt ? new Date(item.latestApprovedAt) >= twentyFourHoursAgo : false
        }));
    }
}

export const postActionService = PostActionService.getInstance();
export default PostActionService;

module.exports = postActionService;
module.exports.PostActionService = PostActionService;
module.exports.postActionService = postActionService;
module.exports.default = PostActionService;
