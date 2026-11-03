import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
const { getTrafficAnalytics, getAnalyticsClient } = require("../handlers/analyticsHandler");

describe("Analytics Handler & Google Analytics Safety Suite", () => {
    const originalEnv = { ...process.env };
    const tempKeyPath = path.resolve(__dirname, "test-google-key.json");

    beforeEach(() => {
        delete process.env.GOOGLE_CREDENTIALS_JSON;
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        if (fs.existsSync(tempKeyPath)) {
            fs.unlinkSync(tempKeyPath);
        }
    });

    describe("getAnalyticsClient Credential Resolution", () => {
        it("returns null when neither GOOGLE_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS is set", () => {
            const client = getAnalyticsClient();
            assert.strictEqual(client, null);
        });

        it("returns null safely when GOOGLE_APPLICATION_CREDENTIALS points to a non-existent file", () => {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = "./non-existent-fake-key.json";
            const client = getAnalyticsClient();
            assert.strictEqual(client, null);
        });

        it("initializes client with keyFilename when GOOGLE_APPLICATION_CREDENTIALS points to an existing file", () => {
            fs.writeFileSync(tempKeyPath, JSON.stringify({ type: "service_account", project_id: "test" }));
            process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;
            const client = getAnalyticsClient();
            assert.ok(client, "Expected BetaAnalyticsDataClient instance to be created");
        });

        it("initializes client with credentials when GOOGLE_CREDENTIALS_JSON contains valid JSON", () => {
            process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ client_email: "test@example.com", private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7..." });
            const client = getAnalyticsClient();
            assert.ok(client, "Expected BetaAnalyticsDataClient instance to be created");
        });

        it("returns null and logs warning if GOOGLE_CREDENTIALS_JSON contains invalid JSON", () => {
            process.env.GOOGLE_CREDENTIALS_JSON = "INVALID_NOT_JSON";
            const client = getAnalyticsClient();
            assert.strictEqual(client, null);
        });
    });

    describe("getTrafficAnalytics Controller Behavior", () => {
        it("returns 500 when GOOGLE_ANALYTICS_PROPERTY_ID is not configured", async () => {
            let statusCode = 0;
            let responseBody: any = null;

            const res = {
                status: (code: number) => {
                    statusCode = code;
                    return {
                        json: (data: any) => { responseBody = data; return data; }
                    };
                }
            };

            await getTrafficAnalytics({}, res);
            assert.strictEqual(statusCode, 500);
            assert.strictEqual(responseBody.success, false);
            assert.match(responseBody.message, /Property ID not configured/);
        });

        it("returns 500 with safe empty data structure when credentials file does not exist, without crashing", async () => {
            process.env.GOOGLE_ANALYTICS_PROPERTY_ID = "123456789";
            process.env.GOOGLE_APPLICATION_CREDENTIALS = "./missing-key.json";

            let statusCode = 0;
            let responseBody: any = null;

            const res = {
                status: (code: number) => {
                    statusCode = code;
                    return {
                        json: (data: any) => { responseBody = data; return data; }
                    };
                }
            };

            await getTrafficAnalytics({}, res);
            assert.strictEqual(statusCode, 500);
            assert.strictEqual(responseBody.success, false);
            assert.match(responseBody.message, /credentials are not configured or credentials file was not found/);
            assert.deepStrictEqual(responseBody.data.timeline, []);
            assert.strictEqual(responseBody.data.totals.activeUsers, 0);
            assert.deepStrictEqual(responseBody.data.cities, []);
        });
    });
});

