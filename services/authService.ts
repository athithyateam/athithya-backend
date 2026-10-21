import bcrypt from "bcryptjs";
import axios from "axios";
import { User, OTP } from "../db/mongoose";
import { jwt, jwtkey } from "../utils/jwt";
import { generateOTP, sendOTPEmail, sendTemplateEmail } from "./emailService";
import { triggerNewUserWelcome } from "../utils/onboardingHelper";

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
}

export interface AuthDependencies {
    userModel?: any;
    otpModel?: any;
    jwtSigner?: typeof jwt;
    jwtSecret?: string;
    emailNotifier?: EmailNotifier;
    welcomeNotifier?: typeof triggerNewUserWelcome;
}

export default class AuthService {
    private static instance: AuthService | null = null;
    private static instanceKey = Symbol("AuthServiceInstanceKey");

    private userModel: any;
    private otpModel: any;
    private jwtSigner: typeof jwt;
    private jwtSecret: string;
    private emailNotifier: EmailNotifier;
    private welcomeNotifier: typeof triggerNewUserWelcome;

    constructor(instanceKey: symbol, deps: AuthDependencies = {}) {
        if (instanceKey !== AuthService.instanceKey) {
            throw new Error("Please use AuthService.getInstance() to retrieve or create an instance");
        }

        this.userModel = deps.userModel || User;
        this.otpModel = deps.otpModel || OTP;
        this.jwtSigner = deps.jwtSigner || jwt;
        this.jwtSecret = deps.jwtSecret || jwtkey;
        this.emailNotifier = deps.emailNotifier || {
            generateOTP,
            sendOTPEmail,
            sendTemplateEmail
        };
        this.welcomeNotifier = deps.welcomeNotifier || triggerNewUserWelcome;
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
            this.welcomeNotifier({ io }, user).catch((err: any) =>
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
                this.welcomeNotifier({ io }, user).catch((err: any) =>
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
