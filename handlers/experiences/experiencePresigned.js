const { generatePresignedUploadUrl } = require("../../services/storageService");

/**
 * Controller: Get pre-signed S3 upload URL for experience media
 */
const getPresignedUrl = async (req, res) => {
    try {
        const rawName = req.query.fileName || req.query.filename || req.query.name;
        const rawType = req.query.fileType || req.query.filetype || req.query.mimeType || req.query.contentType;
        const rawSize = req.query.fileSize || req.query.filesize || req.query.size;
        const requestedCategory = req.query.folder || req.query.fileCategory || req.query.category || req.query.type || "experience";

        if (!rawName || !rawType) {
            return res.status(400).json({
                success: false,
                message: "fileName and fileType query parameters are required"
            });
        }

        const validCategories = ["avatar", "aadhaar", "experience", "chat", "banner", "verification", "experiences", "personal", "post", "posts"];
        const category = validCategories.includes(String(requestedCategory).toLowerCase())
            ? String(requestedCategory).toLowerCase()
            : "experience";

        const { uploadUrl, fileUrl, key } = await generatePresignedUploadUrl(rawName, rawType, rawSize, category);

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
