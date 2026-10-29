const { Post, User, Notification, HostDetails, HostAuditLog, Booking, Review } = require("../../db/mongoose");
const { storageService: defaultStorageService } = require("../storageService");
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
const { emailService: defaultEmailService } = require("../emailService");
import { notificationService } from "../notificationService";
const defaultNotifyAdmins = (reqOrApp: any, payload?: any) => notificationService.notifyAdmins(payload || reqOrApp);
const { userService: defaultUserService } = require("../userService");
import { PostReactionService, postReactionService as defaultPostReactionService } from "./postReactionService";
import {
    parsePostPayload, calculatePricingAndFees, isValidS3MediaUrl, parseIfJson,
    buildCategoryFilter, attachDistanceToTreks, recordHostAuditLog, LISTING_CARD_PROJECTION,
    buildPostsFilter, roundRobinMerge, cleanupMediaAssets, deleteMediaAssets,
    GetPostsOptions, PaginatedPostsResult, PostDetailResult, GetTopRatedTreksOptions,
    TopRatedTreksResult, GetNearbyTreksOptions, NearbyTreksResult, GetPendingPostsOptions,
    CategoryActivityResult
} from "./postPayloadParser";

export {
    GetPostsOptions, PaginatedPostsResult, PostDetailResult, GetTopRatedTreksOptions,
    TopRatedTreksResult, GetNearbyTreksOptions, NearbyTreksResult, GetPendingPostsOptions,
    CategoryActivityResult
};

export class PostActionService {
    private static instance: PostActionService | null = null;
    private static instanceKey = Symbol("PostActionServiceInstanceKey");

    private postModel: any;
    private userModel: any;
    private notificationModel: any;
    private hostAuditLogModel: any;
    private hostDetailsModel: any;
    private bookingModel: any;
    private reviewModel: any;
    private storageService: any;
    private googleDriveService: any;
    private emailService: any;
    private adminNotifier: (reqOrApp: any, payload: any) => Promise<any>;
    private userService: any;
    private reactionService: PostReactionService;

    constructor(instanceKey: symbol, ...args: any[]) {
        if (instanceKey !== PostActionService.instanceKey) throw new Error("Use PostActionService.getInstance()");
        const [pm = Post, um = User, nm = Notification, halm = HostAuditLog, bm = Booking, ss = defaultStorageService, gds = defaultGoogleDriveService, es = defaultEmailService, an = defaultNotifyAdmins, us = defaultUserService, rs = defaultPostReactionService, rm = Review, hdm = HostDetails] = args;
        this.postModel = pm; this.userModel = um; this.notificationModel = nm; this.hostAuditLogModel = halm;
        this.bookingModel = bm; this.storageService = ss; this.googleDriveService = gds; this.emailService = es;
        this.adminNotifier = an; this.userService = us; this.reactionService = rs; this.reviewModel = rm;
        this.hostDetailsModel = hdm;
    }

    public static getInstance(...args: any[]): PostActionService {
        if (!this.instance) this.instance = new PostActionService(this.instanceKey, ...args);
        return this.instance;
    }

    // ==================== INTERNAL HELPERS ====================

    private processMediaInputs(rawPhotos: any, rawVideos: any, initialPhotos: any[] = [], initialVideos: any[] = []): { photos: any[]; videos: any[] } {
        const photos = rawPhotos !== undefined ? (parseIfJson(rawPhotos) || []) : [...initialPhotos];
        const videos = rawVideos !== undefined ? (parseIfJson(rawVideos) || []) : [...initialVideos];
        if (photos.some((p: any) => !isValidS3MediaUrl(p)) || videos.some((v: any) => !isValidS3MediaUrl(v))) {
            throw Object.assign(new Error("Invalid media URL. All photos and videos must be hosted on Athithya's S3 storage."), { statusCode: 400 });
        }
        return { photos, videos };
    }

    private async notifyPostAdmin(options: {
        postId: any; userId: string; title: string; message: string; link?: string;
        templateName?: string; templateData?: Record<string, any>; emailSubject?: string; type?: string; reqOrApp?: any;
    }): Promise<void> {
        try {
            const emailHtml = options.templateName ? this.emailService.renderTemplate(options.templateName, options.templateData || {}) : "";
            await this.adminNotifier(options.reqOrApp, {
                senderId: options.userId, title: options.title, message: options.message,
                link: options.link || `/admin?reviewId=${options.postId}`, type: options.type || "info",
                emailSubject: options.emailSubject, emailHtml, metadata: { postId: options.postId, userId: options.userId }
            });
        } catch (err: any) {
            console.error(`Error sending admin notification for post ${options.postId}:`, err);
        }
    }

    // ==================== COMMAND ACTIONS ====================

    public async createPost(userId: string, userRole: string, postPayload: any, _files: any = null, reqOrApp: any = null): Promise<any> {
        const hostUser = await this.userModel.findById(userId);
        if (!hostUser) throw Object.assign(new Error("User not found"), { statusCode: 404 });
        if (userRole === "host") {
            const hostDetails = await this.hostDetailsModel.findOne({ user: userId });
            if (!hostDetails || hostDetails.status !== "approved") {
                throw Object.assign(new Error("You cannot add experiences until your host account is verified and approved by an admin."), { statusCode: 403 });
            }
        }
        if (!postPayload.title || !postPayload.description) {
            throw Object.assign(new Error("Title and description are required"), { statusCode: 400 });
        }

        const { photos, videos } = this.processMediaInputs(postPayload.photos, postPayload.videos);
        const post = await this.postModel.create({
            ...parsePostPayload(postPayload), user: userId, userRole, postType: postPayload.postType || "experience", photos, videos, status: "pending"
        });

        setImmediate(async () => {
            try {
                const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                const pUp = await this.googleDriveService.syncMediaItems(post.photos, `EXP_${cleanTitle}_${post._id}_photo`, "experiences");
                const vUp = await this.googleDriveService.syncMediaItems(post.videos, `EXP_${cleanTitle}_${post._id}_video`, "experiences", "video/mp4");
                if (pUp || vUp) await this.postModel.findByIdAndUpdate(post._id, { photos: post.photos, videos: post.videos });
            } catch (e) { console.error("Drive sync error:", e); }
        });

        const hostname = `${hostUser.firstname} ${hostUser.lastname}`;
        const locDetails = post.location ? `${post.location.address || ""}<br/>${post.location.city || ""}, ${post.location.state || ""}, ${post.location.country || ""}` : "N/A";
        const { formattedDetails: priceDetails } = calculatePricingAndFees(post.price);

        await this.notifyPostAdmin({
            postId: post._id, userId, title: "New Experience Approval Request",
            message: `Host ${hostname} submitted "${post.title}" for approval.`,
            templateName: "admin-new-post-approval",
            templateData: { hostname, hostEmail: hostUser.email || "N/A", title: post.title, category: (post.categories || []).join(", ") || "N/A", locationDetails: locDetails, priceDetails, description: post.description },
            emailSubject: "New Experience Awaiting Approval - Athithya", reqOrApp
        });

        return post;
    }

    public async updatePost(postId: string, userId: string, userRole: string, updatePayload: any, _files: any = null, reqOrApp: any = null): Promise<any> {
        const post = await this.postModel.findById(postId);
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });
        if (post.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You can only edit your own posts"), { statusCode: 403 });
        }

        const existingPhotos = parseIfJson(updatePayload.existingPhotos) || [];
        const existingVideos = parseIfJson(updatePayload.existingVideos) || [];
        const isLive = post.status === "active";
        const isHost = userRole !== "admin";

        if (!isLive || !isHost) {
            await cleanupMediaAssets(this.storageService, post.photos, existingPhotos);
            await cleanupMediaAssets(this.storageService, post.videos, existingVideos);
        }

        const { photos, videos } = this.processMediaInputs(updatePayload.photos, updatePayload.videos, existingPhotos, existingVideos);
        const normalized = parsePostPayload(updatePayload, post);

        if (isHost && isLive) {
            post.pendingUpdate = { ...normalized, photos, videos };
            await post.save();
            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
            await this.notifyPostAdmin({
                postId: post._id, userId, title: "Experience Update Pending Approval",
                message: `Host ${hostName} submitted changes to "${post.title}" for your review.`,
                templateName: "admin-post-update-approval", templateData: { hostName, title: post.title },
                emailSubject: `Experience Update Submitted - ${post.title}`, reqOrApp
            });
            return { isPendingReview: true, message: "Changes submitted for admin approval. The experience remains active with original details.", post };
        }

        Object.assign(post, normalized);
        post.photos = photos; post.videos = videos;
        if (isHost) post.status = "pending";
        else if (updatePayload.status) post.status = updatePayload.status;
        post.pendingUpdate = null;
        await post.save();

        if (isHost) {
            await this.notifyPostAdmin({
                postId: post._id, userId, title: "Experience Re-submitted for Approval",
                message: `A host has updated and re-submitted "${post.title}" for your review.`, reqOrApp
            });
        }
        return { isPendingReview: false, message: "Post updated successfully", post };
    }

    public async updatePostStatus(postId: string, status: string, remarks?: string): Promise<any> {
        if (!["active", "inactive", "archived", "pending"].includes(status)) {
            throw Object.assign(new Error("Invalid status"), { statusCode: 400 });
        }
        const post = await this.postModel.findById(postId);
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });

        if (status === "active" && post.pendingUpdate) {
            await cleanupMediaAssets(this.storageService, post.photos, post.pendingUpdate.photos || []);
            await cleanupMediaAssets(this.storageService, post.videos, post.pendingUpdate.videos || []);
            Object.assign(post, post.pendingUpdate);
            post.pendingUpdate = null;
        }

        post.status = status;
        if (remarks !== undefined) post.remarks = remarks;
        await post.save();
        return post;
    }

    public async toggleHideExperience(postId: string, userId: string, userRole: string, action: string, reason: string = "", reqOrApp: any = null): Promise<any> {
        const post = await this.postModel.findById(postId);
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });
        if (post.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("Not authorized to hide this experience"), { statusCode: 403 });
        }

        if (action === "unhide") {
            post.isHidden = false; post.hideRequested = false; post.unhideRequested = false; post.hideReason = "";
            await post.save();
            return { message: "Experience unhidden successfully.", isHidden: false, hideRequested: false, unhideRequested: false };
        }

        if (!reason?.trim()) throw Object.assign(new Error("Reason is required to hide an experience."), { statusCode: 400 });
        post.hideRequested = true; post.unhideRequested = false; post.hideReason = reason.trim();
        await post.save();

        const hostUser = await this.userModel.findById(userId);
        const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
        await this.notifyPostAdmin({
            postId: post._id, userId, title: "Experience Hide Request",
            message: `Host ${hostName} requested to hide "${post.title}". Reason: "${reason.trim()}"`,
            link: `/admin?tab=approvals`, templateName: "admin-post-hide-request",
            templateData: { hostName, title: post.title, reason: reason.trim() },
            emailSubject: `Experience Hide Request - ${post.title}`, reqOrApp
        });
        return { message: "Request to hide experience submitted for admin review.", hideRequested: true, unhideRequested: false };
    }

    public async deletePost(postId: string, userId: string, userRole: string, reqOrApp: any = null): Promise<{ success: boolean; message: string; pendingReview?: boolean }> {
        const post = await this.postModel.findById(postId);
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });
        if (post.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You can only delete your own posts"), { statusCode: 403 });
        }

        if (userRole !== "admin") {
            post.deleteRequested = true;
            await post.save();
            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
            await this.notifyPostAdmin({
                postId: post._id, userId, title: "Experience Deletion Request",
                message: `Host ${hostName} requested to delete experience "${post.title}".`,
                link: `/admin?tab=approvals`, templateName: "admin-post-deletion-request",
                templateData: { hostName, title: post.title }, emailSubject: `Experience Deletion Request - ${post.title}`,
                type: "warning", reqOrApp
            });
            return { success: true, message: "Deletion request submitted for review", pendingReview: true };
        }

        const hostUser = await this.userModel.findById(post.user);
        await recordHostAuditLog(this.hostAuditLogModel, {
            type: "experience_delete",
            hostId: post.user,
            hostName: hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Unknown Host",
            snapshot: {
                title: post.title || "",
                subtitle: post.subtitle || "",
                description: post.description || "",
                longDescription: post.longDescription || "",
                price: post.price,
                duration: post.duration,
                location: post.location,
                capacity: post.capacity,
                amenities: post.amenities || [],
                rules: post.privacyPolicy || [],
                photos: post.photos || [],
                categories: post.categories || []
            }
        });

        await deleteMediaAssets(this.storageService, this.googleDriveService, [...(post.photos || []), ...(post.videos || [])]);
        await this.bookingModel.updateMany({ post: postId, status: { $in: ["pending", "accepted", "in_progress", "cancel_requested"] } }, { $set: { status: "cancelled" } });
        await this.postModel.findByIdAndDelete(postId);
        return { success: true, message: "Post deleted successfully" };
    }

    public async savePost(postId: string, userId: string, userRole: string): Promise<{ success: boolean; message: string }> {
        if (userRole === "host") throw Object.assign(new Error("Hosts cannot engage with another host's experience. Only guests can."), { statusCode: 400 });
        const post = await this.postModel.findById(postId);
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });
        const added = await this.userService.addSavedPost(userId, postId);
        if (added) await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: 1 } });
        return { success: true, message: "Post saved successfully" };
    }

    public async unsavePost(postId: string, userId: string): Promise<{ success: boolean; message: string }> {
        const removed = await this.userService.removeSavedPost(userId, postId);
        if (removed) await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: -1 } });
        return { success: true, message: "Post removed from saved list" };
    }

    // ==================== QUERY ACTIONS ====================

    public async getPosts(options: GetPostsOptions = {}): Promise<PaginatedPostsResult> {
        const { page = 1, limit = 20, sort = "latest", isFeatured } = options;
        const filter = buildPostsFilter(options);
        const skip = (Number(page) - 1) * Number(limit);

        if (sort === "bookings" || sort === "loved") {
            const neededLimit = skip + Number(limit);
            const [topSaved, topBooked, topClicked, total] = await Promise.all([
                this.postModel.find({ ...filter, savesCount: { $gt: 0 } }).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname email role avatar").sort({ savesCount: -1, createdAt: -1 }).limit(neededLimit),
                this.postModel.find({ ...filter, bookingCount: { $gt: 0 } }).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname email role avatar").sort({ bookingCount: -1, createdAt: -1 }).limit(neededLimit),
                this.postModel.find(filter).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname email role avatar").sort({ clicks: -1, createdAt: -1 }).limit(neededLimit),
                this.postModel.countDocuments(filter)
            ]);
            const posts = roundRobinMerge([topSaved, topBooked, topClicked], skip, Number(limit));
            return { count: posts.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), posts };
        }

        let sortObj: any = { createdAt: -1 };
        if (sort === "clicks" || isFeatured === "true" || isFeatured === true) sortObj = { clicks: -1, createdAt: -1 };
        else if (sort === "rating") sortObj = { "rating.average": -1, "rating.count": -1, createdAt: -1 };

        const [posts, total] = await Promise.all([
            this.postModel.find(filter).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname email role avatar").sort(sortObj).limit(Number(limit)).skip(skip),
            this.postModel.countDocuments(filter)
        ]);

        return { count: posts.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), posts };
    }

    public async getPostDetail(postId: string): Promise<PostDetailResult> {
        const post = await this.postModel.findById(postId)
            .populate("user", "firstname lastname email role avatar description location createdAt");
        if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });

        if (post.user?._id) {
            const hostDetails = await this.hostDetailsModel.findOne({ user: post.user._id });
            if (hostDetails) {
                const userObj = typeof post.user.toObject === 'function' ? post.user.toObject() : post.user;
                userObj.hostDetails = {
                    yearsOfExperience: hostDetails.yearsOfExperience,
                    phone: hostDetails.phone,
                    city: hostDetails.city,
                    state: hostDetails.state
                };
                userObj.hostStatus = hostDetails.status;
                userObj.verifyBadge = hostDetails.verifyBadge;
                post.user = userObj;
            }
        }

        await this.postModel.updateOne({ _id: post._id }, { $inc: { clicks: 1 } });

        const [reviews, similarPosts, hostRating] = await Promise.all([
            this.reactionService.getPostReviews(postId),
            this.postModel.find({
                postType: post.postType, status: "active", _id: { $ne: post._id },
                $or: [{ categories: { $in: post.categories || [] } }, { "location.city": post.location?.city }]
            }).limit(6),
            post.user?._id ? this.userService.getHostRating(post.user._id.toString()) : { average: 0, count: 0 }
        ]);

        const reactionStats: Record<string, number> = {};
        if (post.reactions) {
            post.reactions.forEach((r: any) => { if (r.emoji) reactionStats[r.emoji] = (reactionStats[r.emoji] || 0) + 1; });
        }

        return {
            post: {
                ...(typeof post.toObject === "function" ? post.toObject() : post),
                reactionStats, reactionCount: post.reactions?.length || 0,
                user: post.user ? { ...(typeof post.user.toObject === "function" ? post.user.toObject() : post.user), hostRating } : null
            },
            reviews: { count: reviews.length, data: reviews },
            similarPosts
        };
    }

    public async getTopRatedTreks(options: GetTopRatedTreksOptions = {}): Promise<TopRatedTreksResult> {
        const { limit = 10, page = 1, minRating = 0 } = options;
        const skip = (Number(page) - 1) * Number(limit);
        const total = await this.postModel.countDocuments({ postType: "trek", status: "active", isHidden: { $ne: true } });

        const topRatedTreks = await this.reviewModel.aggregate([
            { $match: { post: { $exists: true, $ne: null } } },
            { $group: { _id: "$post", averageRating: { $avg: "$rating" }, reviewCount: { $sum: 1 } } },
            { $match: { averageRating: { $gte: Number(minRating) } } },
            { $sort: { averageRating: -1, reviewCount: -1 } },
            { $lookup: { from: "posts", localField: "_id", foreignField: "_id", as: "post" } },
            { $unwind: "$post" },
            { $match: { "post.postType": "trek", "post.status": "active", "post.isHidden": { $ne: true } } },
            { $skip: skip },
            { $limit: Number(limit) },
            { $lookup: { from: "users", localField: "post.user", foreignField: "_id", pipeline: [{ $project: { firstname: 1, lastname: 1, email: 1, role: 1, avatar: 1 } }], as: "userDetails" } },
            {
                $replaceRoot: {
                    newRoot: {
                        $mergeObjects: [
                            "$post",
                            { user: { $arrayElemAt: ["$userDetails", 0] }, averageRating: { $round: ["$averageRating", 1] }, reviewCount: "$reviewCount" }
                        ]
                    }
                }
            }
        ]);

        return { count: topRatedTreks.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), treks: topRatedTreks };
    }

    public async getNearbyTreks(options: GetNearbyTreksOptions = {}): Promise<NearbyTreksResult> {
        const { latitude, longitude, limit = 20, page = 1, difficulty, minPrice, maxPrice, categories } = options;
        const skip = (Number(page) - 1) * Number(limit);

        const filter: any = { postType: { $in: ["experience", "service", "trek", "plan"] }, status: "active", isHidden: { $ne: true } };
        if (difficulty) filter.difficulty = difficulty;
        if (categories) {
            const catFilter = buildCategoryFilter(categories);
            if (catFilter) filter.categories = catFilter;
        }
        if (minPrice || maxPrice) {
            filter["price.perPerson"] = {};
            if (minPrice) filter["price.perPerson"].$gte = Number(minPrice);
            if (maxPrice) filter["price.perPerson"].$lte = Number(maxPrice);
        }

        const total = await this.postModel.countDocuments(filter);
        const lat = parseFloat(String(latitude));
        const lng = parseFloat(String(longitude));
        const hasValidCoords = !isNaN(lat) && !isNaN(lng);

        if (hasValidCoords) {
            filter["location.coordinates"] = { $near: { $geometry: { type: "Point", coordinates: [lng, lat] } } };
        }

        const query = this.postModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate("user", "firstname lastname email role avatar")
            .limit(Number(limit))
            .skip(skip);

        if (!hasValidCoords) query.sort({ clicks: -1, createdAt: -1 });

        const posts = await query;
        const treks = hasValidCoords ? attachDistanceToTreks(posts, lat, lng) : posts;

        return { count: treks.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), treks };
    }

    public async getUserPosts(userId: string, postType?: string): Promise<any[]> {
        const filter: any = { user: userId };
        if (postType) filter.postType = postType;
        return await this.postModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate("user", "firstname lastname email role avatar")
            .sort({ createdAt: -1 });
    }

    public async getPendingPosts(options: GetPendingPostsOptions = {}): Promise<PaginatedPostsResult> {
        const { postType = "experience", page = 1, limit = 20 } = options;
        const skip = (Number(page) - 1) * Number(limit);
        const filter = { postType, status: "pending" };

        const [posts, total] = await Promise.all([
            this.postModel.find(filter)
                .select(LISTING_CARD_PROJECTION)
                .populate("user", "firstname lastname email role avatar")
                .sort({ createdAt: -1 })
                .limit(Number(limit))
                .skip(skip),
            this.postModel.countDocuments(filter)
        ]);

        return { count: posts.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), posts };
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activity = await this.postModel.aggregate([
            { $match: { status: "active", isHidden: { $ne: true } } },
            { $unwind: "$categories" },
            {
                $group: {
                    _id: { $toLower: "$categories" },
                    categoryName: { $first: "$categories" },
                    latestApprovedAt: { $max: { $ifNull: ["$approvedAt", "$createdAt"] } },
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
