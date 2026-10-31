/**
 * Experience Service - Main Facade
 * Provides unified interface for experience operations and queries.
 */

import {
    ExperienceActionService,
    experienceActionService as defaultActionService,
    GetExperiencesOptions,
    PaginatedExperiencesResult,
    ExperienceDetailResult,
    GetTopRatedTreksOptions,
    TopRatedTreksResult,
    GetNearbyTreksOptions,
    NearbyTreksResult,
    GetPendingExperiencesOptions,
    CategoryActivityResult
} from "./experiences/experienceActionService";

import {
    parseExperiencePayload,
    calculatePricingAndFees,
    isValidS3MediaUrl,
    parseIfJson,
    LISTING_CARD_PROJECTION,
    calculateDistance,
    expandCategories,
    buildCategoryFilter,
    attachDistanceToTreks,
    getPlatformFeeRate,
    recordHostAuditLog,
    recordHostHistory,
    buildExperiencesFilter,
    roundRobinMerge,
    cleanupMediaAssets,
    deleteMediaAssets,
    ALLOWED_EXPERIENCE_CATEGORIES
} from "./experiences/experiencePayloadParser";

export {
    ExperienceActionService,
    calculatePricingAndFees,
    isValidS3MediaUrl,
    parseExperiencePayload,
    parseIfJson,
    LISTING_CARD_PROJECTION,
    calculateDistance,
    expandCategories,
    buildCategoryFilter,
    attachDistanceToTreks,
    getPlatformFeeRate,
    recordHostAuditLog,
    recordHostHistory,
    buildExperiencesFilter,
    roundRobinMerge,
    cleanupMediaAssets,
    deleteMediaAssets,
    ALLOWED_EXPERIENCE_CATEGORIES,
    GetExperiencesOptions,
    PaginatedExperiencesResult,
    ExperienceDetailResult,
    GetTopRatedTreksOptions,
    TopRatedTreksResult,
    GetNearbyTreksOptions,
    NearbyTreksResult,
    GetPendingExperiencesOptions,
    CategoryActivityResult
};

export class ExperienceService {
    private static instance: ExperienceService | null = null;
    private static instanceKey = Symbol("ExperienceServiceInstanceKey");

    private actionService: ExperienceActionService;

    constructor(
        instanceKey: symbol,
        actionService: ExperienceActionService = defaultActionService
    ) {
        if (instanceKey !== ExperienceService.instanceKey) {
            throw new Error("Use ExperienceService.getInstance() to obtain the singleton instance.");
        }
        this.actionService = actionService;

        this.createExperience = this.createExperience.bind(this);
        this.updateExperience = this.updateExperience.bind(this);
        this.updateExperienceStatus = this.updateExperienceStatus.bind(this);
        this.toggleHideExperience = this.toggleHideExperience.bind(this);
        this.deleteExperience = this.deleteExperience.bind(this);
        this.saveExperience = this.saveExperience.bind(this);
        this.unsaveExperience = this.unsaveExperience.bind(this);
        this.getExperiences = this.getExperiences.bind(this);
        this.getExperienceDetail = this.getExperienceDetail.bind(this);
        this.getTopRatedTreks = this.getTopRatedTreks.bind(this);
        this.getNearbyTreks = this.getNearbyTreks.bind(this);
        this.getUserExperiences = this.getUserExperiences.bind(this);
        this.getPendingExperiences = this.getPendingExperiences.bind(this);
        this.getCategoryActivity = this.getCategoryActivity.bind(this);
    }

    public static getInstance(actionService?: ExperienceActionService): ExperienceService {
        if (!this.instance) {
            this.instance = new ExperienceService(this.instanceKey, actionService);
        }
        return this.instance;
    }

    // Action Delegations
    public async createExperience(userId: string, userRole: string, experiencePayload: any, files?: any, reqOrApp?: any): Promise<any> {
        return this.actionService.createExperience(userId, userRole, experiencePayload, files, reqOrApp);
    }

    public async updateExperience(experienceId: string, userId: string, userRole: string, updatePayload: any, files?: any, reqOrApp?: any): Promise<any> {
        return this.actionService.updateExperience(experienceId, userId, userRole, updatePayload, files, reqOrApp);
    }

    public async updateExperienceStatus(experienceId: string, status: string, remarks?: string, adminUserId?: string, reqOrApp?: any): Promise<any> {
        return this.actionService.updateExperienceStatus(experienceId, status, remarks, adminUserId, reqOrApp);
    }

    public async toggleHideExperience(experienceId: string, userId: string, userRole: string, action: string, reason?: string, reqOrApp?: any): Promise<any> {
        return this.actionService.toggleHideExperience(experienceId, userId, userRole, action, reason, reqOrApp);
    }

    public async deleteExperience(experienceId: string, userId: string, userRole: string, reqOrApp?: any): Promise<{ success: boolean; message: string; pendingReview?: boolean }> {
        return this.actionService.deleteExperience(experienceId, userId, userRole, reqOrApp);
    }

    public async saveExperience(experienceId: string, userId: string, userRole: string): Promise<{ success: boolean; message: string }> {
        return this.actionService.saveExperience(experienceId, userId, userRole);
    }

    public async unsaveExperience(experienceId: string, userId: string): Promise<{ success: boolean; message: string }> {
        return this.actionService.unsaveExperience(experienceId, userId);
    }

    // Query Delegations
    public async getExperiences(options?: GetExperiencesOptions): Promise<PaginatedExperiencesResult> {
        return this.actionService.getExperiences(options);
    }

    public async getExperienceDetail(experienceId: string): Promise<ExperienceDetailResult> {
        return this.actionService.getExperienceDetail(experienceId);
    }

    public async getTopRatedTreks(options?: GetTopRatedTreksOptions): Promise<TopRatedTreksResult> {
        return this.actionService.getTopRatedTreks(options);
    }

    public async getNearbyTreks(options?: GetNearbyTreksOptions): Promise<NearbyTreksResult> {
        return this.actionService.getNearbyTreks(options);
    }

    public async getUserExperiences(userId: string, isSelfOrAdmin?: boolean): Promise<any[]> {
        return this.actionService.getUserExperiences(userId, isSelfOrAdmin);
    }

    public async getPendingExperiences(options?: GetPendingExperiencesOptions): Promise<PaginatedExperiencesResult> {
        return this.actionService.getPendingExperiences(options);
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        return this.actionService.getCategoryActivity();
    }
}

export const experienceService = ExperienceService.getInstance();
export default ExperienceService;

// Convenience bound exports
export const createExperience = experienceService.createExperience;
export const updateExperience = experienceService.updateExperience;
export const updateExperienceStatus = experienceService.updateExperienceStatus;
export const toggleHideExperience = experienceService.toggleHideExperience;
export const deleteExperience = experienceService.deleteExperience;
export const saveExperience = experienceService.saveExperience;
export const unsaveExperience = experienceService.unsaveExperience;
export const getExperiences = experienceService.getExperiences;
export const getExperienceDetail = experienceService.getExperienceDetail;
export const getTopRatedTreks = experienceService.getTopRatedTreks;
export const getNearbyTreks = experienceService.getNearbyTreks;
export const getUserExperiences = experienceService.getUserExperiences;
export const getPendingExperiences = experienceService.getPendingExperiences;
export const getCategoryActivity = experienceService.getCategoryActivity;

// CommonJS compatibility
module.exports = experienceService;
module.exports.ExperienceService = ExperienceService;
module.exports.experienceService = experienceService;
module.exports.default = ExperienceService;
module.exports.calculatePricingAndFees = calculatePricingAndFees;
module.exports.isValidS3MediaUrl = isValidS3MediaUrl;
module.exports.parseExperiencePayload = parseExperiencePayload;
module.exports.parseIfJson = parseIfJson;
module.exports.LISTING_CARD_PROJECTION = LISTING_CARD_PROJECTION;
module.exports.calculateDistance = calculateDistance;
module.exports.expandCategories = expandCategories;
module.exports.buildCategoryFilter = buildCategoryFilter;
module.exports.attachDistanceToTreks = attachDistanceToTreks;
module.exports.getPlatformFeeRate = getPlatformFeeRate;
module.exports.recordHostAuditLog = recordHostAuditLog;
module.exports.recordHostHistory = recordHostHistory;
module.exports.buildExperiencesFilter = buildExperiencesFilter;
module.exports.roundRobinMerge = roundRobinMerge;
module.exports.cleanupMediaAssets = cleanupMediaAssets;
module.exports.deleteMediaAssets = deleteMediaAssets;
module.exports.ALLOWED_EXPERIENCE_CATEGORIES = ALLOWED_EXPERIENCE_CATEGORIES;
module.exports.ExperienceActionService = ExperienceActionService;
