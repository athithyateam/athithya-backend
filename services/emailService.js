const fs = require("fs");
const path = require("path");
const brevo = require("@getbrevo/brevo");

// Initialize Brevo API client
const apiInstance = new brevo.TransactionalEmailsApi();
if (apiInstance.authentications['apiKey']) {
    apiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
}

// In-memory template cache
const templateCache = new Map();
const TEMPLATES_DIR = path.join(__dirname, "../assets/emailTemplates");

/**
 * Generate a random 6-digit numeric OTP code
 */
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Render an HTML email template with dynamic variables
 * @param {string} templateName - Name of the template file (without .html)
 * @param {Object} data - Key-value map for replacing {{key}}
 * @returns {string} Compiled HTML string
 */
const renderTemplate = (templateName, data = {}) => {
    let templateHtml = templateCache.get(templateName);

    if (!templateHtml) {
        const templatePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Email template not found: ${templateName}`);
        }
        templateHtml = fs.readFileSync(templatePath, "utf-8");
        templateCache.set(templateName, templateHtml);
    }

    // Replace all {{key}} occurrences
    return templateHtml.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        return data[key] !== undefined && data[key] !== null ? data[key] : "";
    });
};

/**
 * Send an email via Brevo transactional email API
 * Supports both options object: { to, subject, htmlContent, senderName, senderEmail }
 * and legacy positional args: (to, subject, htmlContent)
 */
const sendEmail = async (optionsOrTo, maybeSubject, maybeHtmlContent) => {
    try {
        let toEmail, subject, htmlContent, senderName, senderEmail;

        if (typeof optionsOrTo === "object" && optionsOrTo !== null) {
            toEmail = optionsOrTo.to || optionsOrTo.email;
            subject = optionsOrTo.subject;
            htmlContent = optionsOrTo.htmlContent || optionsOrTo.html;
            senderName = optionsOrTo.senderName || "Athithya";
            senderEmail = optionsOrTo.senderEmail || "teamsathithya@gmail.com";
        } else {
            toEmail = optionsOrTo;
            subject = maybeSubject;
            htmlContent = maybeHtmlContent;
            senderName = "Athithya";
            senderEmail = "teamsathithya@gmail.com";
        }

        if (!toEmail || !subject || !htmlContent) {
            throw new Error("Missing required email fields (to, subject, or htmlContent)");
        }

        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = htmlContent;
        sendSmtpEmail.sender = { name: senderName, email: senderEmail };
        sendSmtpEmail.to = [{ email: toEmail }];

        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        return { success: true, data };
    } catch (error) {
        const errorMsg = error.response?.body?.message || error.message || "Unknown Brevo error";
        console.error("Brevo email send error:", errorMsg);
        if (error.response?.body) {
            console.error("Brevo error details:", JSON.stringify(error.response.body, null, 2));
        }
        return { success: false, error: errorMsg };
    }
};

/**
 * Send an email rendered from a template file
 */
const sendTemplateEmail = async ({ to, subject, templateName, data = {}, senderName, senderEmail }) => {
    const htmlContent = renderTemplate(templateName, data);
    return await sendEmail({
        to,
        subject,
        htmlContent,
        senderName,
        senderEmail
    });
};

/**
 * Send OTP Verification Email
 */
const sendOTPEmail = async (email, otp, subject = "Email Verification - OTP", title = "Email Verification") => {
    return await sendTemplateEmail({
        to: email,
        subject,
        templateName: "otp-verification",
        data: {
            otp,
            title
        }
    });
};

/**
 * Backward compatibility alias for sendEmail
 */
const sendHtmlEmail = async (email, subject, htmlContent) => {
    return await sendEmail(email, subject, htmlContent);
};

module.exports = {
    generateOTP,
    renderTemplate,
    sendEmail,
    sendTemplateEmail,
    sendOTPEmail,
    sendHtmlEmail
};
