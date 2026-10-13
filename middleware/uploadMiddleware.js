const multer = require("multer");

/**
 * Common multer storage configuration using memory storage
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
        'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg', 'application/pdf'
    ];
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
        cb(null, true);
    } else {
        cb(new Error("Invalid file type. Only standard images, videos, and PDFs are allowed."), false);
    }
};

/**
 * Generic multer instance — file size capped at 3MB
 * to stay under Vercel's 4.5MB body limit.
 */
const upload = multer({
    storage,
    limits: { fileSize: 3 * 1024 * 1024 }, // 3MB for general posts (to stay under Vercel's 4.5MB limit)
    fileFilter
});

/**
 * Handle errors specifically from Multer (e.g., file size limits)
 */
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: "File size too large. Maximum 3MB per upload.",
                error: err.message
            });
        }
        return res.status(400).json({ success: false, message: "File upload error", error: err.message });
    } else if (err && err.message && err.message.includes("Invalid file type")) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
};

module.exports = {
    upload,
    handleMulterError
};
