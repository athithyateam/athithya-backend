const { authService } = require("../services/authService");

// Helper to extract JWT token from HTTP-only cookie or Authorization header
const extractToken = (req) => {
    return req.cookies?.auth_token || req.headers?.authorization?.split(' ')[1] || null;
};

// Middleware to check if user is authenticated
const checkAuth = (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Please provide a token."
            });
        }

        const decoded = authService.verifyToken(token);
        req.user = decoded; // Store user info in request
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
};

// Middleware to check if user is admin with real-time database verification
const checkAdmin = async (req, res, next) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Please provide a valid token."
            });
        }

        const { User } = require("../db/mongoose");
        const user = await User.findById(req.user.userId).select("_id role email firstname lastname");

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User session invalid or user account no longer exists."
            });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required."
            });
        }

        // Attach verified user and synchronize role from database
        req.adminUser = user;
        req.user.role = user.role;
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error verifying admin privileges"
        });
    }
};

// Generic role-checking middleware factory
const checkRole = (allowedRoles = []) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.userId) {
                return res.status(401).json({ success: false, message: "Authentication required." });
            }
            const { User } = require("../db/mongoose");
            const user = await User.findById(req.user.userId).select("_id role");
            if (!user || !allowedRoles.includes(user.role)) {
                return res.status(403).json({ success: false, message: "Access denied. Insufficient permissions." });
            }
            req.user.role = user.role;
            next();
        } catch (error) {
            return res.status(500).json({ success: false, message: "Authorization check error" });
        }
    };
};

// Middleware to check if user is host
const checkHost = (req, res, next) => {
    if (req.user.role !== 'host' && req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: "Access denied. Host privileges required."
        });
    }
    next();
};

// Middleware to check for token but NOT reject if missing/invalid
const checkOptionalAuth = (req, res, next) => {
    try {
        const token = extractToken(req);
        if (token) {
            const decoded = authService.verifyToken(token);
            req.user = decoded;
        }
        next();
    } catch (error) {
        next();
    }
};

// Middleware to check if user is an approved host
const checkApprovedHost = async (req, res, next) => {
    try {
        const { User } = require("../db/mongoose");
        const user = await User.findById(req.user.userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (user.role === 'admin') return next();

        if (user.role !== 'host') {
            return res.status(403).json({ success: false, message: "Only hosts can perform this action" });
        }

        if (user.hostStatus !== 'approved') {
            return res.status(403).json({ 
                success: false, 
                message: "Your host account is not yet approved.",
                hostStatus: user.hostStatus
            });
        }

        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error checking host status" });
    }
};

// Middleware to check if user exists in DB as well as valid token
const checkAuthWithDBVerification = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. Please provide a token."
            });
        }

        const decoded = authService.verifyToken(token);
        const { User } = require("../db/mongoose");
        const user = await User.findById(decoded.userId).select("_id role firstname lastname email hostStatus");

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User session invalid or user account no longer exists."
            });
        }

        req.user = {
            ...decoded,
            role: user.role,
            email: user.email
        };
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
};

module.exports = { checkAuth, checkAdmin, checkHost, checkRole, checkOptionalAuth, checkApprovedHost, checkAuthWithDBVerification };
