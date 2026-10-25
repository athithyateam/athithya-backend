import { OTP } from "../db/mongoose";
import { emailService as defaultEmailService, EmailService } from "./emailService";
const brevo = require("@getbrevo/brevo");

function httpError(statusCode: number, message: string): never {
    const error: any = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

export interface TimedOtpResult {
    otp: string;
    expiresAt: Date;
}

export interface SendEmailOtpOptions {
    subject?: string;
    title?: string;
    length?: number;
}

export interface SendSmsOtpOptions {
    sender?: string;
    content?: string;
    expiresInMinutes?: number;
    length?: number;
}

export interface SendBookingJourneyOtpOptions {
    email: string;
    postTitle: string;
    type: "check-in" | "checkout";
    expiresInMinutes?: number;
    length?: number;
}

export interface OtpServiceDependencies {
    otpModel?: any;
    emailService?: EmailService | any;
    smsClient?: any;
}

/**
 * Reusable helper: Normalize phone number with country code (+91 default for India)
 */
export function normalizePhoneNumber(phone: string): string {
    if (!phone) return "";
    let normalized = phone.trim().replace(/\s+/g, "");
    if (!normalized.startsWith("+")) {
        if (normalized.length === 10) {
            normalized = "+91" + normalized;
        }
    }
    return normalized;
}

function createDefaultSmsClient(): any {
    const defaultSmsApiInstance = new brevo.TransactionalSMSApi();
    if (defaultSmsApiInstance.authentications && defaultSmsApiInstance.authentications["apiKey"]) {
        defaultSmsApiInstance.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;
    }
    return defaultSmsApiInstance;
}

/**
 * Centralized OtpService
 * Handles OTP generation, persistence, expiration, and multi-channel verification (Email, SMS, Timed Journey)
 */
export class OtpService {
    private static instance: OtpService | null = null;
    private static instanceKey = Symbol("OtpServiceInstanceKey");

    private otpModel: any;
    private emailNotifier: any;
    private smsClient: any;

    constructor(instanceKey: symbol, deps: OtpServiceDependencies = {}) {
        if (instanceKey !== OtpService.instanceKey) {
            throw new Error("Please use OtpService.getInstance() to retrieve or create an instance");
        }

        this.otpModel = deps.otpModel || OTP;
        this.emailNotifier = deps.emailService || defaultEmailService;
        this.smsClient = deps.smsClient || createDefaultSmsClient();

        // Bind all methods for safe destructuring
        this.generateOTP = this.generateOTP.bind(this);
        this.generateTimedOTP = this.generateTimedOTP.bind(this);
        this.verifyTimedOTP = this.verifyTimedOTP.bind(this);
        this.sendEmailOTP = this.sendEmailOTP.bind(this);
        this.verifyEmailOTP = this.verifyEmailOTP.bind(this);
        this.sendPhoneOTP = this.sendPhoneOTP.bind(this);
        this.verifyPhoneOTP = this.verifyPhoneOTP.bind(this);
        this.sendBookingJourneyOTP = this.sendBookingJourneyOTP.bind(this);
        this.normalizePhoneNumber = this.normalizePhoneNumber.bind(this);
    }

    public static getInstance(deps?: OtpServiceDependencies): OtpService {
        if (!this.instance) {
            this.instance = new OtpService(this.instanceKey, deps);
        }
        return this.instance;
    }

    /**
     * Generate a numeric OTP string of given length
     */
    public generateOTP(length: number = 6): string {
        const min = Math.pow(10, length - 1);
        const max = Math.pow(10, length) - 1;
        return Math.floor(min + Math.random() * (max - min + 1)).toString();
    }

    /**
     * Generate a timed OTP pair with expiration date
     */
    public generateTimedOTP(expiresInMinutes: number = 15, length: number = 6): TimedOtpResult {
        const otp = this.generateOTP(length);
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
        return { otp, expiresAt };
    }

    /**
     * Verify a timed OTP against stored values and check expiration
     */
    public verifyTimedOTP(
        storedOtp: string | undefined | null,
        expiresAt: Date | string | undefined | null,
        submittedOtp: string
    ): boolean {
        if (!submittedOtp || !submittedOtp.trim()) {
            httpError(400, "OTP code is required");
        }

        if (!storedOtp || storedOtp.trim() !== submittedOtp.trim()) {
            httpError(400, "Invalid OTP code");
        }

        if (expiresAt && new Date() > new Date(expiresAt)) {
            httpError(400, "OTP has expired. Please request a new one.");
        }

        return true;
    }

    /**
     * Normalize a phone number
     */
    public normalizePhoneNumber(phone: string): string {
        return normalizePhoneNumber(phone);
    }

    /**
     * Generate, store, and send an email OTP
     */
    public async sendEmailOTP(email: string, options: SendEmailOtpOptions = {}): Promise<string> {
        if (!email || !email.trim()) {
            httpError(400, "Email is required to send OTP");
        }

        const cleanEmail = email.trim().toLowerCase();
        const length = options.length || 6;
        const otp = this.generateOTP(length);

        await this.otpModel.findOneAndUpdate(
            { email: cleanEmail },
            { email: cleanEmail, otp },
            { upsert: true, new: true }
        );

        const subject = options.subject || "Email Verification - OTP";
        const title = options.title || "Email Verification";
        const emailResult = await this.emailNotifier.sendOTPEmail(cleanEmail, otp, subject, title);
        if (!emailResult?.success) {
            httpError(500, "Failed to send OTP email");
        }

        return otp;
    }

    /**
     * Verify and consume an email OTP (prevents replay attacks)
     */
    public async verifyEmailOTP(email: string, otp: string): Promise<boolean> {
        if (!email || !otp) {
            httpError(400, "Email and OTP code are required");
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp.trim();

        const otpRecord = await this.otpModel.findOne({ email: cleanEmail, otp: cleanOtp });
        if (!otpRecord) {
            httpError(400, "Invalid or expired OTP");
        }

        await this.otpModel.deleteOne({ email: cleanEmail, otp: cleanOtp });
        return true;
    }

    /**
     * Generate, store, and send an SMS OTP via Brevo SMS API
     */
    public async sendPhoneOTP(phone: string, options: SendSmsOtpOptions = {}): Promise<{ phone: string; otp: string }> {
        if (!phone) {
            httpError(400, "Phone number is required");
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);
        if (!normalizedPhone.startsWith("+")) {
            httpError(400, "Please include your country code (e.g. +91)");
        }

        const length = options.length || 6;
        const expiresInMinutes = options.expiresInMinutes || 5;
        const otp = this.generateOTP(length);

        await this.otpModel.findOneAndUpdate(
            { phone: normalizedPhone },
            { phone: normalizedPhone, otp },
            { upsert: true, new: true }
        );

        const sendTransacSms = new brevo.SendTransacSms();
        sendTransacSms.sender = options.sender || "Athithya";
        sendTransacSms.recipient = normalizedPhone;
        sendTransacSms.content = options.content || `Your Athithya verification code is ${otp}. It will expire in ${expiresInMinutes} minutes.`;

        try {
            await this.smsClient.sendTransacSms(sendTransacSms);
        } catch (smsError: any) {
            const errorMsg = smsError.response?.body?.message || smsError.message || "Unknown Brevo SMS error";
            console.error("Brevo SMS sending error:", errorMsg);
            httpError(500, `Failed to send OTP SMS. Details: ${errorMsg}`);
        }

        return { phone: normalizedPhone, otp };
    }

    /**
     * Verify and consume a phone OTP
     */
    public async verifyPhoneOTP(phone: string, otp: string): Promise<boolean> {
        if (!phone || !otp) {
            httpError(400, "Phone number and OTP code are required");
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);
        if (!normalizedPhone.startsWith("+")) {
            httpError(400, "Invalid phone number format");
        }

        const cleanOtp = otp.trim();
        const otpRecord = await this.otpModel.findOne({ phone: normalizedPhone, otp: cleanOtp });
        if (!otpRecord) {
            httpError(400, "Invalid or expired OTP");
        }

        await this.otpModel.deleteOne({ _id: otpRecord._id });
        return true;
    }

    /**
     * Send booking journey check-in or checkout OTP email
     */
    public async sendBookingJourneyOTP(options: SendBookingJourneyOtpOptions): Promise<TimedOtpResult> {
        const { email, postTitle, type, expiresInMinutes = 15, length = 6 } = options;
        if (!email || !email.trim()) {
            httpError(400, "Guest email is required to send journey OTP");
        }

        const { otp, expiresAt } = this.generateTimedOTP(expiresInMinutes, length);

        const isCheckIn = type === "check-in";
        const subject = isCheckIn ? "Athithya - Your Check-in OTP" : "Athithya - Your Checkout OTP";
        const title = isCheckIn
            ? `Check-in OTP for "${postTitle}"`
            : `Journey Completion OTP for "${postTitle}"`;

        await this.emailNotifier.sendOTPEmail(email.trim(), otp, subject, title);
        return { otp, expiresAt };
    }
}

export const otpService = OtpService.getInstance();
export default OtpService;

// Convenience bound exports for functional usage
export const generateOTP = otpService.generateOTP.bind(otpService);
export const generateTimedOTP = otpService.generateTimedOTP.bind(otpService);
export const verifyTimedOTP = otpService.verifyTimedOTP.bind(otpService);
export const sendEmailOTP = otpService.sendEmailOTP.bind(otpService);
export const verifyEmailOTP = otpService.verifyEmailOTP.bind(otpService);
export const sendPhoneOTP = otpService.sendPhoneOTP.bind(otpService);
export const verifyPhoneOTP = otpService.verifyPhoneOTP.bind(otpService);
export const sendBookingJourneyOTP = otpService.sendBookingJourneyOTP.bind(otpService);

// CommonJS compatibility
module.exports = otpService;
module.exports.OtpService = OtpService;
module.exports.otpService = otpService;
module.exports.default = OtpService;
module.exports.generateOTP = generateOTP;
module.exports.generateTimedOTP = generateTimedOTP;
module.exports.verifyTimedOTP = verifyTimedOTP;
module.exports.sendEmailOTP = sendEmailOTP;
module.exports.verifyEmailOTP = verifyEmailOTP;
module.exports.sendPhoneOTP = sendPhoneOTP;
module.exports.verifyPhoneOTP = verifyPhoneOTP;
module.exports.sendBookingJourneyOTP = sendBookingJourneyOTP;
module.exports.normalizePhoneNumber = normalizePhoneNumber;
