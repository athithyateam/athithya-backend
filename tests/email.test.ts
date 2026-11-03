import { describe, it } from "node:test";
import assert from "node:assert/strict";
const emailServiceModule = require("../services/emailService");
const {
    EmailService,
    emailService,
    sendHtmlEmail,
    sendEmail,
    sendTemplateEmail,
    sendOTPEmail,
    renderTemplate,
    renderBrandedEmail,
    generateOTP
} = require("../services/emailService");

describe("EmailService & Destructured Function Scope Safety Suite", () => {
    it("destructured sendHtmlEmail does NOT throw TypeError: Cannot read properties of undefined (reading 'sendEmail')", async () => {
        // Calling destructured function without object receiver
        const result = await sendHtmlEmail("test@example.com", "Test Subject", "<p>Hello</p>");
        assert.ok(result);
        assert.strictEqual(typeof result.success, "boolean");
    });

    it("destructured sendEmail does NOT throw TypeError: Cannot read properties of undefined", async () => {
        const result = await sendEmail("test@example.com", "Test Subject", "<p>Hello</p>");
        assert.ok(result);
        assert.strictEqual(typeof result.success, "boolean");
    });

    it("destructured generateOTP produces valid numeric OTP string", () => {
        const otp6 = generateOTP(6);
        assert.strictEqual(typeof otp6, "string");
        assert.strictEqual(otp6.length, 6);
        assert.match(otp6, /^\d{6}$/);

        const otp4 = generateOTP(4);
        assert.strictEqual(otp4.length, 4);
        assert.match(otp4, /^\d{4}$/);
    });

    it("destructured renderBrandedEmail formats HTML correctly", () => {
        const html = renderBrandedEmail("Test Title", "<p>Body text</p>", "Subtitle");
        assert.ok(html.includes("ATHITHYA"));
        assert.ok(html.includes("Test Title"));
        assert.ok(html.includes("Body text"));
        assert.ok(html.includes("Subtitle"));
    });

    it("handles mock apiInstance successfully when sending emails", async () => {
        let sentPayload: any = null;
        const mockApiInstance = {
            sendTransacEmail: async (payload: any) => {
                sentPayload = payload;
                return { messageId: "mock-msg-123" };
            }
        };

        const originalApi = (emailService as any).apiInstance;
        try {
            (emailService as any).apiInstance = mockApiInstance;

            const res = await sendHtmlEmail("guest@example.com", "Welcome", "<p>Welcome to Athithya</p>");
            assert.strictEqual(res.success, true);
            assert.ok(sentPayload);
            assert.strictEqual(sentPayload.to[0].email, "guest@example.com");
            assert.strictEqual(sentPayload.subject, "Welcome");
            assert.strictEqual(sentPayload.htmlContent, "<p>Welcome to Athithya</p>");
        } finally {
            (emailService as any).apiInstance = originalApi;
        }
    });

    it("safely handles unconfigured or unavailable apiInstance without throwing", async () => {
        const originalApi = (emailService as any).apiInstance;
        try {
            (emailService as any).apiInstance = null;

            const res = await sendHtmlEmail("test@example.com", "Subject", "<p>Test</p>");
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.error, "Brevo apiInstance unavailable");
        } finally {
            (emailService as any).apiInstance = originalApi;
        }
    });

    it("handles sendEmail errors gracefully returning success: false", async () => {
        const mockFailingApi = {
            sendTransacEmail: async () => {
                const err: any = new Error("Quota exceeded");
                err.response = { body: { message: "Monthly email limit reached" } };
                throw err;
            }
        };

        const originalApi = (emailService as any).apiInstance;
        try {
            (emailService as any).apiInstance = mockFailingApi;

            const res = await sendEmail("test@example.com", "Subject", "<p>Test</p>");
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.error, "Monthly email limit reached");
        } finally {
            (emailService as any).apiInstance = originalApi;
        }
    });
});
