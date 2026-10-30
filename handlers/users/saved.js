const userService = require("../../services/userService");

exports.getSavedExperiences = async (req, res) => {
    try {
        const savedExperiences = await userService.getSavedExperiences(req.user.userId);
        const validSavedExperiences = (savedExperiences || []).filter((exp) => exp !== null);
        return res.status(200).json({
            success: true,
            experiences: validSavedExperiences
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error fetching saved experiences"
        });
    }
};
