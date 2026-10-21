const { storageService } = require('../../services/storageService');

exports.getPresignedUrl = async (req, res) => {
    try {
        const { filename, fileType, fileSize, type } = req.query;

        const result = await storageService.generatePresignedUploadUrl(
            filename,
            fileType,
            fileSize,
            type
        );

        return res.status(200).json({
            success: true,
            uploadUrl: result.uploadUrl,
            fileUrl: result.fileUrl,
            key: result.key,
            resource_type: result.resource_type
        });
    } catch (error) {
        console.error("Presigned URL generation error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error generating presigned URL",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
