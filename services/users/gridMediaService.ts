/**
 * Host Grid Media Service
 * Domain service managing host profile media grids (both experience media and personal moments).
 * Handles media retrieval, preference state, pinning, S3 deletions, and Google Drive background syncing.
 */

import mongoose from "mongoose";
const { User, Experience, HostPersonalMedia, HostPinnedExperienceMedia } = require("../../db/mongoose");
import { deleteFile as defaultDeleteFile } from "../storageService";
import { notificationService as defaultNotificationService } from "../notificationService";
const { googleDriveService: defaultGoogleDriveService } = require("../googleDriveService");
import { BadRequestError, NotFoundError } from "../../errors";

export interface MediaItemInput {
    url: string;
    public_id?: string;
    mediaType?: string;
    [key: string]: any;
}

export interface ExperienceMediaItem {
    _id: string;
    key: string;
    url: string;
    public_id: string;
    mediaType: "image" | "video";
    title: string;
    experienceId: any;
    isPinned: boolean;
    createdAt: Date;
}

export interface HostGridMediaResult {
    experienceMedia: ExperienceMediaItem[];
    personalMedia: any[];
    activeGridTab: "experience" | "personal";
}

export class GridMediaService {
    private static instance: GridMediaService | null = null;
    private static instanceKey = Symbol("GridMediaServiceInstanceKey");

    private userModel: any;
    private experienceModel: any;
    private personalMediaModel: any;
    private pinnedMediaModel: any;
    private fileDeleter: (key: string) => Promise<any>;
    private notificationSvc: any;
    private googleDriveSvc: any;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        experienceModel: any = Experience,
        personalMediaModel: any = HostPersonalMedia,
        pinnedMediaModel: any = HostPinnedExperienceMedia,
        fileDeleter: (key: string) => Promise<any> = defaultDeleteFile,
        notificationSvc: any = defaultNotificationService,
        googleDriveSvc: any = defaultGoogleDriveService
    ) {
        if (instanceKey !== GridMediaService.instanceKey) {
            throw new Error("Use GridMediaService.getInstance() to obtain the singleton instance.");
        }
        this.userModel = userModel;
        this.experienceModel = experienceModel;
        this.personalMediaModel = personalMediaModel;
        this.pinnedMediaModel = pinnedMediaModel;
        this.fileDeleter = fileDeleter;
        this.notificationSvc = notificationSvc;
        this.googleDriveSvc = googleDriveSvc;
    }

    public static getInstance(
        userModel?: any,
        experienceModel?: any,
        personalMediaModel?: any,
        pinnedMediaModel?: any,
        fileDeleter?: (key: string) => Promise<any>,
        notificationSvc?: any,
        googleDriveSvc?: any
    ): GridMediaService {
        if (!this.instance) {
            this.instance = new GridMediaService(
                this.instanceKey,
                userModel || User,
                experienceModel || Experience,
                personalMediaModel || HostPersonalMedia,
                pinnedMediaModel || HostPinnedExperienceMedia,
                fileDeleter || defaultDeleteFile,
                notificationSvc || defaultNotificationService,
                googleDriveSvc || defaultGoogleDriveService
            );
        }
        return this.instance;
    }

    /**
     * Get host profile grid media (experience media and personal moments)
     */
    public async getHostGridMedia(userId: string): Promise<HostGridMediaResult> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new BadRequestError("Invalid user ID format");
        }

        const user = await this.userModel.findById(userId).select("role");
        if (!user) {
            throw new NotFoundError("User not found");
        }

        const pinnedDocs = await this.pinnedMediaModel.find({ user: userId }).select("mediaKey");
        const pinnedExperienceKeys = pinnedDocs.map((d: any) => d.mediaKey);

        // Fetch experience media from active experiences
        const experiences = await this.experienceModel.find({ user: userId, status: "active" }).sort({ createdAt: -1 });

        const rawExperienceMedia: ExperienceMediaItem[] = [];
        for (const exp of experiences) {
            if (exp.photos && Array.isArray(exp.photos)) {
                for (const photo of exp.photos) {
                    if (photo && photo.url) {
                        const key = photo.public_id || photo.url;
                        rawExperienceMedia.push({
                            _id: photo._id ? photo._id.toString() : key,
                            key,
                            url: photo.url,
                            public_id: photo.public_id || "",
                            mediaType: "image",
                            title: exp.title,
                            experienceId: exp._id,
                            isPinned: pinnedExperienceKeys.includes(key),
                            createdAt: exp.createdAt
                        });
                    }
                }
            }
            if (exp.videos && Array.isArray(exp.videos)) {
                for (const video of exp.videos) {
                    if (video && video.url) {
                        const key = video.public_id || video.url;
                        rawExperienceMedia.push({
                            _id: video._id ? video._id.toString() : key,
                            key,
                            url: video.url,
                            public_id: video.public_id || "",
                            mediaType: "video",
                            title: exp.title,
                            experienceId: exp._id,
                            isPinned: pinnedExperienceKeys.includes(key),
                            createdAt: exp.createdAt
                        });
                    }
                }
            }
        }

        // Sort: pinned first, then latest created
        rawExperienceMedia.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            if (tB !== tA) return tB - tA;
            return (a.key || "").localeCompare(b.key || "");
        });

        const experienceMedia = rawExperienceMedia.slice(0, 20);

        const personalMedia = await this.personalMediaModel.find({ user: userId })
            .sort({ isPinned: -1, createdAt: -1 })
            .limit(20);

        return {
            experienceMedia,
            personalMedia,
            activeGridTab: "experience"
        };
    }

    /**
     * Update active grid tab preference and broadcast socket update
     */
    public async updateGridTabPreference(userId: string, activeGridTab: string): Promise<{ activeGridTab: string }> {
        if (!["experience", "personal"].includes(activeGridTab)) {
            throw new BadRequestError("Invalid grid tab preference");
        }

        this.notificationSvc.emitToAll("host_grid_tab_updated", {
            hostId: userId,
            activeGridTab
        });

        return { activeGridTab };
    }

    /**
     * Add personal media items and asynchronously sync to Google Drive
     */
    public async addPersonalMedia(userId: string, items: MediaItemInput[]): Promise<any[]> {
        if (!Array.isArray(items) || items.length === 0) {
            throw new BadRequestError("Please provide at least one media item to upload");
        }

        const mediaToInsert = items.map((item) => ({
            user: userId,
            url: item.url,
            public_id: item.public_id || "",
            mediaType: item.mediaType === "video" ? "video" : "image"
        }));

        const inserted = await this.personalMediaModel.insertMany(mediaToInsert);

        // Async background sync to Google Drive
        setImmediate(async () => {
            try {
                if (this.googleDriveSvc?.syncMediaItems) {
                    for (const doc of inserted) {
                        const defaultMime = doc.mediaType === "video" ? "video/mp4" : "image/jpeg";
                        const updated = await this.googleDriveSvc.syncMediaItems(
                            [doc],
                            `MOMENTO_${doc.user}_${doc._id}`,
                            "momentos",
                            defaultMime
                        );
                        if (updated && doc.googleDriveFileId) {
                            await this.personalMediaModel.findByIdAndUpdate(doc._id, {
                                googleDriveFileId: doc.googleDriveFileId
                            });
                        }
                    }
                }
            } catch (driveErr: any) {
                console.error("[GoogleDriveSync] Momentos upload background sync failed:", driveErr.message);
            }
        });

        return inserted;
    }

    /**
     * Delete personal media item from DB, S3, and Google Drive
     */
    public async deletePersonalMedia(userId: string, mediaId: string): Promise<void> {
        const media = await this.personalMediaModel.findOne({ _id: mediaId, user: userId });
        if (!media) {
            throw new NotFoundError("Personal media not found or unauthorized");
        }

        if (media.public_id) {
            try {
                await this.fileDeleter(media.public_id);
            } catch (err) {}
        }

        if (media.googleDriveFileId && this.googleDriveSvc?.deleteMedia) {
            try {
                await this.googleDriveSvc.deleteMedia(media.googleDriveFileId);
            } catch (err) {}
        }

        await this.personalMediaModel.deleteOne({ _id: mediaId });
    }

    /**
     * Toggle pin on personal media item
     */
    public async togglePinPersonalMedia(userId: string, mediaId: string): Promise<{ isPinned: boolean }> {
        const media = await this.personalMediaModel.findOne({ _id: mediaId, user: userId });
        if (!media) {
            throw new NotFoundError("Personal media not found or unauthorized");
        }

        media.isPinned = !media.isPinned;
        media.pinnedAt = media.isPinned ? new Date() : undefined;
        await media.save();

        return { isPinned: media.isPinned };
    }

    /**
     * Toggle pin on experience media item
     */
    public async togglePinExperienceMedia(
        userId: string,
        mediaKey: string
    ): Promise<{ isPinned: boolean; pinnedExperienceMedia: string[] }> {
        if (!mediaKey) {
            throw new BadRequestError("mediaKey is required");
        }

        const existingPin = await this.pinnedMediaModel.findOne({ user: userId, mediaKey });
        let isPinned = false;

        if (existingPin) {
            await this.pinnedMediaModel.deleteOne({ _id: existingPin._id });
            isPinned = false;
        } else {
            await this.pinnedMediaModel.create({ user: userId, mediaKey, pinnedAt: new Date() });
            isPinned = true;
        }

        const allPinnedDocs = await this.pinnedMediaModel.find({ user: userId }).select("mediaKey");
        const pinnedKeys = allPinnedDocs.map((d: any) => d.mediaKey);

        return {
            isPinned,
            pinnedExperienceMedia: pinnedKeys
        };
    }
}

export const gridMediaService = GridMediaService.getInstance();
