/**
 * User Handler - Main Entry Point
 * This file is now modularized into smaller units in the ./users directory.
 */

const { 
    updateProfile, 
    updateLocation, 
    getLocation, 
    getProfile, 
    getCompleteProfile, 
    getTopRatedHosts, 
    getUserById,
    deleteMyAccount
} = require("./users/profile");

const { submitHostVerification, sendPhoneOTP, verifyPhoneOTP } = require("./users/verification");


const { getSavedPosts } = require("./users/saved");
const { 
    sendFriendRequest, 
    acceptFriendRequest, 
    rejectFriendRequest, 
    unfriend, 
    getFriends,
    getGuests
} = require("./users/social");

module.exports = {
    submitHostVerification,
    sendPhoneOTP,
    verifyPhoneOTP,
    updateProfile,

    updateLocation,
    getLocation,
    getProfile,
    getCompleteProfile,
    getTopRatedHosts,
    getUserById,
    getSavedPosts,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    unfriend,
    getFriends,
    getGuests,
    deleteMyAccount
};
