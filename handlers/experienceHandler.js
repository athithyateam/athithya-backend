/**
 * Experience Handler - Main Entry Point
 */

const { createExperience } = require("./experiences/experienceCreate");
const { updateExperience, updateExperienceStatus, requestHideExperience } = require("./experiences/experienceUpdate");
const { deleteExperience } = require("./experiences/experienceDelete");
const { 
    getExperiences, 
    getExperienceDetail, 
    getTopRatedTreks, 
    getNearbyTreks, 
    getUserExperiences, 
    getPendingExperiences,
    getCategoryActivity
} = require("./experiences/experienceQuery");
const { getPresignedUrl } = require("./experiences/experiencePresigned");
const { saveExperience, unsaveExperience } = require("./experiences/experienceSave");
const { experienceService } = require("../services/experienceService");

const getExperienceReviews = async (req, res) => {
    try {
        const reviews = await experienceService.getExperienceReviews(req.params.experienceId || req.params.id);
        return res.status(200).json({ success: true, count: reviews.length, data: reviews });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error fetching reviews" });
    }
};

module.exports = {
    createExperience,
    updateExperience,
    updateExperienceStatus,
    requestHideExperience,
    deleteExperience,
    getExperiences,
    getExperienceDetail,
    getTopRatedTreks,
    getNearbyTreks,
    getUserExperiences,
    getPendingExperiences,
    getCategoryActivity,
    getExperienceReviews,
    getPresignedUrl,
    saveExperience,
    unsaveExperience
};
