const bcrypt = require("bcryptjs");
const axios = require("axios");
const { User, OTP } = require("../db/mongoose");
const { jwt, jwtkey } = require("../utils/jwt");
const { generateOTP, sendOTPEmail, sendHtmlEmail } = require("../utils/emailService");
const { triggerNewUserWelcome } = require("../utils/onboardingHelper");

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
const completeSignup = async ({ firstname, lastname, email, password, role, otp }, req = null) => {
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

    if (req) {
        triggerNewUserWelcome(req, user).catch((err) =>
            console.error("Onboarding welcome error:", err)
        );
    }

    // Notify Admin via email
    const adminEmail = "teamsathithya@gmail.com";
    const username = `${user.firstname} ${user.lastname}`;
    const adminSubject = "New User Signup - Athithya";
    const adminHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
            </div>
            <div style="padding: 20px;">
                <h2 style="color: #333; margin-top: 0;">New User Signup</h2>
                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                    <strong>${username}</strong> has signed up or created a new account as a <strong>${user.role}</strong> in Athithya.
                </p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <tr style="background-color: #f9f9f9;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${username}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${user.email}</td>
                    </tr>
                    <tr style="background-color: #f9f9f9;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Role:</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-transform: uppercase;">${user.role}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Registered At:</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString()}</td>
                    </tr>
                </table>
            </div>
        </div>
    `;
    sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch((err) =>
        console.error("Failed to send admin signup notification email:", err)
    );

    const token = jwt.sign({ userId: user._id.toString(), role: user.role }, jwtkey, { expiresIn: "30d" });

    return {
        user: {
            id: user._id.toString(),
            _id: user._id.toString(),
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email,
            role: user.role,
            avatar: user.avatar || null
        },
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

    const token = jwt.sign({ userId: user._id.toString(), role: user.role }, jwtkey, { expiresIn: "30d" });

    return {
        user: {
            id: user._id.toString(),
            _id: user._id.toString(),
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email,
            role: user.role,
            isVerified: user.isVerified || false,
            avatar: user.avatar || null
        },
        token
    };
};

/**
 * Service: Google OAuth Signin/Signup
 */
const googleSignin = async ({ token, role }, req = null) => {
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
        if (req) {
            triggerNewUserWelcome(req, user).catch((err) =>
                console.error("Onboarding welcome error:", err)
            );
        }

        const adminEmail = "teamsathithya@gmail.com";
        const username = `${user.firstname} ${user.lastname}`;
        const adminSubject = "New User Signup - Athithya";
        const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">New User Signup (via Google)</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        <strong>${username}</strong> has signed up or created a new account as a <strong>${user.role}</strong> in Athithya.
                    </p>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${username}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${user.email}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Role:</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-transform: uppercase;">${user.role}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Registered At:</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${new Date().toLocaleString()}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
        sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch((err) =>
            console.error("Failed to send admin signup notification email:", err)
        );
    }

    const jwtToken = jwt.sign({ userId: user._id.toString(), role: user.role }, jwtkey, { expiresIn: "30d" });

    return {
        user: {
            id: user._id.toString(),
            _id: user._id.toString(),
            firstname: user.firstname,
            lastname: user.lastname,
            email: user.email,
            role: user.role,
            avatar: user.avatar || null
        },
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
    getCurrentUser
};
