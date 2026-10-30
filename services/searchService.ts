/**
 * Search Service
 * Domain service providing multi-entity search, advanced filters,
 * autocomplete suggestions, and geo-location queries.
 */

const { Experience, User } = require("../db/mongoose");
import { geocodingService as defaultGeocodingService, GeocodingService } from "./geocodingService";

export const EXPERIENCE_SEARCH_SELECT =
    "title subtitle photos location price duration difficulty categories discounts isFeatured status rating bookingCount clicks user createdAt";

export const USER_SEARCH_SELECT =
    "firstname lastname email avatar role location description bio";

export interface PaginationDetails {
    currentPage: number;
    totalPages: number;
    totalResults: number;
    resultsPerPage: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

export interface UniversalSearchOptions {
    q?: string;
    type?: string;
    location?: string;
    city?: string;
    difficulty?: string;
    category?: string;
    minPrice?: number | string;
    maxPrice?: number | string;
    sortBy?: string;
    sortOrder?: string;
    page?: number | string;
    limit?: number | string;
}

export interface UniversalSearchResult {
    results: any[];
    people: any[];
    experiences: any[];
    posts: any[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalResults: number;
        resultsPerPage: number;
    };
    filters: {
        query: string | null;
        type: string;
        location: string | null;
    };
}

export interface AdvancedSearchOptions {
    searchText?: string;
    experienceTypes?: string[];
    postTypes?: string[];
    locations?: string[];
    difficulties?: string[];
    categories?: string[];
    priceRange?: { min?: number; max?: number };
    durationRange?: { minDays?: number; maxDays?: number };
    amenities?: string[];
    rating?: number | string | null;
    sortBy?: string;
    sortOrder?: string;
    page?: number | string;
    limit?: number | string;
}

export interface AdvancedSearchResult {
    results: any[];
    pagination: PaginationDetails;
}

export interface SearchSuggestionItem {
    text: string;
    location: string;
    type: string;
}

export interface SearchSuggestionsResult {
    suggestions: SearchSuggestionItem[];
}

export interface LocationSearchOptions {
    location: string;
    type?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number | string;
    limit?: number | string;
}

export interface LocationSearchResult {
    location: string;
    summary: {
        total: number;
        experiences: number;
    };
    results: any[];
    experiences: any[];
    pagination: PaginationDetails;
}

/* ---------------- Pure Helper Functions ---------------- */

export function escapeRegex(text: string): string {
    if (!text || typeof text !== "string") return "";
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSearchType(type?: string): string {
    const raw = (type || "all").toLowerCase().trim();
    if (raw === "experiences" || raw === "experience") return "experience";
    if (raw === "treks" || raw === "trek") return "trek";
    if (raw === "services" || raw === "service") return "service";
    if (raw === "hosts" || raw === "host") return "host";
    if (raw === "guests" || raw === "guest") return "guest";
    if (raw === "people" || raw === "users" || raw === "user") return "people";
    return "all";
}

export function expandCategories(categories: string[] | string): string[] {
    const list = Array.isArray(categories) ? categories : [categories];
    return list.flatMap(cat => {
        const lc = String(cat).trim().toLowerCase();
        if (lc === "others" || lc === "other") {
            return ["Others", "Other", "Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding"];
        }
        if (lc === "trek" || lc === "trekking") {
            return ["Trek", "Trekking", "trek", "trekking"];
        }
        return [cat];
    });
}

export function buildSortOptions(
    sortBy: string = "createdAt",
    sortOrder: string = "desc"
): Record<string, 1 | -1> {
    const direction: 1 | -1 = sortOrder === "asc" ? 1 : -1;
    if (sortBy === "rating") return { "rating.average": direction };
    if (sortBy === "price") return { "price.perPerson": direction };
    if (sortBy === "clicks") return { clicks: direction };
    if (sortBy === "bookings" || sortBy === "bookingCount") return { bookingCount: direction };
    return { [sortBy]: direction };
}

export function calculatePagination(
    totalCount: number,
    page: number = 1,
    limit: number = 20
): PaginationDetails {
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.max(1, parseInt(String(limit)) || 20);
    const totalPages = Math.ceil(totalCount / limitNum);
    return {
        currentPage: pageNum,
        totalPages,
        totalResults: totalCount,
        resultsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
    };
}

export function buildRangeCondition(
    minVal?: number | string,
    maxVal?: number | string
): Record<string, number> | null {
    const min = minVal !== undefined && minVal !== "" && minVal !== null ? parseFloat(String(minVal)) : NaN;
    const max = maxVal !== undefined && maxVal !== "" && maxVal !== null ? parseFloat(String(maxVal)) : NaN;
    if (isNaN(min) && isNaN(max)) return null;
    const cond: Record<string, number> = {};
    if (!isNaN(min)) cond.$gte = min;
    if (!isNaN(max)) cond.$lte = max;
    return cond;
}

export function buildExperienceTextCondition(q: string): Record<string, any> | null {
    if (!q || !q.trim()) return null;
    const escaped = escapeRegex(q.trim());
    return {
        $or: [
            { title: { $regex: escaped, $options: "i" } },
            { subtitle: { $regex: escaped, $options: "i" } },
            { description: { $regex: escaped, $options: "i" } },
            { "location.city": { $regex: escaped, $options: "i" } },
            { "location.state": { $regex: escaped, $options: "i" } },
            { "location.country": { $regex: escaped, $options: "i" } },
            { "location.address": { $regex: escaped, $options: "i" } },
            { categories: { $regex: escaped, $options: "i" } }
        ]
    };
}

export function buildExperienceLocationCondition(location: string): Record<string, any> | null {
    if (!location || !location.trim()) return null;
    const escaped = escapeRegex(location.trim());
    return {
        $or: [
            { "location.city": { $regex: escaped, $options: "i" } },
            { "location.state": { $regex: escaped, $options: "i" } },
            { "location.country": { $regex: escaped, $options: "i" } }
        ]
    };
}

export function buildUserTextCondition(q: string): Record<string, any> | null {
    if (!q || !q.trim()) return null;
    const escaped = escapeRegex(q.trim());
    return {
        $or: [
            { firstname: { $regex: escaped, $options: "i" } },
            { lastname: { $regex: escaped, $options: "i" } },
            { email: { $regex: escaped, $options: "i" } },
            { "location.city": { $regex: escaped, $options: "i" } },
            { "location.state": { $regex: escaped, $options: "i" } },
            { "location.country": { $regex: escaped, $options: "i" } },
            { "location.address": { $regex: escaped, $options: "i" } },
            { bio: { $regex: escaped, $options: "i" } },
            { description: { $regex: escaped, $options: "i" } }
        ]
    };
}

/* ---------------- Search Service Class ---------------- */

export class SearchService {
    private static instance: SearchService | null = null;
    private static instanceKey = Symbol("SearchServiceInstanceKey");

    private experienceModel: any;
    private userModel: any;
    private geocoding: GeocodingService;

    constructor(
        instanceKey: symbol,
        experienceModel: any = Experience,
        userModel: any = User,
        geocoding: GeocodingService = defaultGeocodingService
    ) {
        if (instanceKey !== SearchService.instanceKey) {
            throw new Error("Use SearchService.getInstance() to obtain the singleton instance.");
        }
        this.experienceModel = experienceModel;
        this.userModel = userModel;
        this.geocoding = geocoding;
    }

    public static getInstance(
        experienceModel?: any,
        userModel?: any,
        geocoding?: GeocodingService
    ): SearchService {
        if (!this.instance) {
            this.instance = new SearchService(
                this.instanceKey,
                experienceModel || Experience,
                userModel || User,
                geocoding || defaultGeocodingService
            );
        }
        return this.instance;
    }

    /**
     * Unified query runner for experiences - eliminates repetitive Mongoose boilerplate
     */
    private async executeExperienceQuery(
        query: any,
        sortOptions: Record<string, 1 | -1>,
        skip: number,
        limit: number
    ): Promise<{ items: any[]; totalCount: number }> {
        const [items, totalCount] = await Promise.all([
            this.experienceModel.find(query)
                .select(EXPERIENCE_SEARCH_SELECT)
                .populate("user", "firstname lastname email avatar role")
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .lean(),
            this.experienceModel.countDocuments(query)
        ]);
        return { items, totalCount };
    }

    /**
     * Search across all experiences and people (universal search)
     */
    public async searchAll(options: UniversalSearchOptions = {}): Promise<UniversalSearchResult> {
        const {
            q,
            type = "all",
            location,
            city,
            difficulty,
            category,
            minPrice,
            maxPrice,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = options;

        const effectiveLocation = (location || city || "").trim();
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 20);
        const skip = (pageNum - 1) * limitNum;
        const searchType = normalizeSearchType(type);

        let postResults: any[] = [];
        let userResults: any[] = [];
        let totalPostCount = 0;
        let totalUserCount = 0;

        // 1. Search Experiences
        if (searchType === "all" || ["experience", "trek", "service"].includes(searchType)) {
            const postQuery: any = { status: "active" };

            if (searchType === "trek") {
                postQuery.categories = { $in: ["Trek", "Trekking", "trek", "trekking"] };
            }

            const andConditions: any[] = [];
            const textCond = q ? buildExperienceTextCondition(q) : null;
            if (textCond) andConditions.push(textCond);

            const locCond = effectiveLocation ? buildExperienceLocationCondition(effectiveLocation) : null;
            if (locCond) andConditions.push(locCond);

            if (andConditions.length > 0) postQuery.$and = andConditions;
            if (difficulty) postQuery.difficulty = difficulty;
            if (category) postQuery.categories = { $in: expandCategories(category) };

            const priceCond = buildRangeCondition(minPrice, maxPrice);
            if (priceCond) postQuery["price.perPerson"] = priceCond;

            const sortOptions = buildSortOptions(sortBy, sortOrder);
            const { items, totalCount } = await this.executeExperienceQuery(postQuery, sortOptions, skip, limitNum);

            totalPostCount = totalCount;
            postResults = items.map((item: any) => ({
                ...item,
                rating: item.rating?.average ?? (typeof item.rating === "number" ? item.rating : 0)
            }));
        }

        // 2. Search People
        if (searchType === "all" || ["people", "host", "guest"].includes(searchType)) {
            const userQuery: any = {};
            if (searchType === "host") userQuery.role = "host";
            if (searchType === "guest") userQuery.role = { $in: ["guest", "user"] };

            const userAndConditions: any[] = [];
            const userTextCond = q ? buildUserTextCondition(q) : null;
            if (userTextCond) userAndConditions.push(userTextCond);

            const userLocCond = effectiveLocation ? buildExperienceLocationCondition(effectiveLocation) : null;
            if (userLocCond) userAndConditions.push(userLocCond);

            if (userAndConditions.length > 0) userQuery.$and = userAndConditions;

            const userLimit = searchType === "all" ? 5 : limitNum;
            const userSkip = searchType === "all" ? 0 : skip;

            const [foundUsers, countUsers] = await Promise.all([
                this.userModel.find(userQuery)
                    .select(USER_SEARCH_SELECT)
                    .limit(userLimit)
                    .skip(userSkip)
                    .lean(),
                this.userModel.countDocuments(userQuery)
            ]);

            userResults = foundUsers;
            totalUserCount = countUsers;
        }

        const totalResults = totalPostCount + totalUserCount;
        const totalPages = Math.ceil(
            (["people", "host", "guest"].includes(searchType) ? totalUserCount : totalPostCount) / limitNum
        );

        let combinedResults: any[];
        if (["people", "host", "guest"].includes(searchType)) {
            combinedResults = userResults;
        } else if (searchType === "all") {
            combinedResults = [
                ...postResults,
                ...userResults.map((u: any) => ({ ...u, entityType: "user", postType: "user" }))
            ];
        } else {
            combinedResults = postResults;
        }

        return {
            results: combinedResults,
            people: userResults,
            experiences: postResults,
            posts: postResults,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalResults,
                resultsPerPage: limitNum
            },
            filters: {
                query: q || null,
                type: searchType,
                location: location || null
            }
        };
    }

    /**
     * Multi-criteria advanced search
     */
    public async advancedSearch(options: AdvancedSearchOptions = {}): Promise<AdvancedSearchResult> {
        const {
            searchText,
            experienceTypes,
            postTypes = ["experience", "trek", "service"],
            locations = [],
            difficulties = [],
            categories = [],
            priceRange = {},
            durationRange = {},
            amenities = [],
            rating = null,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = options;

        const effectiveTypes = experienceTypes || postTypes;
        const query: any = { status: "active" };

        if (
            effectiveTypes &&
            effectiveTypes.length > 0 &&
            effectiveTypes.includes("trek") &&
            !effectiveTypes.includes("experience") &&
            !effectiveTypes.includes("all")
        ) {
            query.categories = { $in: ["Trek", "Trekking", "trek", "trekking"] };
        }

        const andConditions: any[] = [];
        if (searchText && searchText.trim()) {
            const textCond = buildExperienceTextCondition(searchText);
            if (textCond) andConditions.push(textCond);
        }

        if (locations && locations.length > 0) {
            const locRegexes = locations.map(l => new RegExp(escapeRegex(l), "i"));
            andConditions.push({
                $or: [
                    { "location.city": { $in: locRegexes } },
                    { "location.country": { $in: locRegexes } }
                ]
            });
        }

        if (andConditions.length > 0) query.$and = andConditions;
        if (difficulties && difficulties.length > 0) query.difficulty = { $in: difficulties };
        if (categories && categories.length > 0) query.categories = { $in: expandCategories(categories) };

        const priceCond = buildRangeCondition(priceRange.min, priceRange.max);
        if (priceCond) query["price.perPerson"] = priceCond;

        const durationCond = buildRangeCondition(durationRange.minDays, durationRange.maxDays);
        if (durationCond) query["duration.days"] = durationCond;

        if (amenities && amenities.length > 0) query.amenities = { $all: amenities };
        if (rating !== null && rating !== undefined && rating !== "") {
            query["rating.average"] = { $gte: parseFloat(String(rating)) };
        }

        const sortOptions = buildSortOptions(sortBy, sortOrder);
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 20);
        const skip = (pageNum - 1) * limitNum;

        const { items, totalCount } = await this.executeExperienceQuery(query, sortOptions, skip, limitNum);

        return {
            results: items,
            pagination: calculatePagination(totalCount, pageNum, limitNum)
        };
    }

    /**
     * Autocomplete suggestions for quick search
     */
    public async getSearchSuggestions(query: string): Promise<SearchSuggestionsResult> {
        if (!query || !query.trim()) {
            const err: any = new Error("Query parameter 'q' is required");
            err.statusCode = 400;
            throw err;
        }

        const escaped = escapeRegex(query.trim());
        const suggestions = await this.experienceModel.find({
            status: "active",
            $or: [
                { title: { $regex: escaped, $options: "i" } },
                { "location.city": { $regex: escaped, $options: "i" } }
            ]
        })
            .select("title location.city")
            .limit(10)
            .lean();

        return {
            suggestions: suggestions.map((item: any) => ({
                text: item.title,
                location: item.location?.city || "",
                type: "experience"
            }))
        };
    }

    /**
     * Search experiences by location
     */
    public async searchByLocation(options: LocationSearchOptions): Promise<LocationSearchResult> {
        const {
            location,
            type = "all",
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = options;

        if (!location || !location.trim()) {
            const err: any = new Error("Location parameter is required");
            err.statusCode = 400;
            throw err;
        }

        const query: any = {
            status: "active",
            ...buildExperienceLocationCondition(location)
        };

        if (normalizeSearchType(type) === "trek") {
            query.categories = { $in: ["Trek", "Trekking", "trek", "trekking"] };
        }

        const sortOptions = buildSortOptions(sortBy, sortOrder);
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 20);
        const skip = (pageNum - 1) * limitNum;

        const { items, totalCount } = await this.executeExperienceQuery(query, sortOptions, skip, limitNum);

        return {
            location,
            summary: {
                total: totalCount,
                experiences: items.length
            },
            results: items,
            experiences: items,
            pagination: calculatePagination(totalCount, pageNum, limitNum)
        };
    }

    // Geocoding delegations for backward compatibility
    public reverseGeocode(lat: string | number, lon: string | number): Promise<any> {
        return this.geocoding.reverseGeocode(lat, lon);
    }

    public geocodeSearch(query: string, options: any = {}): Promise<any> {
        return this.geocoding.geocodeSearch(query, options);
    }
}

export const searchService = SearchService.getInstance();
