import bcrypt from "bcryptjs";
import axios from "axios";
import jwt from "jsonwebtoken";
import { User, OTP, Conversation, Message } from "../db/mongoose";
import { generateOTP, sendOTPEmail, sendTemplateEmail, sendHtmlEmail } from "./emailService";

const defaultJwtSecret = process.env.JWT_SECRET || "";
if (!defaultJwtSecret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required but not set.");
}

export interface FormattedAuthUser {
    id: string;
    _id: string;
    firstname: string;
    lastname: string;
    email: string;
    role: string;
    isVerified: boolean;
    avatar: any;
}

export interface AuthResponse {
    user: FormattedAuthUser;
    token: string;
    isVerified?: boolean;
}

export interface EmailNotifier {
    generateOTP: (length?: number) => string;
    sendOTPEmail: (email: string, otp: string, subject?: string, title?: string) => Promise<any>;
    sendTemplateEmail: (options: {
        to: string;
        subject: string;
        templateName: string;
        data?: Record<string, any>;
        senderName?: string;
        senderEmail?: string;
    }) => Promise<any>;
    sendHtmlEmail?: (email: string, subject: string, htmlContent: string) => Promise<any>;
}

export interface AuthDependencies {
    userModel?: any;
    otpModel?: any;
    conversationModel?: any;
    messageModel?: any;
    jwtSigner?: typeof jwt;
    jwtSecret?: string;
    emailNotifier?: EmailNotifier;
    welcomeNotifier?: (reqOrIo: any, user: any) => Promise<void>;
}

export default class AuthService {
    private static instance: AuthService | null = null;
    private static instanceKey = Symbol("AuthServiceInstanceKey");

    private userModel: any;
    private otpModel: any;
    private conversationModel: any;
    private messageModel: any;
    private jwtSigner: typeof jwt;
    private jwtSecret: string;
    private emailNotifier: EmailNotifier;
    private welcomeNotifier?: (reqOrIo: any, user: any) => Promise<void>;

    constructor(instanceKey: symbol, deps: AuthDependencies = {}) {
        if (instanceKey !== AuthService.instanceKey) {
            throw new Error("Please use AuthService.getInstance() to retrieve or create an instance");
        }

        this.userModel = deps.userModel || User;
        this.otpModel = deps.otpModel || OTP;
        this.conversationModel = deps.conversationModel || Conversation;
        this.messageModel = deps.messageModel || Message;
        this.jwtSigner = deps.jwtSigner || jwt;
        this.jwtSecret = deps.jwtSecret || defaultJwtSecret;
        this.emailNotifier = deps.emailNotifier || {
            generateOTP,
            sendOTPEmail,
            sendTemplateEmail,
            sendHtmlEmail
        };
        this.welcomeNotifier = deps.welcomeNotifier;

        this.generateAuthToken = this.generateAuthToken.bind(this);
        this.verifyToken = this.verifyToken.bind(this);
        this.triggerNewUserWelcome = this.triggerNewUserWelcome.bind(this);
        this.formatAuthUser = this.formatAuthUser.bind(this);
        this.notifyAdminNewUserSignup = this.notifyAdminNewUserSignup.bind(this);
        this.initiateSignup = this.initiateSignup.bind(this);
        this.completeSignup = this.completeSignup.bind(this);
        this.signin = this.signin.bind(this);
        this.googleSignin = this.googleSignin.bind(this);
        this.forgotPassword = this.forgotPassword.bind(this);
        this.resetPassword = this.resetPassword.bind(this);
        this.getCurrentUser = this.getCurrentUser.bind(this);
    }

    /**
     * Singleton instance accessor with optional dependency injection
     */
    public static getInstance(deps?: AuthDependencies): AuthService {
        if (!this.instance) {
            this.instance = new AuthService(this.instanceKey, deps);
        }
        return this.instance;
    }

    /**
     * Generate 30-day JWT token for an authenticated user
     */
    public generateAuthToken(user: any): string {
        return this.jwtSigner.sign(
            { userId: user._id.toString(), role: user.role },
            this.jwtSecret,
            { expiresIn: "30d" }
        );
    }

    /**
     * Verify and decode a JWT token
     */
    public verifyToken(token: string): any {
        return this.jwtSigner.verify(token, this.jwtSecret);
    }

    /**
     * Format user payload for consistent auth responses
     */
    public formatAuthUser(user: any): FormattedAuthUser {
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
    }

    /**
     * Notify platform admin via email of a new user registration
     */
    public notifyAdminNewUserSignup(user: any, source: string = ""): void {
        const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
        const username = `${user.firstname} ${user.lastname}`;
        const sourceSuffix = source ? ` (${source})` : "";

        this.emailNotifier.sendTemplateEmail({
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
        }).catch((err: any) =>
            console.error("Failed to send admin signup notification email:", err)
        );
    }

    /**
     * Handle new user onboarding:
     * 1. Find or create the "Athithya Official" admin account in DB with profile avatar.
     * 2. Send an auto-generated welcome chat message from Athithya Official to the new user.
     * 3. Send a branded welcome email to the new user.
     */
    public async triggerNewUserWelcome(reqOrIo: any, user: any): Promise<void> {
        if (this.welcomeNotifier) {
            return this.welcomeNotifier(reqOrIo, user);
        }

        try {
            if (!user || !user._id) return;

            // 1. Locate or create "Athithya Official" admin user
            let adminUser = await this.userModel.findOne({
                $or: [
                    { firstname: "Athithya", lastname: "Official" },
                    { role: "admin", firstname: /athithya/i }
                ]
            });

            if (!adminUser) {
                adminUser = await this.userModel.findOne({ role: "admin" });
            }

            if (!adminUser) {
                const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
                adminUser = await this.userModel.create({
                    firstname: "Athithya",
                    lastname: "Official",
                    email: "teamsathithya@gmail.com",
                    password: hashedPass,
                    role: "admin",
                    isVerified: true,
                    avatar: { url: "/athithya-logo.png" }
                });
            } else {
                let updated = false;
                if (adminUser.firstname === "Admin" || !adminUser.firstname) {
                    adminUser.firstname = "Athithya";
                    adminUser.lastname = "Official";
                    updated = true;
                }
                if (!adminUser.avatar || !adminUser.avatar.url) {
                    adminUser.avatar = { url: "/athithya-logo.png" };
                    updated = true;
                }
                if (updated) {
                    await adminUser.save();
                }
            }

            // 2. Prepare welcome message text based on role
            const isHost = user.role === "host";
            const roleText = isHost ? "host" : "guest";
            const firstName = user.firstname || (isHost ? "Host" : "Guest");
            const welcomeChatText = `Dear ${roleText} ${firstName}, Welcome to Athithya! Thank you for creating an account as a ${roleText} in Athithya! If you have any queries, feel free to share them with us.`;

            // 3. Create or find 1-on-1 Conversation between Admin and New User
            let conversation = await this.conversationModel.findOne({
                participants: { $all: [adminUser._id, user._id], $size: 2 }
            });

            if (!conversation) {
                const unreadMap = new Map();
                unreadMap.set(adminUser._id.toString(), 0);
                unreadMap.set(user._id.toString(), 1);

                conversation = await this.conversationModel.create({
                    participants: [adminUser._id, user._id],
                    unreadCounts: unreadMap
                });
            }

            // 4. Create Message from Admin to User
            const message = await this.messageModel.create({
                conversationId: conversation._id,
                sender: adminUser._id,
                recipient: user._id,
                text: welcomeChatText,
                messageType: "text"
            });

            // 5. Update Conversation metadata
            const targetUserId = user._id.toString();
            await this.conversationModel.findByIdAndUpdate(conversation._id, {
                $set: {
                    lastMessage: {
                        text: welcomeChatText,
                        sender: adminUser._id,
                        createdAt: new Date()
                    },
                    [`unreadCounts.${targetUserId}`]: 1
                }
            });

            // 6. Real-time Socket.io broadcast to new user
            const io = reqOrIo?.app?.get ? reqOrIo.app.get("io") : (reqOrIo?.io || reqOrIo);
            if (io && typeof io.to === "function") {
                const populatedMsg = await this.messageModel.findById(message._id).populate("sender", "firstname lastname avatar");
                io.to(targetUserId).emit("new_message", populatedMsg);
            }

            // 7. Send Welcome Email to User
            const emailSubject = "Welcome to Athithya!";
            const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
                    <div style="background-color: #1a1a1a; padding: 25px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 3px; font-weight: 800;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 30px 25px;">
                        <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Welcome to Athithya, ${firstName}!</h2>
                        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                            Dear ${roleText} <strong>${firstName}</strong>, Thank you for creating an account as a <strong>${roleText}</strong> in Athithya! If you have any queries, feel free to share them with us.
                        </p>
                        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                            Best regards,<br>
                            <strong style="color: #111827;">The Athithya Team</strong>
                        </p>
                    </div>
                    <div style="background-color: #f9fafb; padding: 15px; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #f3f4f6;">
                        <p style="color: #9ca3af; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} Athithya. All rights reserved.</p>
                    </div>
                </div>
            `;

            const emailSender = this.emailNotifier.sendHtmlEmail || sendHtmlEmail;
            emailSender(user.email, emailSubject, emailHtml).catch((err: any) => {
                console.error("Failed to send welcome email:", err);
            });
        } catch (err) {
            console.error("Error in triggerNewUserWelcome onboarding helper:", err);
        }
    }

    /**
     * Initiate signup by validating and emailing OTP
     */
    public async initiateSignup(email: string, role?: string): Promise<{ email: string }> {
        if (!email) {
            const error: any = new Error("Email is required");
            error.statusCode = 400;
            throw error;
        }

        const existingUser = await this.userModel.findOne({ email });
        if (existingUser) {
            const error: any = new Error("Email already registered");
            error.statusCode = 400;
            throw error;
        }

        if (role && !["guest", "host"].includes(role)) {
            const error: any = new Error("Invalid role");
            error.statusCode = 400;
            throw error;
        }

        const otp = this.emailNotifier.generateOTP();
        await this.otpModel.findOneAndUpdate({ email }, { email, otp }, { upsert: true, new: true });
        const emailResult = await this.emailNotifier.sendOTPEmail(email, otp);

        if (!emailResult.success) {
            const error: any = new Error("Failed to send OTP email");
            error.statusCode = 500;
            throw error;
        }

        return { email };
    }

    /**
     * Complete signup by verifying OTP and creating user
     */
    public async completeSignup(
        firstname: string,
        lastname: string,
        email: string,
        password: string,
        role?: string,
        otp?: string,
        io?: any
    ): Promise<AuthResponse> {
        if (!email || !password || !otp) {
            const error: any = new Error("Email, password, and OTP are required");
            error.statusCode = 400;
            throw error;
        }

        const existingUser = await this.userModel.findOne({ email });
        if (existingUser) {
            const error: any = new Error("User already exists");
            error.statusCode = 400;
            throw error;
        }

        const userRole = role || "guest";
        if (!["guest", "host"].includes(userRole)) {
            const error: any = new Error("Invalid role");
            error.statusCode = 400;
            throw error;
        }

        const otpRecord = await this.otpModel.findOne({ email, otp });
        if (!otpRecord) {
            const error: any = new Error("Invalid or expired OTP");
            error.statusCode = 400;
            throw error;
        }

        await this.otpModel.deleteOne({ email, otp });
        const hashedPass = await bcrypt.hash(password, 10);
        const user = await this.userModel.create({
            firstname,
            lastname,
            email,
            password: hashedPass,
            role: userRole,
            isVerified: true
        });

        if (io) {
            this.triggerNewUserWelcome({ io }, user).catch((err: any) =>
                console.error("Onboarding welcome error:", err)
            );
        }

        this.notifyAdminNewUserSignup(user);
        const token = this.generateAuthToken(user);

        return {
            user: this.formatAuthUser(user),
            token,
            isVerified: true
        };
    }

    /**
     * Sign in with email and password
     */
    public async signin(email: string, password: string): Promise<AuthResponse> {
        if (!email || !password) {
            const error: any = new Error("Email and password are required");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            const error: any = new Error("Invalid credentials");
            error.statusCode = 400;
            throw error;
        }

        const token = this.generateAuthToken(user);

        return {
            user: this.formatAuthUser(user),
            token
        };
    }

    /**
     * Google OAuth Signin/Signup
     */
    public async googleSignin(token: string, role?: string, io?: any): Promise<AuthResponse> {
        if (!token) {
            const error: any = new Error("Google access token is required");
            error.statusCode = 400;
            throw error;
        }

        if (role && !["guest", "host"].includes(role)) {
            const error: any = new Error("Invalid role. Only 'guest' or 'host' accounts can be registered.");
            error.statusCode = 400;
            throw error;
        }

        const userRole = role === "host" ? "host" : "guest";
        const googleRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` }
        });
        const { email, given_name, family_name, picture } = googleRes.data;

        let user = await this.userModel.findOne({ email });
        let isNewUser = false;

        if (!user) {
            const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
            user = await this.userModel.create({
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
                this.triggerNewUserWelcome({ io }, user).catch((err: any) =>
                    console.error("Onboarding welcome error:", err)
                );
            }

            this.notifyAdminNewUserSignup(user, "via Google");
        }

        const jwtToken = this.generateAuthToken(user);

        return {
            user: this.formatAuthUser(user),
            token: jwtToken
        };
    }

    /**
     * Forgot password OTP request
     */
    public async forgotPassword(email: string): Promise<boolean> {
        if (!email) {
            const error: any = new Error("Email is required");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findOne({ email });
        if (!user) {
            const error: any = new Error("No account found with this email address");
            error.statusCode = 404;
            throw error;
        }

        const otp = this.emailNotifier.generateOTP();
        await this.otpModel.findOneAndUpdate({ email }, { email, otp }, { upsert: true, new: true });
        const emailResult = await this.emailNotifier.sendOTPEmail(
            email,
            otp,
            "Password Reset - OTP",
            "Password Reset Request"
        );

        if (!emailResult.success) {
            const error: any = new Error("Failed to send OTP");
            error.statusCode = 500;
            throw error;
        }

        return true;
    }

    /**
     * Reset password using verified OTP
     */
    public async resetPassword(email: string, otp: string, newPassword: string): Promise<boolean> {
        if (!email || !otp || !newPassword) {
            const error: any = new Error("Email, OTP, and new password are required");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findOne({ email });
        if (!user) {
            const error: any = new Error("No account found with this email address");
            error.statusCode = 404;
            throw error;
        }

        const otpRecord = await this.otpModel.findOne({ email, otp });
        if (!otpRecord) {
            const error: any = new Error("Invalid or expired OTP");
            error.statusCode = 400;
            throw error;
        }

        const hashedPass = await bcrypt.hash(newPassword, 10);
        user.password = hashedPass;
        await user.save();

        await this.otpModel.deleteOne({ email, otp });
        return true;
    }

    /**
     * Get current authenticated user details
     */
    public async getCurrentUser(userId: string): Promise<any> {
        if (!userId) {
            const error: any = new Error("User ID is required");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findById(userId).select("-password -otp -otpExpires");
        if (!user) {
            const error: any = new Error("User session invalid or user not found");
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
    }
}

// Default singleton export
export const authService = AuthService.getInstance();
export const verifyToken = authService.verifyToken;
export const triggerNewUserWelcome = authService.triggerNewUserWelcome;

// CommonJS compatibility
module.exports = authService;
module.exports.default = AuthService;
module.exports.AuthService = AuthService;
module.exports.authService = authService;
