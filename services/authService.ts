import bcrypt from "bcryptjs";
import axios from "axios";
import jwt from "jsonwebtoken";
import { User, Conversation, Message, HostDetails } from "../db/mongoose";
import { sendTemplateEmail, sendHtmlEmail, renderBrandedEmail } from "./emailService";
import { otpService as defaultOtpService, OtpService } from "./otpService";
import { notificationService } from "./notificationService";
import { chatService } from "./chatService";

const defaultJwtSecret = process.env.JWT_SECRET || "";
if (!defaultJwtSecret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required but not set.");
}

function httpError(statusCode: number, message: string): never {
    const error: any = new Error(message);
    error.statusCode = statusCode;
    throw error;
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
    generateOTP?: (length?: number) => string;
    sendOTPEmail?: (email: string, otp: string, subject?: string, title?: string) => Promise<any>;
    sendTemplateEmail: (options: {
        to: string;
        subject: string;
        templateName: string;
        data?: Record<string, any>;
        senderName?: string;
        senderEmail?: string;
    }) => Promise<any>;
    sendHtmlEmail?: (email: string, subject: string, htmlContent: string) => Promise<any>;
    renderBrandedEmail?: (title: string, bodyHtml: string, subtitle?: string) => string;
}

export interface AuthDependencies {
    userModel?: any;
    hostDetailsModel?: any;
    otpService?: OtpService;
    otpModel?: any;
    conversationModel?: any;
    messageModel?: any;
    jwtSigner?: typeof jwt;
    jwtSecret?: string;
    emailNotifier?: EmailNotifier;
    welcomeNotifier?: (user: any) => Promise<void>;
}

export default class AuthService {
    private static instance: AuthService | null = null;
    private static instanceKey = Symbol("AuthServiceInstanceKey");

    private userModel: any;
    private hostDetailsModel: any;
    private otpService: OtpService;
    private conversationModel: any;
    private messageModel: any;
    private jwtSigner: typeof jwt;
    private jwtSecret: string;
    private emailNotifier: EmailNotifier;
    private welcomeNotifier?: (user: any) => Promise<void>;

    constructor(instanceKey: symbol, deps: AuthDependencies = {}) {
        if (instanceKey !== AuthService.instanceKey) {
            throw new Error("Please use AuthService.getInstance() to retrieve or create an instance");
        }

        this.userModel = deps.userModel || User;
        this.hostDetailsModel = deps.hostDetailsModel || HostDetails;
        this.otpService = deps.otpService || (deps.otpModel ? OtpService.getInstance({ otpModel: deps.otpModel }) : defaultOtpService);
        this.conversationModel = deps.conversationModel || Conversation;
        this.messageModel = deps.messageModel || Message;
        this.jwtSigner = deps.jwtSigner || jwt;
        this.jwtSecret = deps.jwtSecret || defaultJwtSecret;
        this.emailNotifier = deps.emailNotifier || {
            sendTemplateEmail,
            sendHtmlEmail,
            renderBrandedEmail
        };
        this.welcomeNotifier = deps.welcomeNotifier;

        const methods = [
            "generateAuthToken", "verifyToken", "validateRole", "getOrCreateOfficialAdmin",
            "sendWelcomeChatMessage", "sendWelcomeEmail", "onboardNewUser", "triggerNewUserWelcome",
            "formatAuthUser", "notifyAdminNewUserSignup", "initiateSignup", "completeSignup",
            "signin", "googleSignin", "forgotPassword", "resetPassword", "getCurrentUser",
            "generateAndSendOTP", "verifyAndConsumeOTP", "registerAndOnboardUser"
        ];
        methods.forEach(fn => ((this as any)[fn] = (this as any)[fn].bind(this)));
    }

    public static getInstance(deps?: AuthDependencies): AuthService {
        if (!this.instance) this.instance = new AuthService(this.instanceKey, deps);
        return this.instance;
    }

    public validateRole(role?: string): string {
        const userRole = role || "guest";
        if (!["guest", "host"].includes(userRole)) {
            httpError(400, "Invalid role. Only 'guest' or 'host' accounts can be registered.");
        }
        return userRole;
    }

    public generateAuthToken(user: any): string {
        return this.jwtSigner.sign(
            { userId: user._id.toString(), role: user.role },
            this.jwtSecret,
            { expiresIn: "30d" }
        );
    }

    public verifyToken(token: string): any {
        return this.jwtSigner.verify(token, this.jwtSecret);
    }

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

    public async generateAndSendOTP(email: string, subject?: string, title?: string): Promise<string> {
        return this.otpService.sendEmailOTP(email, { subject, title });
    }

    public async verifyAndConsumeOTP(email: string, otp: string): Promise<void> {
        await this.otpService.verifyEmailOTP(email, otp);
    }

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

    public async getOrCreateOfficialAdmin(): Promise<any> {
        let adminUser = (await this.userModel.findOne({
            $or: [
                { firstname: "Athithya", lastname: "Official" },
                { role: "admin", firstname: /athithya/i }
            ]
        })) || (await this.userModel.findOne({ role: "admin" }));

        if (!adminUser) {
            const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
            return await this.userModel.create({
                firstname: "Athithya",
                lastname: "Official",
                email: "teamsathithya@gmail.com",
                password: hashedPass,
                role: "admin",
                isVerified: true,
                avatar: { url: "/athithya-logo.png" }
            });
        }

        let updated = false;
        if (adminUser.firstname === "Admin" || !adminUser.firstname) {
            adminUser.firstname = "Athithya";
            adminUser.lastname = "Official";
            updated = true;
        }
        if (!adminUser.avatar?.url) {
            adminUser.avatar = { url: "/athithya-logo.png" };
            updated = true;
        }
        if (updated) await adminUser.save();
        return adminUser;
    }

    public async sendWelcomeChatMessage(user: any, adminUser?: any): Promise<any> {
        const admin = adminUser || (await this.getOrCreateOfficialAdmin());
        return chatService.sendWelcomeChatMessage(user, admin);
    }

    public async sendWelcomeEmail(user: any): Promise<void> {
        const isHost = user.role === "host";
        const roleText = isHost ? "host" : "guest";
        const firstName = user.firstname || (isHost ? "Host" : "Guest");
        const emailBody = `
            <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                Dear ${roleText} <strong>${firstName}</strong>, Thank you for creating an account as a <strong>${roleText}</strong> in Athithya! If you have any queries, feel free to share them with us.
            </p>
        `;
        const emailRenderer = this.emailNotifier.renderBrandedEmail || renderBrandedEmail;
        const emailHtml = emailRenderer(`Welcome to Athithya, ${firstName}!`, emailBody, "Welcome");

        const emailSender = this.emailNotifier.sendHtmlEmail || sendHtmlEmail;
        emailSender(user.email, "Welcome to Athithya!", emailHtml).catch((err: any) => {
            console.error("Failed to send welcome email:", err);
        });
    }

    public async onboardNewUser(user: any): Promise<void> {
        if (this.welcomeNotifier) return this.welcomeNotifier(user);
        try {
            if (!user || !user._id) return;
            const adminUser = await this.getOrCreateOfficialAdmin();
            await this.sendWelcomeChatMessage(user, adminUser);
            await this.sendWelcomeEmail(user);
        } catch (err) {
            console.error("Error onboarding new user:", err);
        }
    }

    public async triggerNewUserWelcome(user: any): Promise<void> {
        return this.onboardNewUser(user);
    }

    public async registerAndOnboardUser(userData: any, source: string = ""): Promise<any> {
        const user = await this.userModel.create(userData);
        this.onboardNewUser(user).catch((err: any) =>
            console.error("Onboarding welcome error:", err)
        );
        this.notifyAdminNewUserSignup(user, source);
        return user;
    }

    public async initiateSignup(email: string, role?: string): Promise<{ email: string }> {
        if (!email) httpError(400, "Email is required");
        const existingUser = await this.userModel.findOne({ email });
        if (existingUser) httpError(400, "Email already registered");

        this.validateRole(role);
        await this.generateAndSendOTP(email);
        return { email };
    }

    public async completeSignup(
        firstname: string,
        lastname: string,
        email: string,
        password: string,
        role?: string,
        otp?: string
    ): Promise<AuthResponse> {
        if (!email || !password || !otp) httpError(400, "Email, password, and OTP are required");

        const existingUser = await this.userModel.findOne({ email });
        if (existingUser) httpError(400, "User already exists");

        const userRole = this.validateRole(role);
        await this.verifyAndConsumeOTP(email, otp);

        const hashedPass = await bcrypt.hash(password, 10);
        const user = await this.registerAndOnboardUser({
            firstname,
            lastname,
            email,
            password: hashedPass,
            role: userRole,
            isVerified: true
        });

        const token = this.generateAuthToken(user);
        return {
            user: this.formatAuthUser(user),
            token,
            isVerified: true
        };
    }

    public async signin(email: string, password: string): Promise<AuthResponse> {
        if (!email || !password) httpError(400, "Email and password are required");

        const user = await this.userModel.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            httpError(400, "Invalid credentials");
        }

        const token = this.generateAuthToken(user);
        return {
            user: this.formatAuthUser(user),
            token
        };
    }

    public async googleSignin(token: string, role?: string): Promise<AuthResponse> {
        if (!token) httpError(400, "Google access token is required");

        const userRole = this.validateRole(role);
        const googleRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` }
        });
        const { email, given_name, family_name, picture } = googleRes.data;

        let user = await this.userModel.findOne({ email });
        if (!user) {
            const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
            user = await this.registerAndOnboardUser({
                firstname: given_name,
                lastname: family_name || "",
                email,
                password: hashedPass,
                role: userRole,
                isVerified: true,
                avatar: picture ? { url: picture } : undefined
            }, "via Google");
        } else if (!user.isVerified) {
            user.isVerified = true;
            await user.save();
        }

        const jwtToken = this.generateAuthToken(user);
        return {
            user: this.formatAuthUser(user),
            token: jwtToken
        };
    }

    public async forgotPassword(email: string): Promise<boolean> {
        if (!email) httpError(400, "Email is required");

        const user = await this.userModel.findOne({ email });
        if (!user) httpError(404, "No account found with this email address");

        await this.generateAndSendOTP(email, "Password Reset - OTP", "Password Reset Request");
        return true;
    }

    public async resetPassword(email: string, otp: string, newPassword: string): Promise<boolean> {
        if (!email || !otp || !newPassword) httpError(400, "Email, OTP, and new password are required");

        const user = await this.userModel.findOne({ email });
        if (!user) httpError(404, "No account found with this email address");

        await this.verifyAndConsumeOTP(email, otp);

        const hashedPass = await bcrypt.hash(newPassword, 10);
        user.password = hashedPass;
        await user.save();
        return true;
    }

    public async getCurrentUser(userId: string): Promise<any> {
        if (!userId) httpError(400, "User ID is required");

        const user = await this.userModel.findById(userId).select("-password");
        if (!user) httpError(401, "User session invalid or user not found");

        let hostStatus: string | undefined = undefined;
        if (user.role === "host") {
            const hostDoc = await this.hostDetailsModel.findOne({ user: user._id });
            hostStatus = hostDoc ? hostDoc.status : "pending_verification";
        }

        return {
            ...this.formatAuthUser(user),
            hostStatus,
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
export const onboardNewUser = authService.onboardNewUser;

// CommonJS compatibility
module.exports = authService;
module.exports.default = AuthService;
module.exports.AuthService = AuthService;
module.exports.authService = authService;
module.exports.verifyToken = verifyToken;
module.exports.triggerNewUserWelcome = triggerNewUserWelcome;
module.exports.onboardNewUser = onboardNewUser;
