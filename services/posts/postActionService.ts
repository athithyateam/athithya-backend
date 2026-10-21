const { Post, User, Notification, HostHistory, Booking } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const { storageService: defaultStorageService } = require("../storageService");
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
const { emailService: defaultEmailService } = require("../emailService");
const { notifyAdmins: defaultNotifyAdmins } = require("../../utils/notifyAdminHelper");
import { parsePostPayload, calculatePricingAndFees, isValidS3MediaUrl } from "./postPayloadParser";

export class PostActionService {
    private static instance: PostActionService | null = null;
    private static instanceKey = Symbol("PostActionServiceInstanceKey");

    private postModel: any;
    private userModel: any;
    private notificationModel: any;
    private hostHistoryModel: any;
    private bookingModel: any;
    private storageService: any;
    private googleDriveService: any;
    private emailService: any;
    private adminNotifier: (reqOrApp: any, payload: any) => Promise<any>;

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
        adminNotifier: (reqOrApp: any, payload: any) => Promise<any> = defaultNotifyAdmins
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
        adminNotifier?: (reqOrApp: any, payload: any) => Promise<any>
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
                adminNotifier
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
}

export const postActionService = PostActionService.getInstance();
export default PostActionService;

module.exports = postActionService;
module.exports.PostActionService = PostActionService;
module.exports.postActionService = postActionService;
module.exports.default = PostActionService;
