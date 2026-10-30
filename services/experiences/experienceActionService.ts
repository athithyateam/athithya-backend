const { Experience, User, Notification, HostDetails, HostAuditLog, SavedExperience } = require("../../db/mongoose");
const { storageService: defaultStorageService } = require("../storageService");
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
const { emailService: defaultEmailService, sendHtmlEmail } = require("../emailService");
import { notificationService } from "../notificationService";
const defaultNotifyAdmins = (reqOrApp: any, payload?: any) => notificationService.notifyAdmins(payload !== undefined ? payload : reqOrApp);
const { userService: defaultUserService } = require("../userService");
import { reviewService as defaultReviewService, ReviewService } from "../reviewService";
import { bookingService as defaultBookingService } from "../bookingService";
import {
    parseExperiencePayload, calculatePricingAndFees, isValidS3MediaUrl, parseIfJson,
    buildCategoryFilter, attachDistanceToTreks, recordHostAuditLog, LISTING_CARD_PROJECTION,
    buildExperiencesFilter, roundRobinMerge, cleanupMediaAssets, deleteMediaAssets,
    GetExperiencesOptions, PaginatedExperiencesResult, ExperienceDetailResult, GetTopRatedTreksOptions,
    TopRatedTreksResult, GetNearbyTreksOptions, NearbyTreksResult, GetPendingExperiencesOptions,
    CategoryActivityResult
} from "./experiencePayloadParser";

export {
    GetExperiencesOptions, PaginatedExperiencesResult, ExperienceDetailResult, GetTopRatedTreksOptions,
    TopRatedTreksResult, GetNearbyTreksOptions, NearbyTreksResult, GetPendingExperiencesOptions,
    CategoryActivityResult
};

export class ExperienceActionService {
    private static instance: ExperienceActionService | null = null;
    private static instanceKey = Symbol("ExperienceActionServiceInstanceKey");

    private experienceModel: any;
    private userModel: any;
    private notificationModel: any;
    private hostAuditLogModel: any;
    private hostDetailsModel: any;
    private bookingService: any;
    private reviewService: ReviewService;
    private savedExperienceModel: any;
    private storageService: any;
    private googleDriveService: any;
    private emailService: any;
    private adminNotifier: (reqOrApp: any, payload: any) => Promise<any>;
    private userService: any;

    constructor(instanceKey: symbol, ...args: any[]) {
        if (instanceKey !== ExperienceActionService.instanceKey) throw new Error("Use ExperienceActionService.getInstance()");
        const [
            em = Experience, um = User, nm = Notification, halm = HostAuditLog,
            bsOrBm = defaultBookingService, ss = defaultStorageService,
            gds = defaultGoogleDriveService, es = defaultEmailService,
            an = defaultNotifyAdmins, us = defaultUserService,
            rs = defaultReviewService, hdm = HostDetails, sem = SavedExperience
        ] = args;

        this.experienceModel = em;
        this.userModel = um;
        this.notificationModel = nm;
        this.hostAuditLogModel = halm;
        this.bookingService = (bsOrBm && typeof bsOrBm.cancelBookingsForExperience === "function")
            ? bsOrBm
            : {
                cancelBookingsForExperience: async (id: string) => {
                    if (bsOrBm?.updateMany) {
                        return (await bsOrBm.updateMany({ experience: id, status: { $in: ["pending", "accepted", "in_progress", "cancel_requested"] } }, { $set: { status: "cancelled" } }))?.modifiedCount || 0;
                    }
                    return defaultBookingService.cancelBookingsForExperience(id);
                }
            };
        this.storageService = ss;
        this.googleDriveService = gds;
        this.emailService = es;
        this.adminNotifier = an;
        this.userService = us;
        this.reviewService = rs;
        this.hostDetailsModel = hdm;
        this.savedExperienceModel = sem;
    }

    public static getInstance(...args: any[]): ExperienceActionService {
        if (!this.instance) this.instance = new ExperienceActionService(this.instanceKey, ...args);
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

    private async notifyExperienceAdmin(options: {
        experienceId: any; userId: string; title: string; message: string; link?: string;
        templateName?: string; templateData?: Record<string, any>; emailSubject?: string; type?: string; reqOrApp?: any;
    }): Promise<void> {
        try {
            const emailHtml = options.templateName ? this.emailService.renderTemplate(options.templateName, options.templateData || {}) : "";
            await this.adminNotifier(options.reqOrApp, {
                senderId: options.userId,
                title: options.title,
                message: options.message,
                link: options.link || `/admin?reviewId=${options.experienceId}`,
                type: options.type || "info",
                emailSubject: options.emailSubject,
                emailHtml,
                metadata: { experienceId: options.experienceId, userId: options.userId }
            });
        } catch (err: any) {
            console.error(`Error sending admin notification for experience ${options.experienceId}:`, err);
        }
    }

    // ==================== COMMAND ACTIONS ====================

    public async createExperience(userId: string, userRole: string, experiencePayload: any, _files: any = null, reqOrApp: any = null): Promise<any> {
        if (userRole !== "host" && userRole !== "admin") {
            throw Object.assign(new Error("Regular users cannot create experiences. Only verified hosts can create experiences."), { statusCode: 403 });
        }
        const hostUser = await this.userModel.findById(userId);
        if (!hostUser) throw Object.assign(new Error("User not found"), { statusCode: 404 });
        if (userRole === "host") {
            const hostDetails = await this.hostDetailsModel.findOne({ user: userId });
            if (!hostDetails || hostDetails.status !== "approved") {
                throw Object.assign(new Error("You cannot add experiences until your host account is verified and approved by an admin."), { statusCode: 403 });
            }
        }
        if (!experiencePayload.title || !experiencePayload.description) {
            throw Object.assign(new Error("Title and description are required"), { statusCode: 400 });
        }

        const { photos, videos } = this.processMediaInputs(experiencePayload.photos, experiencePayload.videos);
        const experience = await this.experienceModel.create({
            ...parseExperiencePayload(experiencePayload),
            user: userId,
            userRole,
            photos,
            videos,
            status: "pending"
        });

        setImmediate(async () => {
            try {
                const cleanTitle = (experience.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                const pUp = await this.googleDriveService.syncMediaItems(experience.photos, `EXP_${cleanTitle}_${experience._id}_photo`, "experiences");
                const vUp = await this.googleDriveService.syncMediaItems(experience.videos, `EXP_${cleanTitle}_${experience._id}_video`, "experiences", "video/mp4");
                if (pUp || vUp) await this.experienceModel.findByIdAndUpdate(experience._id, { photos: experience.photos, videos: experience.videos });
            } catch (e) { console.error("Drive sync error:", e); }
        });

        const hostname = `${hostUser.firstname} ${hostUser.lastname}`;
        const locDetails = experience.location ? `${experience.location.address || ""}<br/>${experience.location.city || ""}, ${experience.location.state || ""}, ${experience.location.country || ""}` : "N/A";
        const { formattedDetails: priceDetails } = calculatePricingAndFees(experience.price);

        await this.notifyExperienceAdmin({
            experienceId: experience._id,
            userId,
            title: "New Experience Approval Request",
            message: `Host ${hostname} submitted "${experience.title}" for approval.`,
            templateName: "admin-new-experience-approval",
            templateData: { hostname, hostEmail: hostUser.email || "N/A", title: experience.title, category: (experience.categories || []).join(", ") || "N/A", locationDetails: locDetails, priceDetails, description: experience.description },
            emailSubject: "New Experience Awaiting Approval - Athithya",
            reqOrApp
        });

        return experience;
    }

    public async updateExperience(experienceId: string, userId: string, userRole: string, updatePayload: any, _files: any = null, reqOrApp: any = null): Promise<any> {
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });
        if (experience.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You can only edit your own experiences"), { statusCode: 403 });
        }

        const isLive = experience.status === "active";
        const isHost = userRole !== "admin";

        const { photos, videos } = this.processMediaInputs(updatePayload.photos, updatePayload.videos, experience.photos, experience.videos);
        const normalized = parseExperiencePayload(updatePayload, experience);

        // Delete replaced media assets if update is directly applied (not pending review)
        if (!isLive || !isHost) {
            if (updatePayload.photos !== undefined) {
                await cleanupMediaAssets(this.storageService, experience.photos, photos);
            }
            if (updatePayload.videos !== undefined) {
                await cleanupMediaAssets(this.storageService, experience.videos, videos);
            }
        }

        if (isHost && isLive) {
            experience.pendingUpdate = { ...normalized, photos, videos };
            await experience.save();
            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
            await this.notifyExperienceAdmin({
                experienceId: experience._id,
                userId,
                title: "Experience Update Pending Approval",
                message: `Host ${hostName} submitted changes to "${experience.title}" for your review.`,
                templateName: "admin-experience-update-approval",
                templateData: { hostName, title: experience.title },
                emailSubject: `Experience Update Submitted - ${experience.title}`,
                reqOrApp
            });
            return { isPendingReview: true, message: "Changes submitted for admin approval. The experience remains active with original details.", experience };
        }

        Object.assign(experience, normalized);
        experience.photos = photos;
        experience.videos = videos;
        if (isHost) experience.status = "pending";
        else if (updatePayload.status) experience.status = updatePayload.status;
        experience.pendingUpdate = null;
        await experience.save();

        setImmediate(async () => {
            try {
                const cleanTitle = (experience.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                const pUp = await this.googleDriveService.syncMediaItems(experience.photos, `EXP_${cleanTitle}_${experience._id}_photo`, "experiences");
                const vUp = await this.googleDriveService.syncMediaItems(experience.videos, `EXP_${cleanTitle}_${experience._id}_video`, "experiences", "video/mp4");
                if (pUp || vUp) await this.experienceModel.findByIdAndUpdate(experience._id, { photos: experience.photos, videos: experience.videos });
            } catch (e) { console.error("Drive sync error during update:", e); }
        });

        if (isHost) {
            await this.notifyExperienceAdmin({
                experienceId: experience._id,
                userId,
                title: "Experience Re-submitted for Approval",
                message: `A host has updated and re-submitted "${experience.title}" for your review.`,
                reqOrApp
            });
        }
        return { isPendingReview: false, message: "Experience updated successfully", experience };
    }

    public async updateExperienceStatus(
        experienceId: string,
        status: string,
        remarks?: string,
        adminUserId?: string,
        _reqOrApp: any = null
    ): Promise<any> {
        if (!["active", "inactive", "archived", "pending"].includes(status)) {
            throw Object.assign(new Error("Invalid status"), { statusCode: 400 });
        }
        const experience = await this.experienceModel.findById(experienceId).populate("user");
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });

        const hostUser = experience.user;
        const hostId = hostUser?._id || experience.user;
        const hostEmail = hostUser?.email;
        const hostFirstName = hostUser?.firstname || "Host";
        const experienceTitle = experience.title;

        // ── 1. Handle Deletion Approval / Rejection ──
        if (experience.deleteRequested) {
            if (status === "active") {
                // Admin approves deletion: archive audit log, delete S3 and Drive assets, cancel bookings, delete bookmarks & reviews, delete document
                try {
                    const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
                    await recordHostAuditLog(this.hostAuditLogModel, {
                        type: "experience_delete",
                        hostId,
                        hostName,
                        snapshot: {
                            title: experience.title || "",
                            subtitle: experience.subtitle || "",
                            description: experience.description || "",
                            longDescription: experience.longDescription || "",
                            price: experience.price,
                            duration: experience.duration,
                            location: experience.location,
                            capacity: experience.capacity,
                            amenities: experience.amenities || [],
                            rules: experience.privacyPolicy || [],
                            photos: experience.photos || [],
                            videos: experience.videos || [],
                            categories: experience.categories || []
                        }
                    }, { type: "experience_delete" });
                } catch (historyErr) {
                    console.error("Error logging deleted experience audit log:", historyErr);
                }

                await deleteMediaAssets(this.storageService, this.googleDriveService, [...(experience.photos || []), ...(experience.videos || [])]);
                await this.bookingService.cancelBookingsForExperience(experience._id);
                await this.savedExperienceModel.deleteMany({ experience: experience._id });
                await this.reviewService.deleteExperienceReviews(experience._id);
                await this.experienceModel.findByIdAndDelete(experience._id);

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Deletion Approved",
                    message: `The experience "${experienceTitle}" you requested for deletion has successfully been approved and deleted.`,
                    type: "success"
                });

                if (hostEmail) {
                    const subject = "Experience Deletion Approved - Athithya";
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: #2e7d32; margin-top: 0;">Experience Deletion Approved</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${hostFirstName},</p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    The experience "${experienceTitle}" you requested for deletion has successfully been approved and deleted.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion approved email:", err));
                }

                return { success: true, message: "Experience deletion request approved and deleted successfully" };
            } else if (status === "inactive") {
                // Admin rejects deletion: reset deleteRequested flag
                experience.deleteRequested = false;
                experience.deleteRequestedAt = undefined;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Deletion Rejected",
                    message: `The deletion request for your experience "${experience.title}" was reviewed and rejected. The experience remains active.`,
                    type: "info",
                    link: `/experiences/${experience._id}`
                });

                if (hostEmail) {
                    const subject = "Experience Deletion Rejected - Athithya";
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: #c62828; margin-top: 0;">Experience Deletion Rejected</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${hostFirstName},</p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    The deletion request for your experience "${experience.title}" was reviewed and rejected. The experience remains active.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion rejected email:", err));
                }

                return { success: true, message: "Experience deletion request rejected. Experience remains active.", experience };
            }
        }

        // ── 2. Handle Hide Request Approval / Rejection ──
        if (experience.hideRequested) {
            if (status === "active") {
                experience.isHidden = true;
                experience.hideRequested = false;
                experience.unhideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Hide Request Approved",
                    message: `Your request to hide experience "${experience.title}" has been approved by admin.`,
                    type: "info",
                    link: `/profile/${hostId}`
                });

                return { success: true, message: "Experience hide request approved successfully", experience };
            } else if (status === "inactive") {
                experience.hideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Hide Request Rejected",
                    message: `Your request to hide experience "${experience.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${hostId}`
                });

                return { success: true, message: "Experience hide request rejected", experience };
            }
        }

        // ── 3. Handle Unhide Request Approval / Rejection ──
        if (experience.unhideRequested) {
            if (status === "active") {
                experience.isHidden = false;
                experience.unhideRequested = false;
                experience.hideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Unhide Request Approved",
                    message: `Your request to unhide experience "${experience.title}" has been approved by admin. It is now live on the platform.`,
                    type: "success",
                    link: `/experiences/${experience._id}`
                });

                return { success: true, message: "Experience unhide request approved successfully", experience };
            } else if (status === "inactive") {
                experience.unhideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: "Experience Unhide Request Rejected",
                    message: `Your request to unhide experience "${experience.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${hostId}`
                });

                return { success: true, message: "Experience unhide request rejected", experience };
            }
        }

        // ── 4. General Status Updates (Approval / Rejection) ──
        if (status === "active") {
            if (experience.pendingUpdate) {
                await cleanupMediaAssets(this.storageService, experience.photos, experience.pendingUpdate.photos || []);
                await cleanupMediaAssets(this.storageService, experience.videos, experience.pendingUpdate.videos || []);
                Object.assign(experience, experience.pendingUpdate);
                experience.pendingUpdate = null;
            }
            experience.status = "active";
            experience.approvedAt = new Date();
            experience.isHidden = false;
            experience.deleteRequested = false;
            experience.hideRequested = false;
            experience.unhideRequested = false;

            setImmediate(async () => {
                try {
                    const cleanTitle = (experience.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                    const pUp = await this.googleDriveService.syncMediaItems(experience.photos, `EXP_${cleanTitle}_${experience._id}_photo`, "experiences");
                    const vUp = await this.googleDriveService.syncMediaItems(experience.videos, `EXP_${cleanTitle}_${experience._id}_video`, "experiences", "video/mp4");
                    if (pUp || vUp) await this.experienceModel.findByIdAndUpdate(experience._id, { photos: experience.photos, videos: experience.videos });
                } catch (e) { console.error("Drive sync error on status approval:", e); }
            });
        } else if (status === "inactive") {
            experience.status = "inactive";
            experience.pendingUpdate = null;
            experience.deleteRequested = false;
            experience.hideRequested = false;
            experience.unhideRequested = false;
        } else {
            experience.status = status;
        }

        if (remarks !== undefined) {
            experience.adminRemarks = remarks;
            experience.remarks = remarks;
        }

        await experience.save();
        await this.experienceModel.updateOne({ _id: experience._id }, { $unset: { pendingUpdate: 1 } });

        // Notifications & Emails on General Status Decisions
        if (status === "active" || status === "inactive") {
            const isApproved = status === "active";
            const emailSubject = isApproved ? "Experience Approved & Published! - Athithya" : "Experience Submission Update - Athithya";
            const emailMessage = isApproved
                ? `Congratulations! Your experience "${experience.title}" has been approved and is now active on Athithya.`
                : `Your experience "${experience.title}" was reviewed and rejected. ${remarks ? `Remarks: ${remarks}` : "Please check your details and try again."}`;

            try {
                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: adminUserId || hostId,
                    title: isApproved ? "Experience Approved" : "Experience Rejected",
                    message: emailMessage,
                    type: isApproved ? "success" : "error",
                    link: isApproved ? `/experiences/${experience._id}` : `/profile/${hostId}`
                });

                if (hostEmail) {
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: ${isApproved ? '#2e7d32' : '#c62828'}; margin-top: 0;">${isApproved ? 'Experience Approved' : 'Experience Rejected'}</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">Hi ${hostFirstName},</p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">${emailMessage}</p>
                                ${isApproved ? `
                                <div style="margin-top: 30px; text-align: center;">
                                    <a href="https://athithya.in/experiences/${experience._id}" style="background-color: #C59A2F; color: #fff; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 14px;">View Your Experience</a>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, emailSubject, htmlContent).catch(err => console.error("Failed to send status update email:", err));
                }
            } catch (notifErr) {
                console.error("Error creating experience status notification:", notifErr);
            }
        }

        return experience;
    }

    public async toggleHideExperience(experienceId: string, userId: string, userRole: string, action: string, reason: string = "", reqOrApp: any = null): Promise<any> {
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });
        if (experience.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You are not authorized to modify this experience"), { statusCode: 403 });
        }

        const hostUser = await this.userModel.findById(experience.user);
        const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

        if (action === "request_hide") {
            experience.hideRequested = true;
            experience.unhideRequested = false;
            experience.hideReason = reason || "Hidden requested by host";
            await experience.save();
            await this.notifyExperienceAdmin({
                experienceId: experience._id,
                userId,
                title: "Experience Hide Request",
                message: `Host ${hostName} requested to hide "${experience.title}".`,
                templateName: "admin-experience-hide-request",
                templateData: { hostName, title: experience.title, reason: experience.hideReason },
                emailSubject: `Experience Hide Request - ${experience.title}`,
                reqOrApp
            });
            return { message: "Hide request submitted for admin review", hideRequested: true };
        }

        if (action === "hide") {
            experience.isHidden = true;
            experience.hiddenAt = new Date();
            experience.hideReason = reason || "Hidden by host";
            experience.hideRequested = false;
            experience.unhideRequested = false;
            experience.unhideRequestedAt = undefined;
            await experience.save();
            await recordHostAuditLog(this.hostAuditLogModel, {
                type: "experience_hide",
                hostId: experience.user,
                hostName,
                snapshot: { experienceId: experience._id, title: experience.title, reason: experience.hideReason }
            }, { hostId: experience.user, type: "experience_hide" });
            return { message: "Experience hidden successfully", isHidden: true };
        }

        if (action === "request_unhide") {
            if (!experience.isHidden) throw Object.assign(new Error("Experience is not currently hidden"), { statusCode: 400 });
            experience.unhideRequested = true;
            experience.hideRequested = false;
            experience.unhideRequestedAt = new Date();
            await experience.save();
            await this.notifyExperienceAdmin({
                experienceId: experience._id,
                userId,
                title: "Experience Unhide Request",
                message: `Host ${hostName} requested to unhide "${experience.title}".`,
                reqOrApp
            });
            return { message: "Unhide request submitted for admin review", unhideRequested: true };
        }

        if (action === "unhide") {
            if (userRole !== "admin") throw Object.assign(new Error("Only admins can approve unhiding an experience"), { statusCode: 403 });
            experience.isHidden = false;
            experience.hiddenAt = undefined;
            experience.hideReason = "";
            experience.hideRequested = false;
            experience.unhideRequested = false;
            experience.unhideRequestedAt = undefined;
            await experience.save();
            await recordHostAuditLog(this.hostAuditLogModel, {
                type: "experience_unhide",
                hostId: experience.user,
                hostName,
                snapshot: { experienceId: experience._id, title: experience.title }
            }, { hostId: experience.user, type: "experience_unhide" });
            return { message: "Experience unhidden successfully", isHidden: false };
        }

        throw Object.assign(new Error("Invalid action. Must be 'hide', 'request_hide', 'unhide', or 'request_unhide'"), { statusCode: 400 });
    }

    public async deleteExperience(experienceId: string, userId: string, userRole: string, reqOrApp: any = null): Promise<{ success: boolean; message: string; pendingReview?: boolean }> {
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });
        if (experience.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You can only delete your own experiences"), { statusCode: 403 });
        }

        const hostUser = await this.userModel.findById(experience.user);
        const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

        if (userRole !== "admin" && experience.status === "active") {
            experience.deleteRequested = true;
            experience.deleteRequestedAt = new Date();
            await experience.save();
            await this.notifyExperienceAdmin({
                experienceId: experience._id,
                userId,
                title: "Experience Deletion Request",
                message: `Host ${hostName} requested deletion of "${experience.title}".`,
                templateName: "admin-experience-deletion-request",
                templateData: { hostName, title: experience.title },
                emailSubject: `Experience Deletion Request - ${experience.title}`,
                reqOrApp
            });
            return { success: true, message: "Deletion request submitted to admin for review. The experience will remain active until approved.", pendingReview: true };
        }

        await recordHostAuditLog(this.hostAuditLogModel, {
            type: "experience_delete",
            hostId: experience.user,
            hostName,
            snapshot: {
                experienceId: experience._id,
                title: experience.title,
                subtitle: experience.subtitle,
                description: experience.description,
                longDescription: experience.longDescription,
                price: experience.price,
                duration: experience.duration,
                location: experience.location,
                capacity: experience.capacity,
                amenities: experience.amenities,
                rules: experience.privacyPolicy,
                photos: experience.photos,
                categories: experience.categories
            }
        }, { type: "experience_delete" });

        await deleteMediaAssets(this.storageService, this.googleDriveService, [...(experience.photos || []), ...(experience.videos || [])]);
        await this.bookingService.cancelBookingsForExperience(experienceId);
        await this.savedExperienceModel.deleteMany({ experience: experienceId });
        await this.reviewService.deleteExperienceReviews(experienceId);
        await this.experienceModel.findByIdAndDelete(experienceId);
        return { success: true, message: "Experience deleted successfully" };
    }

    public async saveExperience(experienceId: string, userId: string, userRole: string): Promise<{ success: boolean; message: string }> {
        if (userRole === "host") throw Object.assign(new Error("Hosts cannot bookmark another host's experience. Only guests can."), { statusCode: 400 });
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });
        const added = await this.userService.addSavedExperience(userId, experienceId);
        if (added) await this.experienceModel.findByIdAndUpdate(experienceId, { $inc: { savesCount: 1 } });
        return { success: true, message: "Experience saved successfully" };
    }

    public async unsaveExperience(experienceId: string, userId: string): Promise<{ success: boolean; message: string }> {
        const removed = await this.userService.removeSavedExperience(userId, experienceId);
        if (removed) {
            const exp = await this.experienceModel.findById(experienceId);
            if (exp && exp.savesCount > 0) {
                await this.experienceModel.findByIdAndUpdate(experienceId, { $inc: { savesCount: -1 } });
            }
        }
        return { success: true, message: "Experience removed from saved list" };
    }

    // ==================== QUERY ACTIONS ====================

    public async getExperiences(options: GetExperiencesOptions = {}): Promise<PaginatedExperiencesResult> {
        const { page = 1, limit = 20, sort = "latest", isFeatured, isAdmin, host, search } = options as any;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 20));
        const skip = (pageNum - 1) * limitNum;

        let filter: any;
        if (isAdmin) {
            filter = {};
            if (options.status) filter.status = options.status;
            if (host) filter.user = host;
            const categoryInput = options.categories || (options as any).category;
            if (categoryInput) {
                const catFilter = buildCategoryFilter(categoryInput);
                if (catFilter) filter.categories = catFilter;
            }
            if (search) {
                const userIds = await this.userModel.find({
                    $or: [
                        { firstname: { $regex: search, $options: "i" } },
                        { lastname: { $regex: search, $options: "i" } },
                        { email: { $regex: search, $options: "i" } }
                    ]
                }).select("_id");
                filter.$or = [
                    { title: { $regex: search, $options: "i" } },
                    { "location.city": { $regex: search, $options: "i" } },
                    { user: { $in: userIds.map((u: any) => u._id) } }
                ];
            }
        } else {
            filter = buildExperiencesFilter(options);
        }

        const normalizedSort = (sort || "latest").toLowerCase();
        if (normalizedSort === "bookings" || normalizedSort === "loved" || normalizedSort === "popular") {
            const neededLimit = skip + limitNum;
            const [topSaved, topBooked, topClicked, total] = await Promise.all([
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname avatar").sort({ savesCount: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname avatar").sort({ bookingCount: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).populate("user", "firstname lastname avatar").sort({ clicks: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.countDocuments(filter)
            ]);
            const merged = roundRobinMerge([topSaved, topBooked, topClicked], skip, limitNum);
            return { count: merged.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), experiences: merged };
        }

        const sortCriteria: any = {
            featured: { isFeatured: -1, createdAt: -1 },
            rating: { "rating.average": -1, "rating.count": -1, createdAt: -1 },
            "price-asc": { "price.perPerson": 1 },
            price_low: { "price.perPerson": 1 },
            "price-desc": { "price.perPerson": -1 },
            price_high: { "price.perPerson": -1 },
            clicks: { clicks: -1, createdAt: -1 },
            recent: { createdAt: -1 },
            latest: { createdAt: -1 }
        }[normalizedSort] || { createdAt: -1 };

        if (isFeatured !== undefined && (isFeatured === "true" || isFeatured === true)) {
            sortCriteria.isFeatured = -1;
        }

        const [experiences, total] = await Promise.all([
            this.experienceModel.find(filter)
                .select(isAdmin ? "-pendingUpdate" : LISTING_CARD_PROJECTION)
                .populate("user", isAdmin ? "firstname lastname avatar email" : "firstname lastname avatar")
                .sort(sortCriteria)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            this.experienceModel.countDocuments(filter)
        ]);
        return { count: experiences.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), experiences };
    }

    public async getExperienceDetail(experienceId: string): Promise<ExperienceDetailResult> {
        const experience = await this.experienceModel.findById(experienceId)
            .populate("user", "firstname lastname avatar role description isVerified");
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });

        this.experienceModel.findByIdAndUpdate(experienceId, { $inc: { clicks: 1 } }).catch((err: any) => console.error("Clicks increment error:", err));

        const similarOrConditions: any[] = [];
        if (Array.isArray(experience.categories) && experience.categories.length > 0) {
            similarOrConditions.push({ categories: { $in: experience.categories } });
        }
        if (experience.location?.city) {
            similarOrConditions.push({ "location.city": experience.location.city });
        }

        const similarFilter: any = {
            _id: { $ne: experience._id },
            status: "active",
            isHidden: { $ne: true }
        };
        if (similarOrConditions.length > 0) {
            similarFilter.$or = similarOrConditions;
        }

        const [similarExperiences, reviews] = await Promise.all([
            this.experienceModel.find(similarFilter)
                .select(LISTING_CARD_PROJECTION)
                .populate("user", "firstname lastname avatar")
                .limit(6)
                .lean(),
            this.reviewService.getExperienceReviews(experienceId, 10)
        ]);

        return {
            experience,
            reviews: { count: reviews.length, data: reviews },
            similarExperiences
        };
    }

    public async getTopRatedTreks(options: GetTopRatedTreksOptions = {}): Promise<TopRatedTreksResult> {
        const { limit = 10, page = 1, minRating = 0 } = options;
        const pageNum = Math.max(1, parseInt(String(page)));
        const limitNum = Math.min(50, Math.max(1, parseInt(String(limit))));
        const skip = (pageNum - 1) * limitNum;

        const query: any = {
            status: "active",
            isHidden: { $ne: true },
            categories: { $in: ["Trek", "Trekking", "trek", "trekking"] },
            "rating.average": { $gte: parseFloat(String(minRating)) }
        };

        const [treks, total] = await Promise.all([
            this.experienceModel.find(query)
                .select(LISTING_CARD_PROJECTION)
                .populate("user", "firstname lastname avatar")
                .sort({ "rating.average": -1, "rating.count": -1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            this.experienceModel.countDocuments(query)
        ]);

        return { count: treks.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), treks };
    }

    public async getNearbyTreks(options: GetNearbyTreksOptions = {}): Promise<NearbyTreksResult> {
        const { latitude, longitude, limit = 10, page = 1, difficulty, minPrice, maxPrice, categories } = options;
        if (!latitude || !longitude) throw Object.assign(new Error("latitude and longitude query parameters are required"), { statusCode: 400 });

        const lat = parseFloat(String(latitude));
        const lng = parseFloat(String(longitude));
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw Object.assign(new Error("Invalid coordinates"), { statusCode: 400 });
        }

        const pageNum = Math.max(1, parseInt(String(page)));
        const limitNum = Math.min(50, Math.max(1, parseInt(String(limit))));
        const skip = (pageNum - 1) * limitNum;

        const matchStage: any = {
            status: "active",
            isHidden: { $ne: true },
            categories: { $in: ["Trek", "Trekking", "trek", "trekking"] }
        };

        if (difficulty) matchStage.difficulty = difficulty;
        if (categories) {
            const cFilter = buildCategoryFilter(categories);
            if (cFilter) matchStage.categories = cFilter;
        }
        if (minPrice || maxPrice) {
            matchStage["price.perPerson"] = {};
            if (minPrice) matchStage["price.perPerson"].$gte = parseFloat(String(minPrice));
            if (maxPrice) matchStage["price.perPerson"].$lte = parseFloat(String(maxPrice));
        }

        const pipeline: any[] = [
            {
                $geoNear: {
                    near: { type: "Point", coordinates: [lng, lat] },
                    distanceField: "distanceMeters",
                    spherical: true,
                    query: matchStage
                }
            },
            {
                $addFields: {
                    distance: { $round: [{ $divide: ["$distanceMeters", 1000] }, 1] },
                    distanceUnit: "km"
                }
            },
            { $project: { distanceMeters: 0, pendingUpdate: 0 } },
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    pipeline: [{ $project: { firstname: 1, lastname: 1, avatar: 1 } }],
                    as: "userDetails"
                }
            },
            {
                $addFields: {
                    user: { $arrayElemAt: ["$userDetails", 0] }
                }
            },
            { $project: { userDetails: 0 } },
            { $skip: skip },
            { $limit: limitNum }
        ];

        let treks: any[] = [];
        let total = 0;
        try {
            [treks, total] = await Promise.all([
                this.experienceModel.aggregate(pipeline),
                this.experienceModel.countDocuments(matchStage)
            ]);
        } catch (geoError: any) {
            console.warn("Falling back to manual distance calculation:", geoError.message);
            const allTreks = await this.experienceModel.find(matchStage).populate("user", "firstname lastname avatar").lean();
            const withDist = attachDistanceToTreks(allTreks, lat, lng).sort((a: any, b: any) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
            treks = withDist.slice(skip, skip + limitNum);
            total = withDist.length;
        }

        return { count: treks.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), treks };
    }

    public async getUserExperiences(userId: string, isSelfOrAdmin: boolean = false): Promise<any[]> {
        const filter: any = { user: userId };
        if (!isSelfOrAdmin) {
            filter.status = "active";
            filter.isHidden = { $ne: true };
        }
        return this.experienceModel.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate("user", "firstname lastname avatar")
            .sort({ createdAt: -1 })
            .lean();
    }

    public async getPendingExperiences(options: GetPendingExperiencesOptions = {}): Promise<PaginatedExperiencesResult> {
        const { page = 1, limit = 50 } = options;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 50));
        const skip = (pageNum - 1) * limitNum;

        const query: any = {
            $or: [
                { status: "pending" },
                { pendingUpdate: { $ne: null } },
                { deleteRequested: true },
                { hideRequested: true },
                { unhideRequested: true }
            ]
        };

        const [experiences, total] = await Promise.all([
            this.experienceModel.find(query)
                .populate("user", "firstname lastname avatar email")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum),
            this.experienceModel.countDocuments(query)
        ]);

        const mapped = experiences.map((exp: any) => {
            const expObj = typeof exp.toObject === "function" ? exp.toObject() : { ...exp };
            if (expObj.deleteRequested) expObj.isDeleteRequested = true;
            if (expObj.hideRequested) expObj.isHideRequested = true;
            if (expObj.unhideRequested) expObj.isUnhideRequested = true;
            if (expObj.pendingUpdate) {
                return {
                    ...expObj,
                    ...expObj.pendingUpdate,
                    isPendingUpdate: true,
                    originalFields: {
                        title: exp.title,
                        subtitle: exp.subtitle,
                        description: exp.description,
                        longDescription: exp.longDescription,
                        location: exp.location,
                        price: exp.price,
                        amenities: exp.amenities,
                        privacyPolicy: exp.privacyPolicy,
                        capacity: exp.capacity,
                        availability: exp.availability,
                        categories: exp.categories,
                        difficulty: exp.difficulty,
                        duration: exp.duration,
                        photos: exp.photos,
                        videos: exp.videos,
                        tags: exp.tags,
                        discounts: exp.discounts,
                        season: exp.season
                    }
                };
            }
            return expObj;
        });

        return { count: mapped.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), experiences: mapped };
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const activity = await this.experienceModel.aggregate([
            { $match: { status: "active", isHidden: { $ne: true } } },
            { $unwind: "$categories" },
            {
                $group: {
                    _id: "$categories",
                    latestApprovedAt: { $max: { $ifNull: ["$approvedAt", "$createdAt"] } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { latestApprovedAt: -1 } }
        ]);

        return activity.map((item: any) => ({
            category: item._id,
            normalizedCategory: String(item._id).toLowerCase().replace(/[^a-z0-9]/g, "-"),
            latestApprovedAt: item.latestApprovedAt,
            count: item.count,
            isNew: item.latestApprovedAt ? new Date(item.latestApprovedAt) >= thirtyDaysAgo : false
        }));
    }
}

export const experienceActionService = ExperienceActionService.getInstance();
export default ExperienceActionService;

// CommonJS compatibility
module.exports = experienceActionService;
module.exports.ExperienceActionService = ExperienceActionService;
module.exports.experienceActionService = experienceActionService;
module.exports.default = ExperienceActionService;
