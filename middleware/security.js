/**
 * Security Middleware
 * Provides HTTP security headers and NoSQL injection protection.
 */

// Set standard HTTP security headers
const setSecurityHeaders = (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    if (process.env.NODE_ENV === "production") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
};

// Clean object helper to strip MongoDB operator injection keys (keys starting with '$' or containing '.')
const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
    }

    const sanitized = {};
    for (const key of Object.keys(obj)) {
        // Prevent NoSQL injection by dropping keys starting with '$' or containing '.'
        if (key.startsWith("$") || key.includes(".")) {
            continue;
        }
        sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
};

// NoSQL Injection protection middleware
const sanitizeNoSQL = (req, res, next) => {
    try {
        if (req.body && typeof req.body === "object") {
            req.body = sanitizeObject(req.body);
        }
        if (req.query && typeof req.query === "object") {
            req.query = sanitizeObject(req.query);
        }
        if (req.params && typeof req.params === "object") {
            req.params = sanitizeObject(req.params);
        }
    } catch (err) {
        console.error("Sanitization error:", err);
    }
    next();
};

module.exports = {
    setSecurityHeaders,
    sanitizeNoSQL
};
