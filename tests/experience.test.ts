import { describe, it } from "node:test";
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
