import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    calculatePricingAndFees,
    getPlatformFeeRate,
    parseExperiencePayload,
    expandCategories,
    buildCategoryFilter,
    attachDistanceToTreks,
    calculateDistance,
    isValidS3MediaUrl,
    buildExperiencesFilter,
    roundRobinMerge,
    parseIfJson
} from "../services/experienceService";

describe("Experience Pure Helper & Parsing Functions", () => {
    describe("getPlatformFeeRate & calculatePricingAndFees", () => {
        it("computes tiered platform fees correctly across all brackets", () => {
            // Under 2000 => 5%
            assert.strictEqual(getPlatformFeeRate(1000), 0.05);
            const lowTier = calculatePricingAndFees({ perPerson: 1000 });
            assert.strictEqual(lowTier.basePrice, 1000);
            assert.strictEqual(lowTier.feeRate, 0.05);
            assert.strictEqual(lowTier.platformFee, 50);
            assert.strictEqual(lowTier.guestPrice, 1050);

            // 2000 to 5000 => 3.5%
            assert.strictEqual(getPlatformFeeRate(3000), 0.035);
            const midTier = calculatePricingAndFees({ perPerson: 3000 });
            assert.strictEqual(midTier.basePrice, 3000);
            assert.strictEqual(midTier.feeRate, 0.035);
            assert.strictEqual(midTier.platformFee, 105);
            assert.strictEqual(midTier.guestPrice, 3105);

            // Over 5000 => 2%
            assert.strictEqual(getPlatformFeeRate(10000), 0.02);
            const highTier = calculatePricingAndFees({ perPerson: 10000 });
            assert.strictEqual(highTier.basePrice, 10000);
            assert.strictEqual(highTier.feeRate, 0.02);
            assert.strictEqual(highTier.platformFee, 200);
            assert.strictEqual(highTier.guestPrice, 10200);
        });

        it("safely handles null, undefined, strings, and zero pricing", () => {
            const nullRes = calculatePricingAndFees(null);
            assert.strictEqual(nullRes.basePrice, 0);
            assert.strictEqual(nullRes.platformFee, 0);

            const strRes = calculatePricingAndFees({ perPerson: "2500" });
            assert.strictEqual(strRes.basePrice, 2500);
            assert.strictEqual(strRes.feeRate, 0.035);

            const invalidRes = calculatePricingAndFees({ perPerson: "invalid_num" });
            assert.strictEqual(invalidRes.basePrice, 0);
        });
    });

    describe("parseIfJson", () => {
        it("parses valid JSON strings and returns original value for objects/primitives", () => {
            assert.deepStrictEqual(parseIfJson('{"city":"Goa"}'), { city: "Goa" });
            assert.deepStrictEqual(parseIfJson('["Trek","Camping"]'), ["Trek", "Camping"]);
            assert.deepStrictEqual(parseIfJson({ city: "Goa" }), { city: "Goa" });
            assert.strictEqual(parseIfJson("plain text"), "plain text");
            assert.strictEqual(parseIfJson(null), undefined);
            assert.strictEqual(parseIfJson(undefined), undefined);
        });
    });

    describe("parseExperiencePayload", () => {
        it("normalizes location, price, capacity, duration, tags, and amenities", () => {
            const rawPayload = {
                title: "River Rafting & Riverside Camping",
                subtitle: "Feel alive on the rapids",
                description: "Experience white water rafting and camping under the stars",
                location: JSON.stringify({
                    city: "Rishikesh",
                    state: "Uttarakhand",
                    coordinates: { type: "Point", coordinates: [78.2676, 30.0869] }
                }),
                pricePerPerson: "1500",
                maxPeople: "8",
                hours: "2",
                minutes: "30",
                tags: JSON.stringify(["rafting", "river", "nature"]),
                categories: JSON.stringify(["rafting", "camping"]),
                amenities: JSON.stringify(["Life jacket", "Guide"])
            };

            const parsed = parseExperiencePayload(rawPayload);
            assert.strictEqual(parsed.title, "River Rafting & Riverside Camping");
            assert.strictEqual(parsed.subtitle, "Feel alive on the rapids");
            assert.strictEqual(parsed.location?.city, "Rishikesh");
            assert.deepStrictEqual(parsed.location?.coordinates, {
                type: "Point",
                coordinates: [78.2676, 30.0869]
            });
            assert.strictEqual(parsed.price?.perPerson, 1500);
            assert.strictEqual(parsed.capacity?.maxPeople, 8);
            assert.strictEqual(parsed.duration?.hours, 2);
            assert.strictEqual(parsed.duration?.minutes, 30);
            assert.deepStrictEqual(parsed.tags, ["rafting", "river", "nature"]);
            assert.deepStrictEqual(parsed.categories, ["Rafting", "Camping"]);
            assert.deepStrictEqual(parsed.amenities, ["Life jacket", "Guide"]);
        });

        it("discards invalid coordinates in location", () => {
            const parsed = parseExperiencePayload({
                location: {
                    city: "Mumbai",
                    coordinates: { type: "Invalid", coordinates: ["abc", "def"] }
                }
            });
            assert.strictEqual(parsed.location?.city, "Mumbai");
            assert.strictEqual(parsed.location?.coordinates, undefined);
        });
    });

    describe("expandCategories & buildCategoryFilter", () => {
        it("expands casing/synonyms for supported categories and preserves uniqueness", () => {
            const trekExpanded = expandCategories("Trek");
            assert.ok(trekExpanded.includes("Trek"));

            const bungeeExpanded = expandCategories("bungee jumping");
            assert.ok(bungeeExpanded.includes("Bungee Jumping"));

            const safariExpanded = expandCategories("Safari");
            assert.ok(safariExpanded.includes("Safari"));

            const othersExpanded = expandCategories("others");
            assert.ok(othersExpanded.includes("Others"));
            assert.ok(othersExpanded.includes("Other"));
        });

        it("buildCategoryFilter constructs mongo query with clean $in clause", () => {
            const filter = buildCategoryFilter("other");
            assert.ok(filter.$in.includes("Others"));
            assert.ok(filter.$in.includes("Other"));
            assert.strictEqual(filter.$nin, undefined);

            const trekFilter = buildCategoryFilter(["Trek"]);
            assert.ok(trekFilter.$in.includes("Trek"));
        });
    });

    describe("attachDistanceToTreks & calculateDistance", () => {
        it("computes Haversine distance accurately", () => {
            // Bangalore (12.9716, 77.5946) to Mumbai (19.0760, 72.8777) ~ 840 km
            const dist = calculateDistance(12.9716, 77.5946, 19.0760, 72.8777);
            assert.ok(dist > 830 && dist < 850, `Expected ~840km, got ${dist}`);
        });

        it("attaches distance for GeoJSON object, flat array, and flat lat/lng", () => {
            const items = [
                { id: 1, location: { coordinates: { type: "Point", coordinates: [77.5946, 12.9716] } } },
                { id: 2, location: { coordinates: [77.6000, 12.9800] } },
                { id: 3, location: { latitude: 12.9716, longitude: 77.5946 } },
                { id: 4, location: {} }
            ];

            const withDist = attachDistanceToTreks(items, 12.9716, 77.5946);
            assert.strictEqual(withDist[0].distance, 0);
            assert.ok(withDist[1].distance! > 0 && withDist[1].distance! < 5);
            assert.strictEqual(withDist[2].distance, 0);
            assert.strictEqual(withDist[3].distance, undefined);
        });
    });

    describe("isValidS3MediaUrl", () => {
        it("validates legitimate S3 bucket URLs and relative URLs, rejects external domains", () => {
            assert.strictEqual(isValidS3MediaUrl("/uploads/experience/photo.jpg"), true);
            assert.strictEqual(isValidS3MediaUrl({ url: "https://athithya-bucket.s3.ap-south-1.amazonaws.com/uploads/photo.jpg" }), true);
            assert.strictEqual(isValidS3MediaUrl("https://evil-phishing-site.com/malicious.jpg"), false);
            assert.strictEqual(isValidS3MediaUrl(null), false);
            assert.strictEqual(isValidS3MediaUrl(""), false);
        });
    });

    describe("buildExperiencesFilter", () => {
        it("builds multi-field filter including text search regex and price bounds", () => {
            const filter = buildExperiencesFilter({
                city: "Manali",
                minPrice: 500,
                maxPrice: 3000,
                search: "waterfall",
                status: "active"
            });

            assert.strictEqual(filter.status, "active");
            assert.deepStrictEqual(filter.isHidden, { $ne: true });
            assert.ok(filter["location.city"] instanceof RegExp);
            assert.strictEqual(filter["price.perPerson"].$gte, 500);
            assert.strictEqual(filter["price.perPerson"].$lte, 3000);
            assert.ok(Array.isArray(filter.$or));
            assert.strictEqual(filter.$or.length, 5); // title, subtitle, city, address, tags
        });
    });

    describe("roundRobinMerge", () => {
        it("merges lists in round-robin sequence and deduplicates by ID", () => {
            const list1 = [{ _id: "1", name: "A" }, { _id: "2", name: "B" }];
            const list2 = [{ _id: "2", name: "B (dup)" }, { _id: "3", name: "C" }, { _id: "4", name: "D" }];

            const merged = roundRobinMerge([list1, list2], 0, 10);
            assert.strictEqual(merged.length, 4);
            assert.deepStrictEqual(merged.map(m => m._id), ["1", "2", "3", "4"]);
        });
    });
});

import { ExperienceActionService } from "../services/experiences/experienceActionService";
import { BookingCreationService } from "../services/bookings/bookingCreationService";
import { notificationService } from "../services/notificationService";
import mongoose from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";

describe("Experience Visibility, Hide/Unhide & Idempotency Test Suite", () => {
    const validHostId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const validAdminId = new mongoose.Types.ObjectId().toString();
    const validExpId = new mongoose.Types.ObjectId().toString();

    let fakeExpDoc: any;
    let mockExperienceModel: any;
    let mockUserModel: any;
    let mockAuditLogs: any[];
    let mockHostAuditLogModel: any;
    let adminNotifications: any[];
    let mockAdminNotifier: any;
    let actionService: ExperienceActionService;

    beforeEach(() => {
        fakeExpDoc = {
            _id: validExpId,
            title: "Mountain Trek Adventure",
            user: validHostId,
            status: "active",
            isHidden: false,
            hiddenAt: undefined,
            hideRequested: false,
            unhideRequested: false,
            unhideRequestedAt: undefined,
            hideReason: "",
            save: async function () { return this; }
        };

        mockExperienceModel = {
            findById: (id: any) => {
                const doc = id?.toString() === validExpId ? fakeExpDoc : null;
                const promise: any = Promise.resolve(doc);
                promise.populate = async () => doc;
                return promise;
            },
            updateOne: async () => ({ modifiedCount: 1 })
        };

        mockUserModel = {
            findById: async (id: any) => {
                if (id?.toString() === validHostId) {
                    return { _id: validHostId, firstname: "Alex", lastname: "Host", role: "host", email: "host@example.com" };
                }
                if (id?.toString() === otherUserId) {
                    return { _id: otherUserId, firstname: "John", lastname: "Guest", role: "guest" };
                }
                if (id?.toString() === validAdminId) {
                    return { _id: validAdminId, firstname: "Root", lastname: "Admin", role: "admin" };
                }
                return null;
            }
        };

        mockAuditLogs = [];
        mockHostAuditLogModel = {
            create: async (data: any) => {
                mockAuditLogs.push(data);
                return { _id: new mongoose.Types.ObjectId().toString(), ...data };
            },
            find: () => ({
                sort: () => mockAuditLogs
            }),
            deleteMany: async () => ({ deletedCount: 0 })
        };

        adminNotifications = [];
        mockAdminNotifier = async (_reqOrApp: any, payload: any) => {
            adminNotifications.push(payload);
            return true;
        };

        notificationService.sendNotification = async () => ({}) as any;

        // Reset singleton for test isolation
        (ExperienceActionService as any).instance = null;
        actionService = (ExperienceActionService as any).getInstance(
            mockExperienceModel,
            mockUserModel,
            {}, // notificationModel
            mockHostAuditLogModel,
            { cancelBookingsForExperience: async () => 0 },
            { delete: async () => {} },
            { syncMediaItems: async () => {} },
            { renderTemplate: () => "<html/>" },
            mockAdminNotifier
        );
    });

    describe("toggleHideExperience Authorization and Input Validation", () => {
        it("throws NotFoundError when experience does not exist", async () => {
            await assert.rejects(
                () => actionService.toggleHideExperience("507f1f77bcf86cd799439011", validHostId, "host", "request_hide"),
                NotFoundError
            );
        });

        it("throws ForbiddenError when caller is not the owner and not an admin", async () => {
            await assert.rejects(
                () => actionService.toggleHideExperience(validExpId, otherUserId, "guest", "request_hide"),
                ForbiddenError
            );
        });

        it("throws BadRequestError on unknown action", async () => {
            await assert.rejects(
                () => actionService.toggleHideExperience(validExpId, validHostId, "host", "destroy_everything"),
                BadRequestError
            );
        });
    });

    describe("action: request_hide & Idempotency", () => {
        it("successfully flags hideRequested and dispatches admin review notification", async () => {
            const res = await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_hide", "Seasonal snow shutdown");
            assert.strictEqual(res.hideRequested, true);
            assert.strictEqual(fakeExpDoc.hideRequested, true);
            assert.strictEqual(fakeExpDoc.hideReason, "Seasonal snow shutdown");
            assert.strictEqual(adminNotifications.length, 1);
            assert.strictEqual(adminNotifications[0].title, "Experience Hide Request");
        });

        it("is idempotent: repeated request_hide calls return current state without duplicate admin notifications", async () => {
            // First call
            await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_hide", "Break");
            assert.strictEqual(adminNotifications.length, 1);

            // Second call (idempotent)
            const secondRes = await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_hide", "Break again");
            assert.strictEqual(secondRes.hideRequested, true);
            assert.strictEqual(secondRes.message, "Hide request is already pending admin review");
            // No duplicate notification spammed
            assert.strictEqual(adminNotifications.length, 1);
        });

        it("rejects request_hide if experience is already hidden", async () => {
            fakeExpDoc.isHidden = true;
            await assert.rejects(
                () => actionService.toggleHideExperience(validExpId, validHostId, "host", "request_hide"),
                /Experience is already hidden/
            );
        });
    });

    describe("action: hide (direct hide) & Idempotency", () => {
        it("directly marks experience as hidden, records hiddenAt and logs host audit entry", async () => {
            const res = await actionService.toggleHideExperience(validExpId, validHostId, "host", "hide", "Off-season");
            assert.strictEqual(res.isHidden, true);
            assert.strictEqual(fakeExpDoc.isHidden, true);
            assert.ok(fakeExpDoc.hiddenAt instanceof Date);
            assert.strictEqual(fakeExpDoc.hideReason, "Off-season");
            assert.strictEqual(mockAuditLogs.length, 1);
            assert.strictEqual(mockAuditLogs[0].type, "experience_hide");
        });

        it("is idempotent: repeated hide calls do not overwrite hiddenAt or duplicate audit log entries", async () => {
            await actionService.toggleHideExperience(validExpId, validHostId, "host", "hide", "Off-season");
            const firstHiddenAt = fakeExpDoc.hiddenAt;
            assert.strictEqual(mockAuditLogs.length, 1);

            const secondRes = await actionService.toggleHideExperience(validExpId, validHostId, "host", "hide", "Off-season");
            assert.strictEqual(secondRes.isHidden, true);
            assert.strictEqual(secondRes.message, "Experience is already hidden");
            assert.strictEqual(fakeExpDoc.hiddenAt, firstHiddenAt);
            assert.strictEqual(mockAuditLogs.length, 1); // no duplicate audit log
        });
    });

    describe("action: request_unhide & Idempotency", () => {
        it("throws BadRequestError if experience is not currently hidden", async () => {
            fakeExpDoc.isHidden = false;
            await assert.rejects(
                () => actionService.toggleHideExperience(validExpId, validHostId, "host", "request_unhide"),
                /Experience is not currently hidden/
            );
        });

        it("successfully flags unhideRequested when hidden", async () => {
            fakeExpDoc.isHidden = true;
            const res = await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_unhide");
            assert.strictEqual(res.unhideRequested, true);
            assert.strictEqual(fakeExpDoc.unhideRequested, true);
            assert.ok(fakeExpDoc.unhideRequestedAt instanceof Date);
            assert.strictEqual(adminNotifications.length, 1);
        });

        it("is idempotent: repeated request_unhide calls return pending review status without spamming admin", async () => {
            fakeExpDoc.isHidden = true;
            await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_unhide");
            assert.strictEqual(adminNotifications.length, 1);

            const secondRes = await actionService.toggleHideExperience(validExpId, validHostId, "host", "request_unhide");
            assert.strictEqual(secondRes.unhideRequested, true);
            assert.strictEqual(secondRes.message, "Unhide request is already pending admin review");
            assert.strictEqual(adminNotifications.length, 1);
        });
    });

    describe("action: unhide (direct unhide) & Idempotency", () => {
        it("forbids non-admin users from unhiding an experience directly", async () => {
            fakeExpDoc.isHidden = true;
            await assert.rejects(
                () => actionService.toggleHideExperience(validExpId, validHostId, "host", "unhide"),
                ForbiddenError
            );
        });

        it("allows admin to directly unhide an experience and records audit log", async () => {
            fakeExpDoc.isHidden = true;
            fakeExpDoc.hiddenAt = new Date();
            fakeExpDoc.hideReason = "Closed";

            const res = await actionService.toggleHideExperience(validExpId, validAdminId, "admin", "unhide");
            assert.strictEqual(res.isHidden, false);
            assert.strictEqual(fakeExpDoc.isHidden, false);
            assert.strictEqual(fakeExpDoc.hiddenAt, undefined);
            assert.strictEqual(fakeExpDoc.hideReason, "");
            assert.strictEqual(mockAuditLogs.length, 1);
            assert.strictEqual(mockAuditLogs[0].type, "experience_unhide");
        });

        it("is idempotent: unhiding an already visible experience returns success without duplicate audit log", async () => {
            fakeExpDoc.isHidden = false;
            const res = await actionService.toggleHideExperience(validExpId, validAdminId, "admin", "unhide");
            assert.strictEqual(res.isHidden, false);
            assert.strictEqual(res.message, "Experience is already visible");
            assert.strictEqual(mockAuditLogs.length, 0);
        });
    });

    describe("updateExperienceStatus (Admin Reviews for Hide/Unhide Requests)", () => {
        it("approves hide request when admin passes status 'active' or 'approved'", async () => {
            fakeExpDoc.hideRequested = true;
            fakeExpDoc.hideReason = "Renovation";

            const res = await actionService.updateExperienceStatus(validExpId, "approved", "Approved by admin", validAdminId);
            assert.strictEqual(res.success, true);
            assert.strictEqual(fakeExpDoc.isHidden, true);
            assert.strictEqual(fakeExpDoc.hideRequested, false);
            assert.ok(fakeExpDoc.hiddenAt instanceof Date);
            assert.strictEqual(mockAuditLogs.length, 1);
            assert.strictEqual(mockAuditLogs[0].type, "experience_hide");
        });

        it("rejects hide request when admin passes status 'rejected' or 'inactive'", async () => {
            fakeExpDoc.hideRequested = true;
            fakeExpDoc.hideReason = "Renovation";

            const res = await actionService.updateExperienceStatus(validExpId, "rejected", "Cannot hide during peak tourist season", validAdminId);
            assert.strictEqual(res.success, true);
            assert.strictEqual(fakeExpDoc.isHidden, false);
            assert.strictEqual(fakeExpDoc.hideRequested, false);
        });

        it("approves unhide request when admin passes status 'active' or 'approved'", async () => {
            fakeExpDoc.isHidden = true;
            fakeExpDoc.hiddenAt = new Date();
            fakeExpDoc.unhideRequested = true;

            const res = await actionService.updateExperienceStatus(validExpId, "active", "Looks good", validAdminId);
            assert.strictEqual(res.success, true);
            assert.strictEqual(fakeExpDoc.isHidden, false);
            assert.strictEqual(fakeExpDoc.unhideRequested, false);
            assert.strictEqual(fakeExpDoc.hiddenAt, undefined);
            assert.strictEqual(mockAuditLogs.length, 1);
            assert.strictEqual(mockAuditLogs[0].type, "experience_unhide");
        });

        it("delegates status 'hidden' directly to toggleHideExperience", async () => {
            const res = await actionService.updateExperienceStatus(validExpId, "hidden", "Direct admin hide", validAdminId);
            assert.strictEqual(res.isHidden, true);
            assert.strictEqual(fakeExpDoc.isHidden, true);
            assert.strictEqual(mockAuditLogs.length, 1);
            assert.strictEqual(mockAuditLogs[0].type, "experience_hide");
        });
    });

    describe("BookingCreationService Guard Against Hidden Experiences", () => {
        it("rejects booking creation with 400 when experience is hidden", async () => {
            const hiddenExpDoc = {
                _id: validExpId,
                title: "Hidden Adventure",
                user: { _id: validHostId },
                status: "active",
                isHidden: true
            };

            const expModelMock = {
                findById: () => ({
                    populate: async () => hiddenExpDoc
                })
            };

            const userModelMock = {
                findById: async () => ({ _id: otherUserId, role: "guest", walletBalance: 0 })
            };

            (BookingCreationService as any).instance = null;
            const bookingService = (BookingCreationService as any).getInstance(
                {}, // bookingModel
                expModelMock,
                userModelMock,
                {}, // groupBookingModel
                {}, // hostDetailsModel
                {}  // paymentService
            );

            await assert.rejects(
                () => bookingService.createBooking({ experienceId: validExpId, numberOfPeople: 2 }, otherUserId, "guest"),
                /This experience is currently hidden and not available for booking/
            );
        });
    });
});
