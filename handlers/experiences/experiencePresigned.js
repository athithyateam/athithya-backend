const { getPresignedUploadUrl } = require("../../services/storageService");

/**
 * Controller: Get pre-signed S3 upload URL for experience media
 */
const getPresignedUrl = async (req, res) => {
    try {
        const { fileName, fileType, fileCategory } = req.query;

        if (!fileName || !fileType) {
            return res.status(400).json({
                success: false,
                message: "fileName and fileType query parameters are required"
            });
        }

        const validCategories = ["avatar", "aadhaar", "experience", "chat", "banner", "verification"];
        const category = validCategories.includes(fileCategory) ? fileCategory : "experience";

        const { uploadUrl, fileUrl, key } = await getPresignedUploadUrl(fileName, fileType, category);

        return res.status(200).json({
            success: true,
            uploadUrl,
            fileUrl,
            key
        });
    } catch (err) {
        console.error("Presigned URL error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Failed to generate presigned upload URL"
        });
    }
};

module.exports = {
    getPresignedUrl
};
