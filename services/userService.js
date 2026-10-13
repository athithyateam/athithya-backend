const { User, Post } = require("../db/mongoose");

/**
 * Service: Find a user by ID
 */
const getUserById = async (userId, selectFields = "-password -otp -otpExpires") => {
    return await User.findById(userId).select(selectFields);
};

/**
 * Service: Update user's geographic/text location
 */
const updateUserLocation = async (userId, locationData) => {
    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    user.location = locationData;
    await user.save();
    return user.location;
};

/**
 * Service: Get user's saved location
 */
const getUserLocation = async (userId) => {
    const user = await User.findById(userId).select("location");
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }
    return user.location;
};

/**
 * Service: Get user's saved posts / wishlist
 */
const getSavedPosts = async (userId) => {
    const user = await User.findById(userId).populate({
        path: "savedPosts",
        populate: {
            path: "user",
            select: "firstname lastname avatar"
        }
    });

    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    return user.savedPosts || [];
};

module.exports = {
    getUserById,
    updateUserLocation,
    getUserLocation,
    getSavedPosts
};
