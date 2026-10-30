import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    escapeRegex,
    normalizeSearchType,
    expandCategories,
    buildSortOptions,
    calculatePagination,
    buildRangeCondition,
    buildExperienceTextCondition,
    buildExperienceLocationCondition,
    buildUserTextCondition,
    SearchService,
    EXPERIENCE_SEARCH_SELECT,
    USER_SEARCH_SELECT
} from "../services/searchService";
import { GeocodingService } from "../services/geocodingService";

describe("Search Pure Helper Functions", () => {
    it("escapeRegex escapes special regex characters safely", () => {
        assert.strictEqual(escapeRegex("hello (world) [1]?*+"), "hello \\(world\\) \\[1\\]\\?\\*\\+");
        assert.strictEqual(escapeRegex(""), "");
        assert.strictEqual(escapeRegex(null as any), "");
        assert.strictEqual(escapeRegex(undefined as any), "");
    });

    it("normalizeSearchType maps aliases properly", () => {
        assert.strictEqual(normalizeSearchType("experiences"), "experience");
        assert.strictEqual(normalizeSearchType("experience"), "experience");
        assert.strictEqual(normalizeSearchType("treks"), "trek");
        assert.strictEqual(normalizeSearchType("trek"), "trek");
        assert.strictEqual(normalizeSearchType("services"), "service");
        assert.strictEqual(normalizeSearchType("service"), "service");
        assert.strictEqual(normalizeSearchType("hosts"), "host");
        assert.strictEqual(normalizeSearchType("host"), "host");
        assert.strictEqual(normalizeSearchType("guests"), "guest");
        assert.strictEqual(normalizeSearchType("guest"), "guest");
        assert.strictEqual(normalizeSearchType("people"), "people");
        assert.strictEqual(normalizeSearchType("users"), "people");
        assert.strictEqual(normalizeSearchType("user"), "people");
        assert.strictEqual(normalizeSearchType("all"), "all");
        assert.strictEqual(normalizeSearchType(""), "all");
        assert.strictEqual(normalizeSearchType(undefined), "all");
    });

    it("expandCategories expands legacy and trekking categories", () => {
        const expandedOthers = expandCategories("Others");
        assert.ok(expandedOthers.includes("Rock Climbing"));
        assert.ok(expandedOthers.includes("Flyboarding"));

        const expandedTrek = expandCategories(["trek", "Adventure"]);
        assert.ok(expandedTrek.includes("Trekking"));
        assert.ok(expandedTrek.includes("Adventure"));
    });

    it("buildSortOptions properly maps fields and applies deterministic tie-breakers", () => {
        assert.deepStrictEqual(buildSortOptions("rating", "asc"), {
            "rating.average": 1,
            "rating.count": 1,
            createdAt: -1
        });
        assert.deepStrictEqual(buildSortOptions("price", "desc"), {
            "price.perPerson": -1,
            createdAt: -1
        });
        assert.deepStrictEqual(buildSortOptions("clicks", "asc"), {
            clicks: 1,
            createdAt: -1
        });
        assert.deepStrictEqual(buildSortOptions("bookings", "desc"), {
            bookingCount: -1,
            createdAt: -1
        });
        assert.deepStrictEqual(buildSortOptions("savesCount", "desc"), {
            savesCount: -1,
            createdAt: -1
        });
        // Sanitization of unknown or prototype fields: defaults safely to createdAt
        assert.deepStrictEqual(buildSortOptions("__proto__" as any, "asc"), {
            createdAt: 1
        });
        assert.deepStrictEqual(buildSortOptions("$where" as any, "desc"), {
            createdAt: -1
        });
    });

    it("calculatePagination correctly computes pagination details and limits bounds", () => {
        const pag1 = calculatePagination(55, 1, 20);
        assert.strictEqual(pag1.currentPage, 1);
        assert.strictEqual(pag1.totalPages, 3);
        assert.strictEqual(pag1.totalResults, 55);
        assert.strictEqual(pag1.resultsPerPage, 20);
        assert.strictEqual(pag1.hasNextPage, true);
        assert.strictEqual(pag1.hasPrevPage, false);

        const pagLast = calculatePagination(55, 3, 20);
        assert.strictEqual(pagLast.currentPage, 3);
        assert.strictEqual(pagLast.hasNextPage, false);
        assert.strictEqual(pagLast.hasPrevPage, true);

        // Handles 0 results cleanly
        const pagZero = calculatePagination(0, 1, 20);
        assert.strictEqual(pagZero.totalPages, 0);
        assert.strictEqual(pagZero.hasNextPage, false);
        assert.strictEqual(pagZero.hasPrevPage, false);

        // Caps max limit to 100 to prevent DOS
        const pagCapped = calculatePagination(1000, 1, 9999);
        assert.strictEqual(pagCapped.resultsPerPage, 100);
    });

    it("buildRangeCondition properly builds min/max filters and handles inverted values", () => {
        assert.deepStrictEqual(buildRangeCondition(100, 500), { $gte: 100, $lte: 500 });
        assert.deepStrictEqual(buildRangeCondition(500, 100), { $gte: 100, $lte: 500 });
        assert.deepStrictEqual(buildRangeCondition(100, undefined), { $gte: 100 });
        assert.deepStrictEqual(buildRangeCondition(undefined, 500), { $lte: 500 });
        assert.strictEqual(buildRangeCondition(undefined, undefined), null);
        assert.strictEqual(buildRangeCondition("", ""), null);
    });

    it("buildExperienceTextCondition includes tags, meetingPoint, startPoint, categories", () => {
        const cond = buildExperienceTextCondition("river rafting");
        assert.ok(cond);
        assert.ok(Array.isArray(cond.$or));
        const fields = cond.$or.map((o: any) => Object.keys(o)[0]);
        assert.ok(fields.includes("title"));
        assert.ok(fields.includes("subtitle"));
        assert.ok(fields.includes("description"));
        assert.ok(fields.includes("location.city"));
        assert.ok(fields.includes("location.state"));
        assert.ok(fields.includes("location.country"));
        assert.ok(fields.includes("location.address"));
        assert.ok(fields.includes("location.meetingPoint"));
        assert.ok(fields.includes("location.startPoint"));
        assert.ok(fields.includes("categories"));
        assert.ok(fields.includes("tags"));
    });

    it("buildExperienceLocationCondition searches city, state, country, and address", () => {
        const cond = buildExperienceLocationCondition("Manali");
        assert.ok(cond);
        const fields = cond.$or.map((o: any) => Object.keys(o)[0]);
        assert.ok(fields.includes("location.city"));
        assert.ok(fields.includes("location.state"));
        assert.ok(fields.includes("location.country"));
        assert.ok(fields.includes("location.address"));
    });

    it("buildUserTextCondition removes bio, includes interests, and supports multi-word queries", () => {
        const condSingle = buildUserTextCondition("John");
        assert.ok(condSingle);
        const fields = condSingle.$or.map((o: any) => Object.keys(o)[0]);
        assert.ok(!fields.includes("bio"), "Should not include dead field bio");
        assert.ok(fields.includes("interests"), "Should include interests field");

        const condMulti = buildUserTextCondition("John Doe");
        assert.ok(condMulti);
        const hasAndNameMatch = condMulti.$or.some((o: any) => o.$and && o.$and.length === 2);
        assert.ok(hasAndNameMatch, "Should support multi-word first+last matching");
    });
});

describe("SearchService Query Execution and Security Logic", () => {
    let capturedExpQuery: any = null;
    let capturedUserQuery: any = null;

    const mockExperienceModel = {
        find: (query: any) => {
            capturedExpQuery = query;
            return {
                select: () => ({
                    populate: () => ({
                        sort: () => ({
                            skip: () => ({
                                limit: () => ({
                                    lean: async () => [
                                        {
                                            _id: "exp1",
                                            title: "River Rafting Adventure",
                                            status: "active",
                                            isHidden: false,
                                            rating: { average: 4.8, count: 20 },
                                            location: { city: "Rishikesh", state: "Uttarakhand" }
                                        }
                                    ]
                                })
                            })
                        })
                    })
                })
            };
        },
        countDocuments: async (query: any) => {
            capturedExpQuery = query;
            return 1;
        }
    };

    const mockUserModel = {
        find: (query: any) => {
            capturedUserQuery = query;
            return {
                select: () => ({
                    limit: () => ({
                        skip: () => ({
                            lean: async () => [
                                {
                                    _id: "user1",
                                    firstname: "Aarav",
                                    lastname: "Sharma",
                                    role: "host",
                                    email: "aarav@example.com"
                                }
                            ]
                        })
                    })
                })
            };
        },
        countDocuments: async (query: any) => {
            capturedUserQuery = query;
            return 1;
        }
    };

    let service: SearchService;

    beforeEach(() => {
        capturedExpQuery = null;
        capturedUserQuery = null;
        SearchService.resetInstance();
        service = SearchService.getInstance(mockExperienceModel, mockUserModel);
    });

    it("searchAll enforces isHidden: { $ne: true } and excludes admins/deleted users", async () => {
        const result = await service.searchAll({ q: "rafting", type: "all" });

        assert.strictEqual(capturedExpQuery.status, "active");
        assert.deepStrictEqual(capturedExpQuery.isHidden, { $ne: true });

        assert.deepStrictEqual(capturedUserQuery.isDeleted, { $ne: true });
        assert.deepStrictEqual(capturedUserQuery.role, { $ne: "admin" });

        assert.strictEqual(result.experiences.length, 1);
        assert.strictEqual(result.people.length, 1);
        assert.strictEqual(result.pagination.totalResults, 2);
    });

    it("searchAll correctly restricts user roles for host and guest searches", async () => {
        await service.searchAll({ type: "host" });
        assert.strictEqual(capturedUserQuery.role, "host");

        await service.searchAll({ type: "guest" });
        assert.deepStrictEqual(capturedUserQuery.role, { $in: ["guest", "user"] });
    });

    it("advancedSearch enforces isHidden: { $ne: true } and handles multi-field filters safely", async () => {
        const result = await service.advancedSearch({
            searchText: "trekking",
            experienceTypes: ["trek"],
            locations: ["Manali", "Goa"],
            difficulties: ["Moderate"],
            categories: ["Adventure"],
            priceRange: { min: 1000, max: 5000 },
            durationRange: { minDays: 2, maxDays: 5 },
            amenities: ["Guide"],
            rating: "4.5"
        });

        assert.strictEqual(capturedExpQuery.status, "active");
        assert.deepStrictEqual(capturedExpQuery.isHidden, { $ne: true });
        assert.deepStrictEqual(capturedExpQuery["price.perPerson"], { $gte: 1000, $lte: 5000 });
        assert.deepStrictEqual(capturedExpQuery["duration.days"], { $gte: 2, $lte: 5 });
        assert.deepStrictEqual(capturedExpQuery["rating.average"], { $gte: 4.5 });
        assert.deepStrictEqual(capturedExpQuery.difficulty, { $in: ["Moderate"] });
        assert.deepStrictEqual(capturedExpQuery.amenities, { $all: ["Guide"] });

        assert.strictEqual(result.results.length, 1);
        assert.strictEqual(result.pagination.totalResults, 1);
    });

    it("getSearchSuggestions validates query and checks isHidden", async () => {
        await assert.rejects(
            async () => await service.getSearchSuggestions(""),
            { message: "Query parameter 'q' is required" }
        );

        let suggestionQuery: any = null;
        const mockExpWithQuery = {
            find: (query: any) => {
                suggestionQuery = query;
                return {
                    select: () => ({
                        limit: () => ({
                            lean: async () => [
                                {
                                    _id: "exp123",
                                    title: "Kayaking in Alleppey",
                                    location: { city: "Alleppey", state: "Kerala" }
                                }
                            ]
                        })
                    })
                };
            }
        };

        SearchService.resetInstance();
        const customService = SearchService.getInstance(mockExpWithQuery, mockUserModel);
        const res = await customService.getSearchSuggestions("kayak");

        assert.strictEqual(suggestionQuery.status, "active");
        assert.deepStrictEqual(suggestionQuery.isHidden, { $ne: true });
        assert.strictEqual(res.suggestions.length, 1);
        assert.strictEqual(res.suggestions[0].id, "exp123");
        assert.strictEqual(res.suggestions[0].text, "Kayaking in Alleppey");
        assert.strictEqual(res.suggestions[0].location, "Alleppey");
    });

    it("searchByLocation validates required location and respects filters", async () => {
        await assert.rejects(
            async () => await service.searchByLocation({ location: "" }),
            { message: "Location parameter is required" }
        );

        const res = await service.searchByLocation({
            location: "Goa",
            type: "trek",
            category: "Adventure",
            difficulty: "Easy"
        });

        assert.strictEqual(capturedExpQuery.status, "active");
        assert.deepStrictEqual(capturedExpQuery.isHidden, { $ne: true });
        assert.strictEqual(capturedExpQuery.difficulty, "Easy");
        assert.strictEqual(res.location, "Goa");
        assert.strictEqual(res.results.length, 1);
    });
});

describe("GeocodingService Unit Tests", () => {
    it("validates coordinate boundaries in reverseGeocode", async () => {
        const geoService = GeocodingService.getInstance();

        await assert.rejects(
            async () => await geoService.reverseGeocode(null as any, 77),
            { message: "Latitude and longitude are required" }
        );

        await assert.rejects(
            async () => await geoService.reverseGeocode(95, 77),
            { message: "Latitude must be between -90 and 90, and longitude between -180 and 180" }
        );

        await assert.rejects(
            async () => await geoService.reverseGeocode(12, 195),
            { message: "Latitude must be between -90 and 90, and longitude between -180 and 180" }
        );

        await assert.rejects(
            async () => await geoService.reverseGeocode("abc", "def"),
            { message: "Latitude must be between -90 and 90, and longitude between -180 and 180" }
        );
    });

    it("validates query string in geocodeSearch", async () => {
        const geoService = GeocodingService.getInstance();
        await assert.rejects(
            async () => await geoService.geocodeSearch(""),
            { message: "Query parameter 'q' is required" }
        );
    });

    it("parseGoogleAddress extracts normalized address components", () => {
        const geoService = GeocodingService.getInstance();
        const components = [
            { long_name: "Bengaluru", short_name: "BLR", types: ["locality"] },
            { long_name: "Karnataka", short_name: "KA", types: ["administrative_area_level_1"] },
            { long_name: "India", short_name: "IN", types: ["country"] },
            { long_name: "560001", short_name: "560001", types: ["postal_code"] }
        ];

        const parsed = geoService.parseGoogleAddress(components);
        assert.strictEqual(parsed.city, "Bengaluru");
        assert.strictEqual(parsed.state, "Karnataka");
        assert.strictEqual(parsed.country, "India");
        assert.strictEqual(parsed.country_code, "in");
        assert.strictEqual(parsed.postcode, "560001");
    });
});

describe("Search Handler Controller Tests", () => {
    const searchHandler = require("../handlers/searchHandler");

    function createMockRes() {
        const res: any = {
            statusCode: 200,
            body: null,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(data: any) {
                this.body = data;
                return this;
            }
        };
        return res;
    }

    it("getSearchSuggestions returns 400 when q is missing or whitespace", async () => {
        const req = { query: { q: "   " } };
        const res = createMockRes();

        await searchHandler.getSearchSuggestions(req, res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.message, "Query parameter 'q' is required");
    });

    it("searchByLocation returns 400 when location is missing", async () => {
        const req = { query: { location: "" } };
        const res = createMockRes();

        await searchHandler.searchByLocation(req, res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.message, "Location parameter is required");
    });

    it("reverseGeocode returns 400 when coordinates are invalid", async () => {
        const reqMissing = { query: { lat: "", lon: "" } };
        const resMissing = createMockRes();
        await searchHandler.reverseGeocode(reqMissing, resMissing);
        assert.strictEqual(resMissing.statusCode, 400);
        assert.strictEqual(resMissing.body.message, "lat and lon are required");

        const reqInvalid = { query: { lat: "200", lon: "50" } };
        const resInvalid = createMockRes();
        await searchHandler.reverseGeocode(reqInvalid, resInvalid);
        assert.strictEqual(resInvalid.statusCode, 400);
        assert.ok(resInvalid.body.message.includes("between -90 and 90"));
    });

    it("geocodeSearch returns 400 when query q is missing", async () => {
        const req = { query: { q: "" } };
        const res = createMockRes();

        await searchHandler.geocodeSearch(req, res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.message, "q is required");
    });
});

