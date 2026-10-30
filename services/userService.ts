/**
 * User Service - Unified Façade
 * Aggregates and re-exports profile, verification, and social sub-services
 * using the Singleton pattern with Dependency Injection.
 */

import { ProfileService, profileService as defaultProfileService, LocationData } from "./users/profileService";
import { VerificationService, verificationService as defaultVerificationService, HostVerificationData } from "./users/verificationService";
import { SocialService, socialService as defaultSocialService } from "./users/socialService";

export class UserService {
    private static instance: UserService | null = null;
    private static instanceKey = Symbol("UserServiceInstanceKey");

    public profileService: ProfileService;
    public verificationService: VerificationService;
    public socialService: SocialService;

    constructor(
        instanceKey: symbol,
        profileService: ProfileService = defaultProfileService,
        verificationService: VerificationService = defaultVerificationService,
        socialService: SocialService = defaultSocialService
    ) {
        if (instanceKey !== UserService.instanceKey) {
            throw new Error("Please use UserService.getInstance() to retrieve or create an instance");
        }
        this.profileService = profileService;
        this.verificationService = verificationService;
        this.socialService = socialService;
    }

    public static getInstance(
        profileService?: ProfileService,
        verificationService?: VerificationService,
        socialService?: SocialService
    ): UserService {
        if (!this.instance) {
            this.instance = new UserService(
                this.instanceKey,
                profileService,
                verificationService,
                socialService
            );
        }
        return this.instance;
    }

    // Profile Sub-Service Delegations
    public getUserFields(user: any, isOwnProfileOrAdmin?: boolean): any {
        return this.profileService.getUserFields(user, isOwnProfileOrAdmin);
    }

    public async saveHostOldDetails(user: any, changedFields?: string[]): Promise<void> {
        return this.profileService.saveHostOldDetails(user, changedFields);
    }

    public async getUserById(targetUserId: string, currentUserId?: string, currentUserRole?: string): Promise<any> {
        return this.profileService.getUserById(targetUserId, currentUserId, currentUserRole);
    }

    public async updateUserLocation(userId: string, locationData: LocationData): Promise<any> {
        return this.profileService.updateUserLocation(userId, locationData);
    }

    public async getUserLocation(userId: string): Promise<any> {
        return this.profileService.getUserLocation(userId);
    }

    public async getSavedExperiences(userId: string): Promise<any[]> {
        return this.profileService.getSavedExperiences(userId);
    }

    public async addSavedExperience(userId: string, experienceId: string): Promise<boolean> {
        return this.profileService.addSavedExperience(userId, experienceId);
    }

    public async removeSavedExperience(userId: string, experienceId: string): Promise<boolean> {
        return this.profileService.removeSavedExperience(userId, experienceId);
    }

    public async getHostRating(hostId: string): Promise<{ average: number; count: number }> {
        return this.profileService.getHostRating(hostId);
    }

    public async getProfile(
        userId: string,
        page?: number | string,
        limit?: number | string,
        currentUserId?: string,
        currentUserRole?: string
    ): Promise<any> {
        return this.profileService.getProfile(userId, page, limit, currentUserId, currentUserRole);
    }

    public async getCompleteProfile(
        userId: string,
        currentUserId?: string,
        currentUserRole?: string
    ): Promise<any> {
        return this.profileService.getCompleteProfile(userId, currentUserId, currentUserRole);
    }

    public async getTopRatedHosts(
        limit?: number | string,
        page?: number | string,
        minRating?: number | string,
        location?: string
    ): Promise<any> {
        return this.profileService.getTopRatedHosts(limit, page, minRating, location);
    }

    public async updateProfile(userId: string, profileData: any): Promise<any> {
        return this.profileService.updateProfile(userId, profileData);
    }

    // Verification Sub-Service Delegations
    public normalizePhoneNumber(phone: string): string {
        return this.verificationService.normalizePhoneNumber(phone);
    }

    public async requestPhoneVerification(phone: string, userId?: string): Promise<{ phone: string }> {
        return this.verificationService.requestPhoneVerification(phone, userId);
    }

    public async sendPhoneOTP(phone: string, userId?: string): Promise<{ phone: string }> {
        return this.verificationService.sendPhoneOTP(phone, userId);
    }

    public async verifyAndLinkPhone(phone: string, otp: string, userId: string): Promise<boolean> {
        return this.verificationService.verifyAndLinkPhone(phone, otp, userId);
    }

    public async verifyPhoneOTP(phone: string, otp: string, userId: string): Promise<boolean> {
        return this.verificationService.verifyPhoneOTP(phone, otp, userId);
    }

    public async submitHostVerification(
        userId: string,
        data: HostVerificationData
    ): Promise<{ hostStatus: string }> {
        return this.verificationService.submitHostVerification(userId, data);
    }

    // Social Sub-Service Delegations
    public async sendFriendRequest(targetUserId: string, currentUserId: string): Promise<boolean> {
        return this.socialService.sendFriendRequest(targetUserId, currentUserId);
    }

    public async acceptFriendRequest(requesterId: string, currentUserId: string): Promise<boolean> {
        return this.socialService.acceptFriendRequest(requesterId, currentUserId);
    }

    public async rejectFriendRequest(requesterId: string, currentUserId: string): Promise<boolean> {
        return this.socialService.rejectFriendRequest(requesterId, currentUserId);
    }

    public async unfriend(targetUserId: string, currentUserId: string): Promise<boolean> {
        return this.socialService.unfriend(targetUserId, currentUserId);
    }

    public async getFriends(userId: string, page?: number | string, limit?: number | string): Promise<{ count: number; data: any[] }> {
        return this.socialService.getFriends(userId, page, limit);
    }

    public async getGuests(
        currentUserId?: string,
        search?: string,
        page?: number | string,
        limit?: number | string,
        role?: string
    ): Promise<any> {
        return this.socialService.getGuests(currentUserId, search, page, limit, role);
    }
}

export const userService = UserService.getInstance();
export default UserService;

// Convenience function exports
export const addSavedExperience = (userId: string, experienceId: string) => userService.addSavedExperience(userId, experienceId);
export const removeSavedExperience = (userId: string, experienceId: string) => userService.removeSavedExperience(userId, experienceId);
export const getSavedExperiences = (userId: string) => userService.getSavedExperiences(userId);
export const getHostRating = (hostId: string) => userService.getHostRating(hostId);

// CommonJS compatibility
module.exports = userService;
module.exports.UserService = UserService;
module.exports.userService = userService;
module.exports.addSavedExperience = addSavedExperience;
module.exports.removeSavedExperience = removeSavedExperience;
module.exports.getSavedExperiences = getSavedExperiences;
module.exports.getHostRating = getHostRating;
module.exports.default = UserService;
