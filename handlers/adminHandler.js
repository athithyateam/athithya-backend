/**
 * Admin Handler - Main Entry Point
 * This file is now modularized into smaller units in the ./admin directory.
 */

const { getAdminStats } = require("./admin/stats");
const { 
    getAllUsers, 
    getUserById, 
    updateUser, 
    updateUserRole, 
    deleteUser 
} = require("./admin/users");
const { 
    getAllExperiences, 
    getPendingExperiences, 
    updateExperience, 
    updateExperienceStatus, 
    deleteExperience 
} = require("./admin/experiences");
const { 
    getAllBookings, 
    updateBooking, 
    deleteBooking 
} = require("./admin/bookings");
const {
    getPendingHostVerifications,
    updateHostVerificationStatus
} = require("./admin/hosts");
const { getHostHistory } = require("./admin/history");
const { getChatActivity } = require("./admin/chatActivity");

module.exports = {
    getAdminStats,
    getAllUsers,
    getUserById,
    updateUser,
    updateUserRole,
    deleteUser,
    getAllExperiences,
    getPendingExperiences,
    updateExperience,
    updateExperienceStatus,
    deleteExperience,
    getAllBookings,
    updateBooking,
    deleteBooking,
    getPendingHostVerifications,
    updateHostVerificationStatus,
    getHostHistory,
    getChatActivity
};

