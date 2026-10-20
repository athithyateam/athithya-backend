const authService = require("../services/authService");

// Helper for standard HTTP-only auth cookie configuration
const getAuthCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };
};

/**
 * Controller: Handle initial signup step by sending OTP
 */
exports.initiateSignup = async (req, res) => {
    try {
        const result = await authService.initiateSignup(req.body);
        return res.status(200).json({
            success: true,
            message: "OTP sent to your email",
            email: result.email
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error initiating signup"
        });
    }
};

/**
 * Controller: Complete signup by verifying OTP and creating user
 */
exports.completeSignup = async (req, res) => {
    try {
        const io = req.app.get("io");
        const result = await authService.completeSignup(req.body, { io });
        res.cookie("auth_token", result.token, getAuthCookieOptions());
        return res.status(201).json({
            success: true,
            message: "Account created and verified",
            token: result.token,
            isVerified: result.isVerified,
            user: result.user
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error creating user"
        });
    }
};

/**
 * Controller: Handle signin
 */
exports.signin = async (req, res) => {
    try {
        const result = await authService.signin(req.body);
        res.cookie("auth_token", result.token, getAuthCookieOptions());
        return res.status(200).json({
            success: true,
            message: "Login successful",
            token: result.token,
            user: result.user
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error logging in"
        });
    }
};

/**
 * Controller: Handle Google Signin
 */
exports.googleSignin = async (req, res) => {
    try {
        const io = req.app.get("io");
        const result = await authService.googleSignin(req.body, { io });
        res.cookie("auth_token", result.token, getAuthCookieOptions());
        return res.status(200).json({
            success: true,
            message: "Google login successful",
            token: result.token,
            user: result.user
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error with Google signin"
        });
    }
};

/**
 * Controller: Handle Forgot Password
 */
exports.forgotPassword = async (req, res) => {
    try {
        await authService.forgotPassword(req.body);
        return res.status(200).json({
            success: true,
            message: "OTP sent to your email"
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error sending OTP"
        });
    }
};

/**
 * Controller: Handle Reset Password
 */
exports.resetPassword = async (req, res) => {
    try {
        await authService.resetPassword(req.body);
        return res.status(200).json({
            success: true,
            message: "Password reset successfully"
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error resetting password"
        });
    }
};

/**
 * Controller: Handle Logout
 */
exports.logout = async (req, res) => {
    res.clearCookie("auth_token", getAuthCookieOptions());
    return res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
};

/**
 * Controller: Get current authenticated user session (/api/auth/me)
 */
exports.getMe = async (req, res) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        const user = await authService.getCurrentUser(req.user.userId);
        return res.status(200).json({
            success: true,
            data: { user }
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error retrieving current user"
        });
    }
};
