import { User, Notification, HostDetails } from "../../db/mongoose";
import { parseIfJson } from "../experiences/experiencePayloadParser";
import { sendTemplateEmail } from "../emailService";
import { notificationService } from "../notificationService";
import { otpService as defaultOtpService, OtpService, normalizePhoneNumber } from "../otpService";
import { BadRequestError, NotFoundError } from "../../errors";

export { normalizePhoneNumber };

export interface HostVerificationData {
    phone: string;
    physicalAddress: string;
    pincode: string;
    city: string;
    district: string;
    state: string;
    yearsOfExperience?: number | string;
    aadhaar?: any;
    aadhaarCardData?: any[];
}

/**
 * Reusable helper: Render document download HTML links for admin notification emails
 */
export function renderDocumentListHtml(documents: any[]): string {
    if (!documents || documents.length === 0) return "None";
    return documents.map((doc: any, idx: number) => {
        const url = doc.url || doc.fileUrl || '';
        if (!url) return '';
        return `
            <div style="margin-bottom: 10px;">
                <strong>Document ${idx + 1}:</strong> <a href="${url}" target="_blank" style="color: #C59A2F; text-decoration: none; font-weight: bold;">View / Download</a>
            </div>
        `;
    }).filter(Boolean).join("");
}

export class VerificationService {
    private static instance: VerificationService | null = null;
    private static instanceKey = Symbol("VerificationServiceInstanceKey");

    private userModel: any;
    private hostDetailsModel: any;
    private notificationModel: any;
    private emailNotifier: (options: any) => Promise<any>;
    private otpService: OtpService;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        notificationModel: any = Notification,
        emailNotifier: (options: any) => Promise<any> = sendTemplateEmail,
        otpServiceInstance: OtpService = defaultOtpService,
        hostDetailsModel: any = HostDetails
    ) {
        if (instanceKey !== VerificationService.instanceKey) {
            throw new Error("Please use VerificationService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.hostDetailsModel = hostDetailsModel;
        this.notificationModel = notificationModel;
        this.emailNotifier = emailNotifier;
        this.otpService = otpServiceInstance;
    }

    public static getInstance(
        userModel?: any,
        otpModel?: any,
        notificationModel?: any,
        smsClient?: any,
        otpGenerator?: () => string,
        emailNotifier?: (options: any) => Promise<any>,
        otpServiceInstance?: OtpService
    ): VerificationService {
        if (!this.instance) {
            const resolvedOtpService = otpServiceInstance ||
                (otpModel || smsClient ? OtpService.getInstance({ otpModel, smsClient }) : defaultOtpService);
            this.instance = new VerificationService(
                this.instanceKey,
                userModel,
                notificationModel,
                emailNotifier,
                resolvedOtpService
            );
        }
        return this.instance;
    }

    public normalizePhoneNumber(phone: string): string {
        return normalizePhoneNumber(phone);
    }

    /**
     * Check if a phone number is already verified by another host
     */
    public async checkPhoneAvailable(normalizedPhone: string, excludeUserId?: string): Promise<void> {
        const query: any = {
            phone: normalizedPhone,
            phoneVerified: true
        };
        if (excludeUserId) {
            query.user = { $ne: excludeUserId };
        }
        const existingHost = await this.hostDetailsModel.findOne(query);

        if (existingHost) {
            throw new BadRequestError("This phone number has already been used, please try another number");
        }
    }

    /**
     * Service: Request phone verification for host application
     */
    public async requestPhoneVerification(phone: string, userId?: string): Promise<{ phone: string }> {
        const normalizedPhone = this.otpService.normalizePhoneNumber(phone);
        await this.checkPhoneAvailable(normalizedPhone, userId);
        const { phone: sentPhone } = await this.otpService.sendPhoneOTP(normalizedPhone);
        return { phone: sentPhone };
    }

    /**
     * Service: Verify phone OTP and link verified phone to user's host profile
     */
    public async verifyAndLinkPhone(phone: string, otp: string, userId: string): Promise<boolean> {
        // 1. Verify and consume OTP via OtpService (handles validation, normalization, expiry, and replay prevention)
        await this.otpService.verifyPhoneOTP(phone, otp);

        const normalizedPhone = this.otpService.normalizePhoneNumber(phone);
        await this.checkPhoneAvailable(normalizedPhone, userId);

        // 2. Domain logic: Update host profile with verified phone
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        const hostDetails = await this.hostDetailsModel.findOne({ user: userId });
        const updateData: any = {};
        if (hostDetails && hostDetails.status === 'approved') {
            updateData.tempVerifiedPhone = normalizedPhone;
        } else {
            updateData.phone = normalizedPhone;
            updateData.phoneVerified = true;
        }

        await this.hostDetailsModel.findOneAndUpdate(
            { user: userId },
            { $set: updateData },
            { upsert: true, new: true }
        );
        return true;
    }

    // Convenience aliases for backward compatibility with existing callers
    public async sendPhoneOTP(phone: string, userId?: string): Promise<{ phone: string }> {
        return this.requestPhoneVerification(phone, userId);
    }

    public async verifyPhoneOTP(phone: string, otp: string, userId: string): Promise<boolean> {
        return this.verifyAndLinkPhone(phone, otp, userId);
    }

    /**
     * Service: Submit host verification application
     */
    public async submitHostVerification(
        userId: string,
        data: HostVerificationData
    ): Promise<{ hostStatus: string }> {
        const { phone, physicalAddress, pincode, city, district, state, yearsOfExperience, aadhaar, aadhaarCardData: providedAadhaar } = data;

        if (!phone || !physicalAddress || !pincode || !city || !district || !state) {
            throw new BadRequestError("Phone, current address, pincode, city, district, and state are required");
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        // Enforce phone OTP verification
        const hostDetails = await this.hostDetailsModel.findOne({ user: userId });
        if (!hostDetails || !hostDetails.phoneVerified || hostDetails.phone !== normalizedPhone) {
            throw new BadRequestError("Please verify your phone number via OTP first");
        }

        let aadhaarCardData: any[] = [];
        if (providedAadhaar && Array.isArray(providedAadhaar)) {
            aadhaarCardData = providedAadhaar;
        } else if (aadhaar) {
            if (Array.isArray(aadhaar)) {
                aadhaarCardData = aadhaar;
            } else {
                aadhaarCardData = parseIfJson(aadhaar) || [];
            }
        }

        const parsedYears = yearsOfExperience !== undefined ? Math.min(30, Math.max(0, parseInt(String(yearsOfExperience), 10) || 0)) : 0;

        await this.hostDetailsModel.findOneAndUpdate(
            { user: userId },
            {
                $set: {
                    phone: normalizedPhone,
                    phoneVerified: true,
                    physicalAddress,
                    pincode,
                    city,
                    district,
                    state,
                    yearsOfExperience: parsedYears,
                    aadhaarCard: aadhaarCardData,
                    status: 'pending_approval'
                },
                $unset: { pendingHostDetails: 1 }
            },
            { upsert: true, new: true }
        );

        if (!user.location) {
            user.location = {};
        }
        user.location.city = city;
        user.location.state = state;
        user.location.country = 'India';
        user.location.lastUpdated = new Date();
        user.role = 'host';
        await user.save();

        // Notify Admin via email
        const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
        const hostname = `${user.firstname} ${user.lastname}`;
        const adminSubject = `Host Verification Request - Athithya`;
        const docListHtml = renderDocumentListHtml(aadhaarCardData);

        this.emailNotifier({
            to: adminEmail,
            subject: adminSubject,
            templateName: "admin-host-verification",
            data: {
                hostname,
                email: user.email,
                phone: normalizedPhone,
                yearsOfExperience: `${parsedYears} ${parsedYears === 1 ? 'Year' : 'Years'}`,
                address: physicalAddress,
                city,
                district,
                state,
                pincode,
                docListHtml
            }
        }).catch((err: any) => console.error("Failed to send admin host verification email:", err));

        try {
            await notificationService.notifyAdmins({
                senderId: user._id,
                title: "New Host Verification Request",
                message: `${user.firstname} ${user.lastname} has applied to become a host.`,
                type: 'info',
                link: `/admin`,
                metadata: { userId: user._id }
            });

            notificationService.emitToAll("admin_new_verification_request", {
                userId: user._id,
                name: `${user.firstname} ${user.lastname}`
            });
        } catch (notifErr: any) {
            console.error("Failed to notify admins:", notifErr);
        }

        return { hostStatus: 'pending_approval' };
    }
}

export const verificationService = VerificationService.getInstance();
export default VerificationService;
