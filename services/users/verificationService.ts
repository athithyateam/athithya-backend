const { User, OTP, Notification } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const brevo = require("@getbrevo/brevo");
const { generateOTP, sendTemplateEmail } = require("../emailService");

// Initialize Brevo transactional SMS API client
const defaultSmsApiInstance = new brevo.TransactionalSMSApi();
if (defaultSmsApiInstance.authentications && defaultSmsApiInstance.authentications['apiKey']) {
    defaultSmsApiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
}

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

export class VerificationService {
    private static instance: VerificationService | null = null;
    private static instanceKey = Symbol("VerificationServiceInstanceKey");

    private userModel: any;
    private otpModel: any;
    private notificationModel: any;
    private smsClient: any;
    private otpGenerator: () => string;
    private emailNotifier: (options: any) => Promise<any>;

    constructor(
        instanceKey: symbol,
        userModel: any = User,
        otpModel: any = OTP,
        notificationModel: any = Notification,
        smsClient: any = defaultSmsApiInstance,
        otpGenerator: () => string = generateOTP,
        emailNotifier: (options: any) => Promise<any> = sendTemplateEmail
    ) {
        if (instanceKey !== VerificationService.instanceKey) {
            throw new Error("Please use VerificationService.getInstance() to retrieve or create an instance");
        }
        this.userModel = userModel;
        this.otpModel = otpModel;
        this.notificationModel = notificationModel;
        this.smsClient = smsClient;
        this.otpGenerator = otpGenerator;
        this.emailNotifier = emailNotifier;
    }

    public static getInstance(
        userModel?: any,
        otpModel?: any,
        notificationModel?: any,
        smsClient?: any,
        otpGenerator?: () => string,
        emailNotifier?: (options: any) => Promise<any>
    ): VerificationService {
        if (!this.instance) {
            this.instance = new VerificationService(
                this.instanceKey,
                userModel,
                otpModel,
                notificationModel,
                smsClient,
                otpGenerator,
                emailNotifier
            );
        }
        return this.instance;
    }

    /**
     * Helper: Normalize phone number with country code (+91 default for India)
     */
    public normalizePhoneNumber(phone: string): string {
        if (!phone) return "";
        let normalized = phone.trim().replace(/\s+/g, '');
        if (!normalized.startsWith('+')) {
            if (normalized.length === 10) {
                normalized = '+91' + normalized;
            }
        }
        return normalized;
    }

    /**
     * Service: Send phone verification OTP via Brevo SMS
     */
    public async sendPhoneOTP(phone: string, userId?: string): Promise<{ phone: string }> {
        if (!phone) {
            const error: any = new Error("Phone number is required");
            error.statusCode = 400;
            throw error;
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);
        if (!normalizedPhone.startsWith('+')) {
            const error: any = new Error("Please include your country code (e.g. +91)");
            error.statusCode = 400;
            throw error;
        }

        // Check if phone number is already registered and verified by another user
        const existingHostWithPhone = await this.userModel.findOne({
            "hostDetails.phone": normalizedPhone,
            "hostDetails.phoneVerified": true,
            _id: { $ne: userId }
        });

        if (existingHostWithPhone) {
            const error: any = new Error("This phone number has already been used, please try another number");
            error.statusCode = 400;
            throw error;
        }

        // Generate OTP
        const otp = this.otpGenerator();

        // Store OTP in database
        await this.otpModel.findOneAndUpdate(
            { phone: normalizedPhone },
            { phone: normalizedPhone, otp },
            { upsert: true, new: true }
        );

        // Send OTP via Brevo Transactional SMS
        const sendTransacSms = new brevo.SendTransacSms();
        sendTransacSms.sender = "Athithya";
        sendTransacSms.recipient = normalizedPhone;
        sendTransacSms.content = `Your Athithya verification code is ${otp}. It will expire in 5 minutes.`;

        console.log(`\n========================================`);
        console.log(`[SMS OTP] Phone: ${normalizedPhone}, OTP: ${otp}`);
        console.log(`========================================\n`);

        try {
            await this.smsClient.sendTransacSms(sendTransacSms);
        } catch (smsError: any) {
            const errorMsg = smsError.response?.body?.message || smsError.message || 'Unknown Brevo SMS error';
            console.error('Brevo SMS sending error:', errorMsg);
            const error: any = new Error(`Failed to send OTP SMS. Details: ${errorMsg}`);
            error.statusCode = 500;
            throw error;
        }

        return { phone: normalizedPhone };
    }

    /**
     * Service: Verify phone OTP code
     */
    public async verifyPhoneOTP(phone: string, otp: string, userId: string): Promise<boolean> {
        if (!phone || !otp) {
            const error: any = new Error("Phone number and OTP code are required");
            error.statusCode = 400;
            throw error;
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);
        if (!normalizedPhone.startsWith('+')) {
            const error: any = new Error("Invalid phone number format");
            error.statusCode = 400;
            throw error;
        }

        // Find OTP record
        const otpRecord = await this.otpModel.findOne({ phone: normalizedPhone, otp });
        if (!otpRecord) {
            const error: any = new Error("Invalid or expired OTP");
            error.statusCode = 400;
            throw error;
        }

        // Check if phone number is already registered and verified by another user
        const existingHostWithPhone = await this.userModel.findOne({
            "hostDetails.phone": normalizedPhone,
            "hostDetails.phoneVerified": true,
            _id: { $ne: userId }
        });

        if (existingHostWithPhone) {
            const error: any = new Error("This phone number has already been used, please try another number");
            error.statusCode = 400;
            throw error;
        }

        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        if (!user.hostDetails) {
            user.hostDetails = {};
        }

        if (user.hostStatus === 'approved') {
            user.hostDetails.tempVerifiedPhone = normalizedPhone;
        } else {
            user.hostDetails.phone = normalizedPhone;
            user.hostDetails.phoneVerified = true;
        }
        await user.save();

        await this.otpModel.deleteOne({ _id: otpRecord._id });
        return true;
    }

    /**
     * Service: Submit host verification application
     */
    public async submitHostVerification(
        userId: string,
        data: HostVerificationData,
        io: any = null
    ): Promise<{ hostStatus: string }> {
        const { phone, physicalAddress, pincode, city, district, state, yearsOfExperience, aadhaar, aadhaarCardData: providedAadhaar } = data;

        if (!phone || !physicalAddress || !pincode || !city || !district || !state) {
            const error: any = new Error("Phone, current address, pincode, city, district, and state are required");
            error.statusCode = 400;
            throw error;
        }

        const normalizedPhone = this.normalizePhoneNumber(phone);

        const user = await this.userModel.findById(userId);
        if (!user) {
            const error: any = new Error("User not found");
            error.statusCode = 404;
            throw error;
        }

        // Enforce phone OTP verification
        if (!user.hostDetails || !user.hostDetails.phoneVerified || user.hostDetails.phone !== normalizedPhone) {
            const error: any = new Error("Please verify your phone number via OTP first");
            error.statusCode = 400;
            throw error;
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

        user.hostDetails = {
            phone: normalizedPhone,
            phoneVerified: true,
            physicalAddress,
            pincode,
            city,
            district,
            state,
            yearsOfExperience: parsedYears,
            aadhaarCard: aadhaarCardData
        };

        if (!user.location) {
            user.location = {};
        }
        user.location.city = city;
        user.location.state = state;
        user.location.country = 'India';
        user.location.lastUpdated = new Date();

        user.role = 'host';
        user.hostStatus = 'pending_approval';
        user.pendingHostDetails = undefined;
        await user.save();
        await this.userModel.updateOne({ _id: userId }, { $unset: { pendingHostDetails: 1 } });

        // Notify Admin via email
        const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
        const hostname = `${user.firstname} ${user.lastname}`;
        const adminSubject = `Host Verification Request - Athithya`;

        let docListHtml = "None";
        if (aadhaarCardData && aadhaarCardData.length > 0) {
            docListHtml = aadhaarCardData.map((doc: any, idx: number) => `
                <div style="margin-bottom: 10px;">
                    <strong>Document ${idx + 1}:</strong> <a href="${doc.url}" target="_blank" style="color: #C59A2F; text-decoration: none; font-weight: bold;">View / Download</a>
                </div>
            `).join("");
        }

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
            const admins = await this.userModel.find({ role: 'admin' });
            const notifications = admins.map((admin: any) => ({
                recipient: admin._id,
                sender: user._id,
                title: "New Host Verification Request",
                message: `${user.firstname} ${user.lastname} has applied to become a host.`,
                type: 'info',
                link: `/admin`,
                metadata: { userId: user._id }
            }));
            const savedNotifications = await this.notificationModel.insertMany(notifications);

            if (io) {
                savedNotifications.forEach((notif: any) => {
                    io.to(notif.recipient.toString()).emit("new_notification", notif);
                });
                io.emit("admin_new_verification_request", {
                    userId: user._id,
                    name: `${user.firstname} ${user.lastname}`
                });
            }
        } catch (notifErr: any) {
            console.error("Failed to notify admins via DB notification:", notifErr);
        }

        return { hostStatus: user.hostStatus };
    }
}

export const verificationService = VerificationService.getInstance();
export default VerificationService;
