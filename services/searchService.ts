/**
 * Search Service
 * Domain service providing multi-entity search, advanced filters,
 * autocomplete suggestions, and geo-location queries.
 */

const { Experience, User } = require("../db/mongoose");
import { BadRequestError } from "../errors";
import { geocodingService as defaultGeocodingService, GeocodingService } from "./geocodingService";

export const EXPERIENCE_SEARCH_SELECT =
    "title subtitle photos location price duration difficulty categories discounts isFeatured status rating bookingCount savesCount clicks user createdAt approvedAt";

export const USER_SEARCH_SELECT =
    "firstname lastname email avatar role location description interests";

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
    pagination: PaginationDetails;
    filters: {
        query: string | null;
        type: string;
        location: string | null;
    };
}

export interface AdvancedSearchOptions {
    searchText?: string;
    experienceTypes?: string[] | string;
    postTypes?: string[] | string;
    locations?: string[] | string;
    difficulties?: string[] | string;
    categories?: string[] | string;
    priceRange?: { min?: number | string; max?: number | string };
    durationRange?: {
        minDays?: number | string;
        maxDays?: number | string;
        minHours?: number | string;
        maxHours?: number | string;
    };
    amenities?: string[] | string;
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
    id?: string;
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
    category?: string;
    difficulty?: string;
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
    const cleanSortBy = typeof sortBy === "string" ? sortBy.trim() : "createdAt";

    switch (cleanSortBy) {
        case "rating":
            return { "rating.average": direction, "rating.count": direction, createdAt: -1 };
        case "price":
            return { "price.perPerson": direction, createdAt: -1 };
        case "clicks":
            return { clicks: direction, createdAt: -1 };
        case "bookings":
        case "bookingCount":
            return { bookingCount: direction, createdAt: -1 };
        case "saves":
        case "savesCount":
            return { savesCount: direction, createdAt: -1 };
        case "title":
            return { title: direction };
        case "approvedAt":
            return { approvedAt: direction, createdAt: -1 };
        case "updatedAt":
            return { updatedAt: direction };
        case "createdAt":
        default:
            return { createdAt: direction };
    }
}

export function calculatePagination(
    totalCount: number,
    page: number | string = 1,
    limit: number | string = 20
): PaginationDetails {
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const parsedLimit = parseInt(String(limit), 10) || 20;
    const limitNum = Math.max(1, Math.min(100, parsedLimit));
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / limitNum) : 0;
    return {
        currentPage: pageNum,
        totalPages,
        totalResults: totalCount,
        resultsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1 && totalPages > 0
    };
}

export function buildRangeCondition(
    minVal?: number | string,
    maxVal?: number | string
): Record<string, number> | null {
    let min = minVal !== undefined && minVal !== "" && minVal !== null ? parseFloat(String(minVal)) : NaN;
    let max = maxVal !== undefined && maxVal !== "" && maxVal !== null ? parseFloat(String(maxVal)) : NaN;
    if (isNaN(min) && isNaN(max)) return null;

    if (!isNaN(min) && !isNaN(max) && min > max) {
        // Gracefully swap if inverted
        [min, max] = [max, min];
    }

    const cond: Record<string, number> = {};
    if (!isNaN(min)) cond.$gte = min;
    if (!isNaN(max)) cond.$lte = max;
    return cond;
}

export function buildExperienceTextCondition(q: string): Record<string, any> | null {
    if (!q || typeof q !== "string" || !q.trim()) return null;
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
            { "location.meetingPoint": { $regex: escaped, $options: "i" } },
            { "location.startPoint": { $regex: escaped, $options: "i" } },
            { categories: { $regex: escaped, $options: "i" } },
            { tags: { $regex: escaped, $options: "i" } }
        ]
    };
}

export function buildExperienceLocationCondition(location: string): Record<string, any> | null {
    if (!location || typeof location !== "string" || !location.trim()) return null;
    const escaped = escapeRegex(location.trim());
    return {
        $or: [
            { "location.city": { $regex: escaped, $options: "i" } },
            { "location.state": { $regex: escaped, $options: "i" } },
            { "location.country": { $regex: escaped, $options: "i" } },
            { "location.address": { $regex: escaped, $options: "i" } }
        ]
    };
}

export function buildUserTextCondition(q: string): Record<string, any> | null {
    if (!q || typeof q !== "string" || !q.trim()) return null;
    const trimmed = q.trim();
    const escaped = escapeRegex(trimmed);

    const conditions: Record<string, any>[] = [
        { firstname: { $regex: escaped, $options: "i" } },
        { lastname: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { "location.city": { $regex: escaped, $options: "i" } },
        { "location.state": { $regex: escaped, $options: "i" } },
        { "location.country": { $regex: escaped, $options: "i" } },
        { "location.address": { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { interests: { $regex: escaped, $options: "i" } }
    ];

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        conditions.push({
            $and: [
                { firstname: { $regex: escapeRegex(words[0]), $options: "i" } },
                { lastname: { $regex: escapeRegex(words.slice(1).join(" ")), $options: "i" } }
            ]
        });
    }

    return { $or: conditions };
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

    public static resetInstance(): void {
        this.instance = null;
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
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const parsedLimit = parseInt(String(limit), 10) || 20;
        const limitNum = Math.max(1, Math.min(100, parsedLimit));
        const skip = (pageNum - 1) * limitNum;
        const searchType = normalizeSearchType(type);

        let postResults: any[] = [];
        let userResults: any[] = [];
        let totalPostCount = 0;
        let totalUserCount = 0;

        // 1. Search Experiences
        if (searchType === "all" || ["experience", "trek", "service"].includes(searchType)) {
            const postQuery: any = {
                status: "active",
                isHidden: { $ne: true }
            };

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
                rating: item.rating?.average ?? (typeof item.rating === "number" ? item.rating : 0),
                averageRating: item.rating?.average ?? (typeof item.rating === "number" ? item.rating : 0),
                ratingData: item.rating && typeof item.rating === "object" ? item.rating : { average: item.rating || 0, count: 0 }
            }));
        }

        // 2. Search People
        if (searchType === "all" || ["people", "host", "guest"].includes(searchType)) {
            const userQuery: any = {
                isDeleted: { $ne: true }
            };

            if (searchType === "host") {
                userQuery.role = "host";
            } else if (searchType === "guest") {
                userQuery.role = { $in: ["guest", "user"] };
            } else {
                userQuery.role = { $ne: "admin" };
            }

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
        const paginatedStreamTotal = ["people", "host", "guest"].includes(searchType) ? totalUserCount : totalPostCount;
        const pagination = calculatePagination(paginatedStreamTotal, pageNum, limitNum);
        pagination.totalResults = totalResults;

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
            pagination,
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

        const effectiveTypes = (experienceTypes || postTypes);
        const typesList = (Array.isArray(effectiveTypes) ? effectiveTypes : [effectiveTypes])
            .map(t => (typeof t === "string" ? t.trim().toLowerCase() : ""))
            .filter(Boolean);

        const query: any = {
            status: "active",
            isHidden: { $ne: true }
        };

        const andConditions: any[] = [];

        if (
            typesList.length > 0 &&
            typesList.includes("trek") &&
            !typesList.includes("experience") &&
            !typesList.includes("all")
        ) {
            andConditions.push({ categories: { $in: ["Trek", "Trekking", "trek", "trekking"] } });
        }

        if (searchText && typeof searchText === "string" && searchText.trim()) {
            const textCond = buildExperienceTextCondition(searchText);
            if (textCond) andConditions.push(textCond);
        }

        const locArray = (Array.isArray(locations) ? locations : [locations])
            .map(l => (typeof l === "string" ? l.trim() : ""))
            .filter(Boolean);

        if (locArray.length > 0) {
            const locRegexes = locArray.map(l => new RegExp(escapeRegex(l), "i"));
            andConditions.push({
                $or: [
                    { "location.city": { $in: locRegexes } },
                    { "location.state": { $in: locRegexes } },
                    { "location.country": { $in: locRegexes } },
                    { "location.address": { $in: locRegexes } }
                ]
            });
        }

        const categoriesList = (Array.isArray(categories) ? categories : [categories])
            .map(c => (typeof c === "string" ? c.trim() : ""))
            .filter(Boolean);

        if (categoriesList.length > 0) {
            andConditions.push({ categories: { $in: expandCategories(categoriesList) } });
        }

        if (andConditions.length > 0) query.$and = andConditions;

        const diffList = (Array.isArray(difficulties) ? difficulties : [difficulties])
            .map(d => (typeof d === "string" ? d.trim() : ""))
            .filter(Boolean);
        if (diffList.length > 0) query.difficulty = { $in: diffList };

        const priceCond = buildRangeCondition(priceRange?.min, priceRange?.max);
        if (priceCond) query["price.perPerson"] = priceCond;

        const durationCond = buildRangeCondition(durationRange?.minDays, durationRange?.maxDays);
        if (durationCond) query["duration.days"] = durationCond;

        const amenityList = (Array.isArray(amenities) ? amenities : [amenities])
            .map(a => (typeof a === "string" ? a.trim() : ""))
            .filter(Boolean);
        if (amenityList.length > 0) query.amenities = { $all: amenityList };

        if (rating !== null && rating !== undefined && rating !== "") {
            const parsedRating = parseFloat(String(rating));
            if (!isNaN(parsedRating) && parsedRating > 0) {
                query["rating.average"] = { $gte: parsedRating };
            }
        }

        const sortOptions = buildSortOptions(sortBy, sortOrder);
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const parsedLimit = parseInt(String(limit), 10) || 20;
        const limitNum = Math.max(1, Math.min(100, parsedLimit));
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
        if (!query || typeof query !== "string" || !query.trim()) {
            throw new BadRequestError("Query parameter 'q' is required");
        }

        const escaped = escapeRegex(query.trim());
        const suggestions = await this.experienceModel.find({
            status: "active",
            isHidden: { $ne: true },
            $or: [
                { title: { $regex: escaped, $options: "i" } },
                { "location.city": { $regex: escaped, $options: "i" } },
                { "location.state": { $regex: escaped, $options: "i" } },
                { "location.country": { $regex: escaped, $options: "i" } },
                { categories: { $regex: escaped, $options: "i" } },
                { tags: { $regex: escaped, $options: "i" } }
            ]
        })
            .select("title location.city location.state location.country")
            .limit(10)
            .lean();

        return {
            suggestions: suggestions.map((item: any) => ({
                id: item._id ? String(item._id) : undefined,
                text: item.title,
                location: item.location?.city || item.location?.state || item.location?.country || "",
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
            category,
            difficulty,
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = options;

        if (!location || typeof location !== "string" || !location.trim()) {
            throw new BadRequestError("Location parameter is required");
        }

        const locCond = buildExperienceLocationCondition(location);
        const query: any = {
            status: "active",
            isHidden: { $ne: true },
            ...(locCond || {})
        };

        if (normalizeSearchType(type) === "trek") {
            query.categories = { $in: ["Trek", "Trekking", "trek", "trekking"] };
        }

        if (category && typeof category === "string" && category.trim()) {
            query.categories = { $in: expandCategories(category.trim()) };
        }

        if (difficulty && typeof difficulty === "string" && difficulty.trim()) {
            query.difficulty = difficulty.trim();
        }

        const sortOptions = buildSortOptions(sortBy, sortOrder);
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const parsedLimit = parseInt(String(limit), 10) || 20;
        const limitNum = Math.max(1, Math.min(100, parsedLimit));
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
