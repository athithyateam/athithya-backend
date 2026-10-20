/**
 * User Service - Unified Façade
 * Aggregates and re-exports profile, verification, and social sub-services.
 */

const profileService = require("./users/profileService");
const verificationService = require("./users/verificationService");
const socialService = require("./users/socialService");

module.exports = {
    // Profile Sub-Service
    getUserFields: profileService.getUserFields,
    saveHostOldDetails: profileService.saveHostOldDetails,
    getUserById: profileService.getUserById,
    updateUserLocation: profileService.updateUserLocation,
    getUserLocation: profileService.getUserLocation,
    getSavedPosts: profileService.getSavedPosts,
    getProfile: profileService.getProfile,
    getCompleteProfile: profileService.getCompleteProfile,
    getTopRatedHosts: profileService.getTopRatedHosts,
    updateProfile: profileService.updateProfile,

    // Verification Sub-Service
    normalizePhoneNumber: verificationService.normalizePhoneNumber,
    sendPhoneOTP: verificationService.sendPhoneOTP,
    verifyPhoneOTP: verificationService.verifyPhoneOTP,
    submitHostVerification: verificationService.submitHostVerification,

    // Social Sub-Service
    sendFriendRequest: socialService.sendFriendRequest,
    acceptFriendRequest: socialService.acceptFriendRequest,
    rejectFriendRequest: socialService.rejectFriendRequest,
    unfriend: socialService.unfriend,
    getFriends: socialService.getFriends,
    getGuests: socialService.getGuests,

    // Expose sub-services directly for modular access
    profileService,
    verificationService,
    socialService
};
