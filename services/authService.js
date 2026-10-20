const bcrypt = require("bcryptjs");
const axios = require("axios");
const { User, OTP } = require("../db/mongoose");
const { jwt, jwtkey } = require("../utils/jwt");
const { generateOTP, sendOTPEmail, sendTemplateEmail } = require("./emailService");
const { triggerNewUserWelcome } = require("../utils/onboardingHelper");

/**
 * Helper: Generate 30-day JWT token for authenticated user
 */
const generateAuthToken = (user) => {
    return jwt.sign(
        { userId: user._id.toString(), role: user.role },
        jwtkey,
        { expiresIn: "30d" }
    );
};

/**
 * Helper: Format user payload for consistent auth responses
 */
const formatAuthUser = (user) => {
    return {
        id: user._id.toString(),
        _id: user._id.toString(),
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified || false,
        avatar: user.avatar || null
    };
};

/**
 * Helper: Notify platform admin via email of a new user registration
 */
const notifyAdminNewUserSignup = (user, source = "") => {
    const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
    const username = `${user.firstname} ${user.lastname}`;
    const sourceSuffix = source ? ` (${source})` : "";

    sendTemplateEmail({
        to: adminEmail,
        subject: "New User Signup - Athithya",
        templateName: "admin-new-user-signup",
        data: {
            username,
            email: user.email,
            role: user.role,
            sourceSuffix,
            registeredAt: new Date().toLocaleString()
        }
    }).catch((err) =>
        console.error("Failed to send admin signup notification email:", err)
    );
};

/**
 * Service: Initiate signup by validating and emailing OTP
 */
const initiateSignup = async ({ email, role }) => {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        const error = new Error("Email already registered");
        error.statusCode = 400;
        throw error;
    }

    if (role && !["guest", "host"].includes(role)) {
        const error = new Error("Invalid role");
        error.statusCode = 400;
        throw error;
    }

    const otp = generateOTP();
    await OTP.findOneAndUpdate({ email }, { email, otp }, { upsert: true, new: true });
    const emailResult = await sendOTPEmail(email, otp);

    if (!emailResult.success) {
        const error = new Error("Failed to send OTP email");
        error.statusCode = 500;
        throw error;
    }

    return { email };
};

/**
 * Service: Complete signup by verifying OTP and creating user
 */
const completeSignup = async ({ firstname, lastname, email, password, role, otp }, { io } = {}) => {
    if (!otp) {
        const error = new Error("OTP is required");
        error.statusCode = 400;
        throw error;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        const error = new Error("User already exists");
        error.statusCode = 400;
        throw error;
    }

    const userRole = role || "guest";
    if (!["guest", "host"].includes(userRole)) {
        const error = new Error("Invalid role");
        error.statusCode = 400;
        throw error;
    }

    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
        const error = new Error("Invalid or expired OTP");
        error.statusCode = 400;
        throw error;
    }

    await OTP.deleteOne({ email, otp });
    const hashedPass = await bcrypt.hash(password, 10);
    const user = await User.create({
        firstname,
        lastname,
        email,
        password: hashedPass,
        role: userRole,
        isVerified: true
    });

    if (io) {
        triggerNewUserWelcome({ io }, user).catch((err) =>
            console.error("Onboarding welcome error:", err)
        );
    }

    notifyAdminNewUserSignup(user);

    const token = generateAuthToken(user);

    return {
        user: formatAuthUser(user),
        token,
        isVerified: true
    };
};

/**
 * Service: Sign in with email and password
 */
const signin = async ({ email, password } = {}) => {
    if (!email || !password) {
        const error = new Error("Email and password are required");
        error.statusCode = 400;
        throw error;
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        const error = new Error("Invalid credentials");
        error.statusCode = 400;
        throw error;
    }

    const token = generateAuthToken(user);

    return {
        user: formatAuthUser(user),
        token
    };
};

/**
 * Service: Google OAuth Signin/Signup
 */
const googleSignin = async ({ token, role }, { io } = {}) => {
    if (role && !["guest", "host"].includes(role)) {
        const error = new Error("Invalid role. Only 'guest' or 'host' accounts can be registered.");
        error.statusCode = 400;
        throw error;
    }

    const userRole = role === "host" ? "host" : "guest";
    const googleRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
    });
    const { email, given_name, family_name, picture } = googleRes.data;

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
        const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
        user = await User.create({
            firstname: given_name,
            lastname: family_name || "",
            email,
            password: hashedPass,
            role: userRole,
            isVerified: true,
            avatar: picture ? { url: picture } : undefined
        });
        isNewUser = true;
    } else if (!user.isVerified) {
        user.isVerified = true;
        await user.save();
    }

    if (isNewUser) {
        if (io) {
            triggerNewUserWelcome({ io }, user).catch((err) =>
                console.error("Onboarding welcome error:", err)
            );
        }

        notifyAdminNewUserSignup(user, "via Google");
    }

    const jwtToken = generateAuthToken(user);

    return {
        user: formatAuthUser(user),
        token: jwtToken
    };
};

/**
 * Service: Forgot password OTP request
 */
const forgotPassword = async ({ email }) => {
    const user = await User.findOne({ email });
    if (!user) {
        const error = new Error("No account found with this email address");
        error.statusCode = 404;
        throw error;
    }

    const otp = generateOTP();
    await OTP.findOneAndUpdate({ email }, { email, otp }, { upsert: true, new: true });
    const emailResult = await sendOTPEmail(email, otp, "Password Reset - OTP", "Password Reset Request");

    if (!emailResult.success) {
        const error = new Error("Failed to send OTP");
        error.statusCode = 500;
        throw error;
    }

    return true;
};

/**
 * Service: Reset password using verified OTP
 */
const resetPassword = async ({ email, otp, newPassword }) => {
    const user = await User.findOne({ email });
    if (!user) {
        const error = new Error("No account found with this email address");
        error.statusCode = 404;
        throw error;
    }

    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
        const error = new Error("Invalid or expired OTP");
        error.statusCode = 400;
        throw error;
    }

    const hashedPass = await bcrypt.hash(newPassword, 10);
    user.password = hashedPass;
    await user.save();

    await OTP.deleteOne({ email, otp });
    return true;
};

/**
 * Service: Get current authenticated user details
 */
const getCurrentUser = async (userId) => {
    const user = await User.findById(userId).select("-password -otp -otpExpires");
    if (!user) {
        const error = new Error("User session invalid or user not found");
        error.statusCode = 401;
        throw error;
    }

    return {
        id: user._id.toString(),
        _id: user._id.toString(),
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role,
        avatar: user.avatar || null,
        hostStatus: user.hostStatus || (user.role === "host" ? "pending_verification" : undefined),
        isVerified: user.isVerified || false,
        phone: user.phone || "",
        bio: user.bio || "",
        location: user.location || null
    };
};

module.exports = {
    initiateSignup,
    completeSignup,
    signin,
    googleSignin,
    forgotPassword,
    resetPassword,
    getCurrentUser,
    generateAuthToken,
    formatAuthUser
};
