/**
 * User Handler - Unified Entry Point
 * Modularized façade aggregating profile, verification, social, and grid media controllers.
 */

const { 
    updateProfile, 
    updateLocation, 
    getLocation, 
    getProfile, 
    getCompleteProfile, 
    getTopRatedHosts, 
    getUserById,
    deleteMyAccount,
    getSavedExperiences
} = require("./users/profile");

const { submitHostVerification, sendPhoneOTP, verifyPhoneOTP } = require("./users/verification");

const { 
    sendFriendRequest, 
    acceptFriendRequest, 
    rejectFriendRequest, 
    unfriend, 
    getFriends,
    getGuests
} = require("./users/social");

const {
    getHostGridMedia,
    updateGridTabPreference,
    addPersonalMedia,
    deletePersonalMedia,
    togglePinPersonalMedia,
    togglePinExperienceMedia
} = require("./users/gridMedia");

module.exports = {
    // Profile & Account
    updateProfile,
    updateLocation,
    getLocation,
    getProfile,
    getCompleteProfile,
    getTopRatedHosts,
    getUserById,
    getSavedExperiences,
    deleteMyAccount,

    // Verification
    submitHostVerification,
    sendPhoneOTP,
    verifyPhoneOTP,

    // Social & Friends
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    unfriend,
    getFriends,
    getGuests,

    // Host Grid Media
    getHostGridMedia,
    updateGridTabPreference,
    addPersonalMedia,
    deletePersonalMedia,
    togglePinPersonalMedia,
    togglePinExperienceMedia
};
