const { profileService } = require("../../services/users/profileService");

/**
 * Update user profile (guest or host)
 */
exports.updateProfile = async (req, res) => {
    try {
        const result = await profileService.updateProfile(
            req.user.userId,
            req.body
        );

        return res.status(200).json({
            success: true,
            isPendingReview: result.isPendingReview,
            message: result.message,
            user: result.user
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            isUnverifiedHost: error.isUnverifiedHost || undefined,
            message: error.message || "Error updating profile"
        });
    }
};

/**
 * Update user geographic location
 */
exports.updateLocation = async (req, res) => {
    try {
        const { latitude, longitude, address, city, state, country } = req.body;
        const result = await profileService.updateUserLocation(req.user.userId, {
            latitude,
            longitude,
            address,
            city,
            state,
            country
        });

        return res.status(200).json({
            success: true,
            message: "Location updated",
            data: result
        });
    } catch (error) {
        console.error("Error updating location:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to update location"
        });
    }
};

/**
 * Get current user location
 */
exports.getLocation = async (req, res) => {
    try {
        const result = await profileService.getUserLocation(req.user.userId);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Error fetching location:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch location"
        });
    }
};

/**
 * Get user profile with posts and reviews
 */
exports.getProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = req.query.page;
        const limit = req.query.limit;

        const result = await profileService.getProfile(
            userId,
            page,
            limit,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Profile fetch error (getProfile):", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get complete user profile with categorized items
 */
exports.getCompleteProfile = async (req, res) => {
    try {
        const userId = req.params.userId || req.user?.userId;
        const result = await profileService.getCompleteProfile(
            userId,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Profile fetch error (getCompleteProfile):", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch complete profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get top rated hosts
 */
exports.getTopRatedHosts = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const { limit = 100, page = 1, minRating = 0, location } = req.query;

        const result = await profileService.getTopRatedHosts(
            limit,
            page,
            minRating,
            location
        );

        return res.status(200).json({
            success: true,
            count: result.count,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            hosts: result.hosts
        });
    } catch (error) {
        console.error("Error fetching top-rated hosts:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching top-rated hosts"
        });
    }
};

/**
 * Fetch a specific user by ID
 */
exports.getUserById = async (req, res) => {
    try {
        const result = await profileService.getUserById(
            req.params.id,
            req.user?.userId,
            req.user?.role
        );

        return res.status(200).json({
            success: true,
            user: result
        });
    } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching user"
        });
    }
};

/**
 * Delete account and all associated data
 */
exports.deleteMyAccount = async (req, res) => {
    try {
        await profileService.deleteAccount(req.user.userId);
        return res.status(200).json({
            success: true,
            message: "Account and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Account deletion error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to delete account"
        });
    }
};

/**
 * Get saved experiences for user
 */
exports.getSavedExperiences = async (req, res) => {
    try {
        const savedExperiences = await profileService.getSavedExperiences(req.user.userId);
        const validSavedExperiences = (savedExperiences || []).filter((exp) => exp !== null);
        return res.status(200).json({
            success: true,
            experiences: validSavedExperiences
        });
    } catch (error) {
        console.error("Error fetching saved experiences:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching saved experiences"
        });
    }
};
