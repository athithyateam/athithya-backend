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
    recordHostHistory
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

    public async updateExperienceStatus(experienceId: string, status: string, remarks?: string): Promise<any> {
        return this.actionService.updateExperienceStatus(experienceId, status, remarks);
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

    public async getUserExperiences(userId: string): Promise<any[]> {
        return this.actionService.getUserExperiences(userId);
    }

    public async getPendingExperiences(options?: GetPendingExperiencesOptions): Promise<PaginatedExperiencesResult> {
        return this.actionService.getPendingExperiences(options);
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        return this.actionService.getCategoryActivity();
    }

    public async getExperienceReviews(experienceId: string): Promise<any[]> {
        return this.actionService.getExperienceReviews(experienceId);
    }
}

export const experienceService = ExperienceService.getInstance();
export default ExperienceService;

// Convenience bound exports
export const createExperience = (userId: string, userRole: string, experiencePayload: any, files?: any, reqOrApp?: any) => experienceService.createExperience(userId, userRole, experiencePayload, files, reqOrApp);
export const updateExperience = (experienceId: string, userId: string, userRole: string, updatePayload: any, files?: any, reqOrApp?: any) => experienceService.updateExperience(experienceId, userId, userRole, updatePayload, files, reqOrApp);
export const updateExperienceStatus = (experienceId: string, status: string, remarks?: string) => experienceService.updateExperienceStatus(experienceId, status, remarks);
export const toggleHideExperience = (experienceId: string, userId: string, userRole: string, action: string, reason?: string, reqOrApp?: any) => experienceService.toggleHideExperience(experienceId, userId, userRole, action, reason, reqOrApp);
export const deleteExperience = (experienceId: string, userId: string, userRole: string, reqOrApp?: any) => experienceService.deleteExperience(experienceId, userId, userRole, reqOrApp);
export const saveExperience = (experienceId: string, userId: string, userRole: string) => experienceService.saveExperience(experienceId, userId, userRole);
export const unsaveExperience = (experienceId: string, userId: string) => experienceService.unsaveExperience(experienceId, userId);
export const getExperiences = (options?: GetExperiencesOptions) => experienceService.getExperiences(options);
export const getExperienceDetail = (experienceId: string) => experienceService.getExperienceDetail(experienceId);
export const getTopRatedTreks = (options?: GetTopRatedTreksOptions) => experienceService.getTopRatedTreks(options);
export const getNearbyTreks = (options?: GetNearbyTreksOptions) => experienceService.getNearbyTreks(options);
export const getUserExperiences = (userId: string) => experienceService.getUserExperiences(userId);
export const getPendingExperiences = (options?: GetPendingExperiencesOptions) => experienceService.getPendingExperiences(options);
export const getCategoryActivity = () => experienceService.getCategoryActivity();
export const getExperienceReviews = (experienceId: string) => experienceService.getExperienceReviews(experienceId);

// CommonJS compatibility
module.exports = experienceService;
module.exports.ExperienceService = ExperienceService;
module.exports.experienceService = experienceService;
module.exports.default = ExperienceService;
module.exports.createExperience = createExperience;
module.exports.updateExperience = updateExperience;
module.exports.updateExperienceStatus = updateExperienceStatus;
module.exports.toggleHideExperience = toggleHideExperience;
module.exports.deleteExperience = deleteExperience;
module.exports.saveExperience = saveExperience;
module.exports.unsaveExperience = unsaveExperience;
module.exports.getExperiences = getExperiences;
module.exports.getExperienceDetail = getExperienceDetail;
module.exports.getTopRatedTreks = getTopRatedTreks;
module.exports.getNearbyTreks = getNearbyTreks;
module.exports.getUserExperiences = getUserExperiences;
module.exports.getPendingExperiences = getPendingExperiences;
module.exports.getCategoryActivity = getCategoryActivity;
module.exports.getExperienceReviews = getExperienceReviews;
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
module.exports.ExperienceActionService = ExperienceActionService;
