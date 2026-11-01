import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initiateSignupSchema, signupSchema, otpCompleteSchema } from "../middleware/validateUser";

describe("Authentication Validation Schemas", () => {
    describe("initiateSignupSchema", () => {
        it("accepts valid email and role", () => {
            const res = initiateSignupSchema.safeParse({
                email: "traveler@athithya.in",
                role: "guest"
            });
            assert.strictEqual(res.success, true);
        });

        it("accepts only email without role (defaults in service)", () => {
            const res = initiateSignupSchema.safeParse({
                email: "host@athithya.in"
            });
            assert.strictEqual(res.success, true);
        });

        it("does NOT require firstname, lastname, or password at initiation stage", () => {
            const payloadWithoutDetails = {
                email: "newuser@example.com",
                role: "host"
            };
            const res = initiateSignupSchema.safeParse(payloadWithoutDetails);
            assert.strictEqual(res.success, true);
        });

        it("rejects invalid email formats", () => {
            const res = initiateSignupSchema.safeParse({
                email: "not-an-email",
                role: "guest"
            });
            assert.strictEqual(res.success, false);
        });

        it("rejects unauthorized role escalation (e.g. admin)", () => {
            const res = initiateSignupSchema.safeParse({
                email: "hacker@example.com",
                role: "admin"
            });
            assert.strictEqual(res.success, false);
        });
    });

    describe("otpCompleteSchema", () => {
        it("requires firstname, lastname, email, password, and otp at completion stage", () => {
            const valid = otpCompleteSchema.safeParse({
                firstname: "Aarav",
                lastname: "Sharma",
                email: "aarav@example.com",
                password: "securePassword123",
                role: "guest",
                otp: "123456"
            });
            assert.strictEqual(valid.success, true);

            const missingName = otpCompleteSchema.safeParse({
                email: "aarav@example.com",
                password: "securePassword123",
                otp: "123456"
            });
            assert.strictEqual(missingName.success, false);
        });
    });
});
