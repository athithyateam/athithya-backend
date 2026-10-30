const { generatePresignedUploadUrl } = require("../../services/storageService");

/**
 * Controller: Get pre-signed S3 upload URL for experience media
 */
const getPresignedUrl = async (req, res) => {
    try {
        const { fileName, fileType, fileCategory, folder, category: queryCategory } = req.query;

        if (!fileName || !fileType) {
            return res.status(400).json({
                success: false,
                message: "fileName and fileType query parameters are required"
            });
        }

        const requestedCategory = folder || fileCategory || queryCategory || "experience";
        const validCategories = ["avatar", "aadhaar", "experience", "chat", "banner", "verification", "experiences", "personal"];
        const category = validCategories.includes(requestedCategory)
            ? (requestedCategory === "experiences" ? "experience" : requestedCategory)
            : "experience";

        const { uploadUrl, fileUrl, key } = await generatePresignedUploadUrl(fileName, fileType, undefined, category);

        return res.status(200).json({
            success: true,
            uploadUrl,
            fileUrl,
            key,
            public_id: key
        });
    } catch (err) {
        console.error("Presigned URL error:", err);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to generate presigned upload URL"
        });
    }
};

module.exports = {
    getPresignedUrl
};
