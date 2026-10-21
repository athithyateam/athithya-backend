import fs from "fs";
import path from "path";
const brevo = require("@getbrevo/brevo");

// Initialize Brevo API client default
const defaultApiInstance = new brevo.TransactionalEmailsApi();
if (defaultApiInstance.authentications && defaultApiInstance.authentications['apiKey']) {
    defaultApiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
}

const defaultTemplatesDir = path.join(__dirname, "../assets/emailTemplates");

export interface SendEmailOptions {
    to: string;
    subject: string;
    htmlContent: string;
    senderName?: string;
    senderEmail?: string;
}

export interface SendTemplateEmailOptions {
    to: string;
    subject: string;
    templateName: string;
    data?: Record<string, any>;
    senderName?: string;
    senderEmail?: string;
}

export class EmailService {
    private static instance: EmailService | null = null;
    private static instanceKey = Symbol("EmailServiceInstanceKey");

    private apiInstance: any;
    private templateCache: Map<string, string>;
    private templatesDir: string;

    constructor(
        instanceKey: symbol,
        apiInstance: any = defaultApiInstance,
        templatesDir: string = defaultTemplatesDir
    ) {
        if (instanceKey !== EmailService.instanceKey) {
            throw new Error("Please use EmailService.getInstance() to retrieve or create an instance");
        }
        this.apiInstance = apiInstance;
        this.templateCache = new Map();
        this.templatesDir = templatesDir;
    }

    public static getInstance(apiInstance?: any, templatesDir?: string): EmailService {
        if (!this.instance) {
            this.instance = new EmailService(this.instanceKey, apiInstance, templatesDir);
        }
        return this.instance;
    }

    /**
     * Generate a random numeric OTP code
     */
    public generateOTP(length: number = 6): string {
        const min = Math.pow(10, length - 1);
        const max = Math.pow(10, length) - 1;
        return Math.floor(min + Math.random() * (max - min + 1)).toString();
    }

    /**
     * Render an HTML email template with dynamic variables
     */
    public renderTemplate(templateName: string, data: Record<string, any> = {}): string {
        let templateHtml = this.templateCache.get(templateName);

        if (!templateHtml) {
            const templatePath = path.join(this.templatesDir, `${templateName}.html`);
            if (!fs.existsSync(templatePath)) {
                throw new Error(`Email template not found: ${templateName}`);
            }
            templateHtml = fs.readFileSync(templatePath, "utf-8");
            this.templateCache.set(templateName, templateHtml);
        }

        return templateHtml.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
            return data[key] !== undefined && data[key] !== null ? data[key] : "";
        });
    }

    /**
     * Send an email via Brevo transactional email API
     * Supports clean positional parameters as primary signature,
     * while supporting single options object for backward compatibility.
     */
    public async sendEmail(
        toOrOptions: string | SendEmailOptions,
        subject?: string,
        htmlContent?: string,
        senderName: string = "Athithya",
        senderEmail: string = "teamsathithya@gmail.com"
    ): Promise<{ success: boolean; data?: any; error?: string }> {
        try {
            let toEmail: string;
            let finalSubject: string;
            let finalHtml: string;
            let finalSenderName: string = senderName;
            let finalSenderEmail: string = senderEmail;

            if (typeof toOrOptions === "object" && toOrOptions !== null) {
                toEmail = toOrOptions.to;
                finalSubject = toOrOptions.subject;
                finalHtml = toOrOptions.htmlContent;
                if (toOrOptions.senderName) finalSenderName = toOrOptions.senderName;
                if (toOrOptions.senderEmail) finalSenderEmail = toOrOptions.senderEmail;
            } else {
                toEmail = toOrOptions as string;
                finalSubject = subject || "";
                finalHtml = htmlContent || "";
            }

            if (!toEmail || !finalSubject || !finalHtml) {
                throw new Error("Missing required email fields (to, subject, or htmlContent)");
            }

            const sendSmtpEmail = new brevo.SendSmtpEmail();
            sendSmtpEmail.subject = finalSubject;
            sendSmtpEmail.htmlContent = finalHtml;
            sendSmtpEmail.sender = { name: finalSenderName, email: finalSenderEmail };
            sendSmtpEmail.to = [{ email: toEmail }];

            const data = await this.apiInstance.sendTransacEmail(sendSmtpEmail);
            return { success: true, data };
        } catch (error: any) {
            const errorMsg = error.response?.body?.message || error.message || "Unknown Brevo error";
            console.error("Brevo email send error:", errorMsg);
            if (error.response?.body) {
                console.error("Brevo error details:", JSON.stringify(error.response.body, null, 2));
            }
            return { success: false, error: errorMsg };
        }
    }

    /**
     * Send an email rendered from a template file
     * Supports clean positional parameters as primary signature:
     * (to, subject, templateName, data, senderName, senderEmail)
     * as well as options object for backward compatibility.
     */
    public async sendTemplateEmail(
        toOrOptions: string | SendTemplateEmailOptions,
        subject?: string,
        templateName?: string,
        data: Record<string, any> = {},
        senderName: string = "Athithya",
        senderEmail: string = "teamsathithya@gmail.com"
    ): Promise<{ success: boolean; data?: any; error?: string }> {
        let toEmail: string;
        let finalSubject: string;
        let finalTemplate: string;
        let finalData: Record<string, any> = data;
        let finalSenderName: string = senderName;
        let finalSenderEmail: string = senderEmail;

        if (typeof toOrOptions === "object" && toOrOptions !== null) {
            toEmail = toOrOptions.to;
            finalSubject = toOrOptions.subject;
            finalTemplate = toOrOptions.templateName;
            finalData = toOrOptions.data || {};
            if (toOrOptions.senderName) finalSenderName = toOrOptions.senderName;
            if (toOrOptions.senderEmail) finalSenderEmail = toOrOptions.senderEmail;
        } else {
            toEmail = toOrOptions as string;
            finalSubject = subject || "";
            finalTemplate = templateName || "";
        }

        const htmlContent = this.renderTemplate(finalTemplate, finalData);
        return await this.sendEmail(
            toEmail,
            finalSubject,
            htmlContent,
            finalSenderName,
            finalSenderEmail
        );
    }

    /**
     * Send OTP Verification Email
     */
    public async sendOTPEmail(
        email: string,
        otp: string,
        subject: string = "Email Verification - OTP",
        title: string = "Email Verification"
    ): Promise<any> {
        return await this.sendTemplateEmail(
            email,
            subject,
            "otp-verification",
            { otp, title }
        );
    }

    /**
     * Send plain/custom HTML Email
     */
    public async sendHtmlEmail(email: string, subject: string, htmlContent: string): Promise<any> {
        return await this.sendEmail(email, subject, htmlContent);
    }
}

export const emailService = EmailService.getInstance();
export default EmailService;

// Convenience function exports for backward compatibility
export const generateOTP = (length?: number) => emailService.generateOTP(length);
export const renderTemplate = (templateName: string, data?: Record<string, any>) => emailService.renderTemplate(templateName, data);
export const sendEmail = (...args: any[]) => (emailService as any).sendEmail(...args);
export const sendTemplateEmail = (...args: any[]) => (emailService as any).sendTemplateEmail(...args);
export const sendOTPEmail = (email: string, otp: string, subject?: string, title?: string) => emailService.sendOTPEmail(email, otp, subject, title);
export const sendHtmlEmail = (email: string, subject: string, htmlContent: string) => emailService.sendHtmlEmail(email, subject, htmlContent);

// CommonJS compatibility
module.exports = emailService;
module.exports.EmailService = EmailService;
module.exports.emailService = emailService;
module.exports.generateOTP = generateOTP;
module.exports.renderTemplate = renderTemplate;
module.exports.sendEmail = sendEmail;
module.exports.sendTemplateEmail = sendTemplateEmail;
module.exports.sendOTPEmail = sendOTPEmail;
module.exports.sendHtmlEmail = sendHtmlEmail;
module.exports.default = EmailService;
