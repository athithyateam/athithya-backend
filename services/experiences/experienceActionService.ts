const { Experience, User, Notification, HostDetails, HostAuditLog, Booking, SavedExperience } = require("../../db/mongoose");
const { storageService: defaultStorageService } = require("../storageService");
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
const { emailService: defaultEmailService } = require("../emailService");
import { notificationService } from "../notificationService";
const defaultNotifyAdmins = (reqOrApp: any, payload?: any) => notificationService.notifyAdmins(payload || reqOrApp);
const { userService: defaultUserService } = require("../userService");
import { reviewService as defaultReviewService, ReviewService } from "../reviewService";
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
    private bookingModel: any;
    private reviewService: ReviewService;
    private savedExperienceModel: any;
    private storageService: any;
    private googleDriveService: any;
    private emailService: any;
    private adminNotifier: (reqOrApp: any, payload: any) => Promise<any>;
    private userService: any;

    constructor(instanceKey: symbol, ...args: any[]) {
        if (instanceKey !== ExperienceActionService.instanceKey) throw new Error("Use ExperienceActionService.getInstance()");
        const [em = Experience, um = User, nm = Notification, halm = HostAuditLog, bm = Booking, ss = defaultStorageService, gds = defaultGoogleDriveService, es = defaultEmailService, an = defaultNotifyAdmins, us = defaultUserService, rs = defaultReviewService, hdm = HostDetails, sem = SavedExperience] = args;
        this.experienceModel = em; this.userModel = um; this.notificationModel = nm; this.hostAuditLogModel = halm;
        this.bookingModel = bm; this.storageService = ss; this.googleDriveService = gds; this.emailService = es;
        this.adminNotifier = an; this.userService = us; this.reviewService = rs;
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
                senderId: options.userId, title: options.title, message: options.message,
                link: options.link || `/admin?reviewId=${options.experienceId}`, type: options.type || "info",
                emailSubject: options.emailSubject, emailHtml, metadata: { experienceId: options.experienceId, userId: options.userId }
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
            ...parseExperiencePayload(experiencePayload), user: userId, userRole, photos, videos, status: "pending"
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
            experienceId: experience._id, userId, title: "New Experience Approval Request",
            message: `Host ${hostname} submitted "${experience.title}" for approval.`,
            templateName: "admin-new-experience-approval",
            templateData: { hostname, hostEmail: hostUser.email || "N/A", title: experience.title, category: (experience.categories || []).join(", ") || "N/A", locationDetails: locDetails, priceDetails, description: experience.description },
            emailSubject: "New Experience Awaiting Approval - Athithya", reqOrApp
        });

        return experience;
    }

    public async updateExperience(experienceId: string, userId: string, userRole: string, updatePayload: any, _files: any = null, reqOrApp: any = null): Promise<any> {
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });
        if (experience.user.toString() !== userId && userRole !== "admin") {
            throw Object.assign(new Error("You can only edit your own experiences"), { statusCode: 403 });
        }

        const existingPhotos = parseIfJson(updatePayload.existingPhotos) || [];
        const existingVideos = parseIfJson(updatePayload.existingVideos) || [];
        const isLive = experience.status === "active";
        const isHost = userRole !== "admin";

        if (!isLive || !isHost) {
            await cleanupMediaAssets(this.storageService, experience.photos, existingPhotos);
            await cleanupMediaAssets(this.storageService, experience.videos, existingVideos);
        }

        const { photos, videos } = this.processMediaInputs(updatePayload.photos, updatePayload.videos, existingPhotos, existingVideos);
        const normalized = parseExperiencePayload(updatePayload, experience);

        if (isHost && isLive) {
            experience.pendingUpdate = { ...normalized, photos, videos };
            await experience.save();
            const hostUser = await this.userModel.findById(userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";
            await this.notifyExperienceAdmin({
                experienceId: experience._id, userId, title: "Experience Update Pending Approval",
                message: `Host ${hostName} submitted changes to "${experience.title}" for your review.`,
                templateName: "admin-experience-update-approval", templateData: { hostName, title: experience.title },
                emailSubject: `Experience Update Submitted - ${experience.title}`, reqOrApp
            });
            return { isPendingReview: true, message: "Changes submitted for admin approval. The experience remains active with original details.", experience };
        }

        Object.assign(experience, normalized);
        experience.photos = photos; experience.videos = videos;
        if (isHost) experience.status = "pending";
        else if (updatePayload.status) experience.status = updatePayload.status;
        experience.pendingUpdate = null;
        await experience.save();

        if (isHost) {
            await this.notifyExperienceAdmin({
                experienceId: experience._id, userId, title: "Experience Re-submitted for Approval",
                message: `A host has updated and re-submitted "${experience.title}" for your review.`, reqOrApp
            });
        }
        return { isPendingReview: false, message: "Experience updated successfully", experience };
    }

    public async updateExperienceStatus(experienceId: string, status: string, remarks?: string): Promise<any> {
        if (!["active", "inactive", "archived", "pending"].includes(status)) {
            throw Object.assign(new Error("Invalid status"), { statusCode: 400 });
        }
        const experience = await this.experienceModel.findById(experienceId);
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });

        if (status === "active" && experience.pendingUpdate) {
            await cleanupMediaAssets(this.storageService, experience.photos, experience.pendingUpdate.photos || []);
            await cleanupMediaAssets(this.storageService, experience.videos, experience.pendingUpdate.videos || []);
            Object.assign(experience, experience.pendingUpdate);
            experience.pendingUpdate = null;
        }

        experience.status = status;
        if (remarks !== undefined) experience.remarks = remarks;
        await experience.save();
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

        if (action === "hide") {
            experience.isHidden = true;
            experience.hiddenAt = new Date();
            experience.hiddenReason = reason || "Hidden by host";
            experience.unhideRequested = false;
            experience.unhideRequestedAt = undefined;
            await experience.save();
            await recordHostAuditLog(this.hostAuditLogModel, {
                type: "experience_hide", hostId: experience.user, hostName,
                snapshot: { experienceId: experience._id, title: experience.title, reason: experience.hiddenReason }
            }, { hostId: experience.user, type: "experience_hide" });
            return { message: "Experience hidden successfully", isHidden: true };
        }

        if (action === "request_unhide") {
            if (!experience.isHidden) throw Object.assign(new Error("Experience is not currently hidden"), { statusCode: 400 });
            experience.unhideRequested = true;
            experience.unhideRequestedAt = new Date();
            await experience.save();
            await this.notifyExperienceAdmin({
                experienceId: experience._id, userId, title: "Experience Unhide Request",
                message: `Host ${hostName} requested to unhide "${experience.title}".`, reqOrApp
            });
            return { message: "Unhide request submitted for admin review", unhideRequested: true };
        }

        if (action === "unhide") {
            if (userRole !== "admin") throw Object.assign(new Error("Only admins can approve unhiding an experience"), { statusCode: 403 });
            experience.isHidden = false;
            experience.hiddenAt = undefined;
            experience.hiddenReason = undefined;
            experience.unhideRequested = false;
            experience.unhideRequestedAt = undefined;
            await experience.save();
            await recordHostAuditLog(this.hostAuditLogModel, {
                type: "experience_unhide", hostId: experience.user, hostName,
                snapshot: { experienceId: experience._id, title: experience.title }
            }, { hostId: experience.user, type: "experience_unhide" });
            return { message: "Experience unhidden successfully", isHidden: false };
        }

        throw Object.assign(new Error("Invalid action. Must be 'hide', 'request_unhide', or 'unhide'"), { statusCode: 400 });
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
            experience.deletionRequested = true;
            experience.deletionRequestedAt = new Date();
            await experience.save();
            await this.notifyExperienceAdmin({
                experienceId: experience._id, userId, title: "Experience Deletion Request",
                message: `Host ${hostName} requested deletion of "${experience.title}".`, reqOrApp
            });
            return { success: true, message: "Deletion request submitted to admin for review. The experience will remain active until approved.", pendingReview: true };
        }

        await recordHostAuditLog(this.hostAuditLogModel, {
            type: "experience_delete", hostId: experience.user, hostName,
            snapshot: {
                experienceId: experience._id, title: experience.title, subtitle: experience.subtitle,
                description: experience.description, longDescription: experience.longDescription,
                price: experience.price, duration: experience.duration, location: experience.location,
                capacity: experience.capacity, amenities: experience.amenities, rules: experience.privacyPolicy,
                photos: experience.photos, categories: experience.categories
            }
        }, { type: "experience_delete" });

        await deleteMediaAssets(this.storageService, this.googleDriveService, [...(experience.photos || []), ...(experience.videos || [])]);
        await this.bookingModel.updateMany({ experience: experienceId, status: { $in: ["pending", "accepted", "in_progress", "cancel_requested"] } }, { $set: { status: "cancelled" } });
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
        if (removed) await this.experienceModel.findByIdAndUpdate(experienceId, { $inc: { savesCount: -1 } });
        return { success: true, message: "Experience removed from saved list" };
    }

    // ==================== QUERY ACTIONS ====================

    public async getExperiences(options: GetExperiencesOptions = {}): Promise<PaginatedExperiencesResult> {
        const { page = 1, limit = 20, sort = "latest", isFeatured } = options;
        const filter = buildExperiencesFilter(options);
        const skip = (Number(page) - 1) * Number(limit);

        if (sort === "bookings" || sort === "loved") {
            const neededLimit = skip + Number(limit);
            const [topSaved, topBooked, topClicked, total] = await Promise.all([
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).sort({ savesCount: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).sort({ bookingCount: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).sort({ clicks: -1, createdAt: -1 }).limit(neededLimit).lean(),
                this.experienceModel.countDocuments(filter)
            ]);
            const merged = roundRobinMerge([topSaved, topBooked, topClicked], skip, Number(limit));
            return { count: merged.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), experiences: merged };
        }

        const sortCriteria: any = {
            featured: { isFeatured: -1, createdAt: -1 },
            rating: { "rating.average": -1, "rating.count": -1, createdAt: -1 },
            "price-asc": { "price.perPerson": 1 },
            "price-desc": { "price.perPerson": -1 },
            popular: { bookingCount: -1, createdAt: -1 },
            clicks: { clicks: -1, createdAt: -1 },
            latest: { createdAt: -1 }
        }[sort] || { createdAt: -1 };

        if (isFeatured !== undefined && (isFeatured === "true" || isFeatured === true)) {
            sortCriteria.isFeatured = -1;
        }

        const [experiences, total] = await Promise.all([
            this.experienceModel.find(filter).select(LISTING_CARD_PROJECTION).sort(sortCriteria).skip(skip).limit(Number(limit)).lean(),
            this.experienceModel.countDocuments(filter)
        ]);
        return { count: experiences.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), experiences };
    }

    public async getExperienceDetail(experienceId: string): Promise<ExperienceDetailResult> {
        const experience = await this.experienceModel.findById(experienceId).populate("user", "firstname lastname avatar");
        if (!experience) throw Object.assign(new Error("Experience not found"), { statusCode: 404 });

        this.experienceModel.findByIdAndUpdate(experienceId, { $inc: { clicks: 1 } }).catch((err: any) => console.error("Clicks increment error:", err));

        const [similarExperiences, reviews] = await Promise.all([
            this.experienceModel.find({
                _id: { $ne: experience._id }, status: "active",
                $or: [
                    { categories: { $in: experience.categories || [] } },
                    { "location.city": experience.location?.city }
                ]
            }).select(LISTING_CARD_PROJECTION).limit(6).lean(),
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
            status: "active", isHidden: { $ne: true },
            categories: { $in: ["Trek", "Trekking", "trek", "trekking"] },
            "rating.average": { $gte: parseFloat(String(minRating)) }
        };

        const [treks, total] = await Promise.all([
            this.experienceModel.find(query).select(LISTING_CARD_PROJECTION)
                .sort({ "rating.average": -1, "rating.count": -1, createdAt: -1 })
                .skip(skip).limit(limitNum).lean(),
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
            status: "active", isHidden: { $ne: true },
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
                    distanceField: "distanceMeters", spherical: true, query: matchStage
                }
            },
            {
                $addFields: {
                    distance: { $round: [{ $divide: ["$distanceMeters", 1000] }, 1] },
                    distanceUnit: "km"
                }
            },
            { $project: { distanceMeters: 0, pendingUpdate: 0 } },
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
            const allTreks = await this.experienceModel.find(matchStage).lean();
            const withDist = attachDistanceToTreks(allTreks, lat, lng).sort((a: any, b: any) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
            treks = withDist.slice(skip, skip + limitNum);
            total = withDist.length;
        }

        return { count: treks.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), treks };
    }

    public async getUserExperiences(userId: string): Promise<any[]> {
        return this.experienceModel.find({ user: userId }).select(LISTING_CARD_PROJECTION).sort({ createdAt: -1 }).lean();
    }

    public async getPendingExperiences(options: GetPendingExperiencesOptions = {}): Promise<PaginatedExperiencesResult> {
        const { page = 1, limit = 20 } = options;
        const pageNum = Math.max(1, parseInt(String(page)));
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
        const skip = (pageNum - 1) * limitNum;

        const query: any = { status: "pending" };
        const [experiences, total] = await Promise.all([
            this.experienceModel.find(query).populate("user", "firstname lastname email").sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
            this.experienceModel.countDocuments(query)
        ]);

        return { count: experiences.length, total, page: pageNum, totalPages: Math.ceil(total / limitNum), experiences };
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        const fixedCategories = [
            "Wildlife Safari", "Heritage Walks", "Adventure", "Culinary & Cooking",
            "Art & Craft", "Nature & Ecology", "Photography", "Spiritual & Wellness", "Trek", "Others"
        ];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const results = await Promise.all(fixedCategories.map(async (cat) => {
            const isOthers = cat === "Others";
            const matchQuery: any = {
                status: "active",
                categories: isOthers
                    ? { $in: ["Others", "Other", "Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding"] }
                    : { $in: [cat] }
            };
            const [count, latestExperience] = await Promise.all([
                this.experienceModel.countDocuments(matchQuery),
                this.experienceModel.findOne(matchQuery).select("createdAt approvedAt").sort({ approvedAt: -1, createdAt: -1 }).lean()
            ]);
            const latestDate = latestExperience?.approvedAt || latestExperience?.createdAt || new Date(0);
            return {
                category: cat,
                normalizedCategory: cat.toLowerCase().replace(/[^a-z0-9]/g, "-"),
                latestApprovedAt: latestDate,
                count,
                isNew: new Date(latestDate) >= thirtyDaysAgo
            };
        }));

        return results.sort((a, b) => new Date(b.latestApprovedAt).getTime() - new Date(a.latestApprovedAt).getTime());
    }
}

export const experienceActionService = ExperienceActionService.getInstance();
export default ExperienceActionService;
