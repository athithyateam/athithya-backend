/**
 * Post Payload Parser & Common Utilities
 * Reusable parsing, calculation, and filtering utilities for posts and cross-service domain logic.
 */

export interface GetPostsOptions {
    postType?: string;
    userRole?: string;
    city?: string;
    country?: string;
    state?: string;
    minPrice?: number | string;
    maxPrice?: number | string;
    status?: string;
    difficulty?: string;
    categories?: string | string[];
    isFeatured?: boolean | string;
    page?: number | string;
    limit?: number | string;
    sort?: string;
    postTypeFilter?: string | string[];
}

export interface PaginatedPostsResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    posts: any[];
}

export interface PostDetailResult {
    post: any;
    reviews: { count: number; data: any[] };
    similarPosts: any[];
}

export interface GetTopRatedTreksOptions {
    limit?: number | string;
    page?: number | string;
    minRating?: number | string;
}

export interface TopRatedTreksResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    treks: any[];
}

export interface GetNearbyTreksOptions {
    latitude?: string | number;
    longitude?: string | number;
    limit?: number | string;
    page?: number | string;
    difficulty?: string;
    minPrice?: number | string;
    maxPrice?: number | string;
    categories?: string | string[];
}

export interface NearbyTreksResult {
    count: number;
    total: number;
    page: number;
    totalPages: number;
    treks: any[];
}

export interface GetPendingPostsOptions {
    postType?: string;
    page?: number | string;
    limit?: number | string;
}

export interface CategoryActivityResult {
    category: string;
    normalizedCategory: string;
    latestApprovedAt: Date | string;
    count: number;
    isNew: boolean;
}

export interface NormalizedPostFields {
    title?: string;
    subtitle?: string;
    description?: string;
    longDescription?: string;
    location?: any;
    price?: any;
    capacity?: any;
    duration?: any;
    amenities?: any[];
    privacyPolicy?: any[];
    categories?: any[];
    discounts?: any[];
    season?: any;
    difficulty?: string;
    isFeatured?: boolean;
    plan?: any;
    availability?: any;
}

/** Standard projection for listing cards */
export const LISTING_CARD_PROJECTION = "title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount savesCount clicks user createdAt approvedAt";

/** Helper to parse JSON fields sent as strings in form-data */
export function parseIfJson(value: any): any {
    if (!value) return undefined;
    if (typeof value === 'object') return value;
    try {
        if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
            return JSON.parse(value);
        }
    } catch (e) {
        // not JSON, return as-is
    }
    return value;
}

/** Convert degrees to radians */
export function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/** Calculate distance between two coordinates using Haversine formula (in km) */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Expand special category names such as 'others' or 'other' */
export function expandCategories(categories: string | string[]): string[] {
    if (!categories) return [];
    const list = Array.isArray(categories) ? categories : String(categories).split(',');
    return list.flatMap(c => {
        const trimmed = String(c).trim();
        const lc = trimmed.toLowerCase();
        if (lc === 'others' || lc === 'other') {
            return ['Others', 'Other', 'Rock Climbing', 'Flyboarding', 'rock-climbing', 'flyboarding'];
        }
        return [trimmed];
    });
}

/** Build mongo filter for categories query */
export function buildCategoryFilter(categories: any): any {
    if (!categories) return undefined;
    const expCats = expandCategories(categories);
    const list = Array.isArray(categories) ? categories : String(categories).split(',');
    const isOther = list.some((c: any) => ['other', 'others'].includes(String(c).trim().toLowerCase()));
    return isOther ? { $in: expCats, $nin: ['Safari', 'safari', 'SAFARI'] } : { $in: expCats };
}

/** Attach calculated distance to a list of trek documents */
export function attachDistanceToTreks(treks: any[], refLat: number, refLng: number): any[] {
    return (treks || []).map((trek: any) => {
        const trekObj = typeof trek.toObject === 'function' ? trek.toObject() : { ...trek };
        if (trek.location?.coordinates?.coordinates) {
            const [trekLng, trekLat] = trek.location.coordinates.coordinates;
            trekObj.distance = Math.round(calculateDistance(refLat, refLng, trekLat, trekLng) * 10) / 10;
            trekObj.distanceUnit = 'km';
        }
        return trekObj;
    });
}

/** Validate whether media URL belongs to Athithya's S3 bucket */
export function isValidS3MediaUrl(item: any, bucketName: string = process.env.AWS_BUCKET_NAME || ""): boolean {
    const urlStr = typeof item === "string" ? item : item?.url;
    if (!urlStr || typeof urlStr !== "string") return false;
    if (urlStr.startsWith("/")) return true;
    return urlStr.includes("amazonaws.com") && urlStr.includes(bucketName);
}

/** Standard tier-based platform fee calculation (used across posts and bookings) */
export function getPlatformFeeRate(basePrice: number): number {
    return basePrice < 2000 ? 0.05 : basePrice <= 5000 ? 0.035 : 0.02;
}

/** Calculate pricing and platform fee breakdown for experience/trek */
export function calculatePricingAndFees(priceObj: any): { basePrice: number; feeRate: number; platformFee: number; guestPrice: number; formattedDetails: string } {
    if (!priceObj) return { basePrice: 0, feeRate: 0, platformFee: 0, guestPrice: 0, formattedDetails: "N/A" };
    const basePrice = Number(priceObj.perPerson || priceObj.amount || priceObj.total || 0);
    const feeRate = getPlatformFeeRate(basePrice);
    const platformFee = Math.round(basePrice * feeRate);
    const guestPrice = basePrice + platformFee;
    const formattedDetails = `
        Host Price: ₹${basePrice.toLocaleString()}<br/>
        Platform Fee: ₹${platformFee.toLocaleString()} (${(feeRate * 100).toFixed(1)}%)<br/>
        <strong>Final Guest Price: ₹${guestPrice.toLocaleString()}</strong>
    `;
    return { basePrice, feeRate, platformFee, guestPrice, formattedDetails };
}

/** Reusable helper to record rolling audit history for host actions */
export async function recordHostHistory(
    hostHistoryModel: any,
    entry: Record<string, any>,
    filter: Record<string, any> = { type: entry.type },
    maxEntries: number = 10
): Promise<any> {
    try {
        const record = await hostHistoryModel.create(entry);
        const items = await hostHistoryModel.find(filter).sort({ createdAt: -1 });
        if (items.length > maxEntries) {
            const idsToDelete = items.slice(maxEntries).map((item: any) => item._id);
            await hostHistoryModel.deleteMany({ _id: { $in: idsToDelete } });
        }
        return record;
    } catch (err: any) {
        console.error("Error recording host history:", err);
    }
}

/** Parse and normalize post form-data and JSON fields */
export function parsePostPayload(payload: any, basePost: any = null): NormalizedPostFields {
    const {
        title, subtitle, description, longDescription, location,
        price, amenities, capacity, availability,
        planName, priceTotal, pricePerPerson, maxPeople,
        duration, difficulty, categories, isFeatured,
        city, state, country, meetingPoint, days, nights, period, minutes, hours,
        privacyPolicy, discounts, season
    } = payload;

    const fields: NormalizedPostFields = {};
    if (title !== undefined) fields.title = title;
    if (subtitle !== undefined) fields.subtitle = subtitle;
    if (description !== undefined) fields.description = description;
    if (longDescription !== undefined) fields.longDescription = longDescription;

    // Location
    const baseLoc = basePost?.location || {};
    const locObj = { ...baseLoc, ...(parseIfJson(location) || {}) };
    if (city !== undefined) locObj.city = city;
    if (state !== undefined) locObj.state = state;
    if (country !== undefined) locObj.country = country;
    if (meetingPoint !== undefined) locObj.meetingPoint = meetingPoint;
    if (locObj.coordinates) {
        const isPoint = locObj.coordinates.type === 'Point' &&
            Array.isArray(locObj.coordinates.coordinates) &&
            locObj.coordinates.coordinates.length === 2 &&
            locObj.coordinates.coordinates.every((c: any) => typeof c === 'number' && !isNaN(c));
        if (!isPoint) delete locObj.coordinates;
    }
    if (Object.keys(locObj).length > 0) fields.location = locObj;

    // Price
    const basePrice = basePost?.price || {};
    const priceObj = { ...basePrice, ...(parseIfJson(price) || {}) };
    if (priceTotal !== undefined && priceTotal !== "") priceObj.total = Number(priceTotal);
    if (pricePerPerson !== undefined && pricePerPerson !== "") priceObj.perPerson = Number(pricePerPerson);
    if (period !== undefined) priceObj.period = period;
    if (Object.keys(priceObj).length > 0) fields.price = priceObj;

    // Capacity
    const baseCap = basePost?.capacity || {};
    const capObj = { ...baseCap, ...(parseIfJson(capacity) || {}) };
    if (maxPeople !== undefined && maxPeople !== "") capObj.maxPeople = Number(maxPeople);
    if (Object.keys(capObj).length > 0) fields.capacity = capObj;

    // Duration
    const baseDur = basePost?.duration || {};
    const durObj = { ...baseDur, ...(parseIfJson(duration) || {}) };
    if (payload.minutes !== undefined || minutes !== undefined) durObj.minutes = Number(payload.minutes ?? minutes);
    if (payload.hours !== undefined || hours !== undefined) durObj.hours = Number(payload.hours ?? hours);
    if (days !== undefined && days !== "") durObj.days = Number(days);
    if (nights !== undefined && nights !== "") durObj.nights = Number(nights);
    if (Object.keys(durObj).length > 0) fields.duration = durObj;

    if (amenities !== undefined) fields.amenities = parseIfJson(amenities) || [];
    if (privacyPolicy !== undefined) fields.privacyPolicy = parseIfJson(privacyPolicy) || [];
    if (categories !== undefined) fields.categories = parseIfJson(categories) || [];
    if (discounts !== undefined) fields.discounts = parseIfJson(discounts) || [];
    if (season !== undefined) fields.season = parseIfJson(season) || undefined;
    if (difficulty !== undefined) fields.difficulty = difficulty || undefined;
    if (availability !== undefined) fields.availability = parseIfJson(availability);
    if (isFeatured !== undefined) fields.isFeatured = isFeatured === 'true' || isFeatured === true;
    if (planName) fields.plan = { ...(basePost?.plan || {}), name: planName };

    return fields;
}

/** Build standard query filter from GetPostsOptions */
export function buildPostsFilter(options: GetPostsOptions): any {
    const {
        postType, userRole, city, country, state, minPrice, maxPrice, status,
        difficulty, categories, isFeatured, postTypeFilter
    } = options;

    const filter: any = {
        status: status || "active",
        isHidden: { $ne: true }
    };

    if (postType) {
        filter.postType = postType.includes(",") ? { $in: postType.split(",") } : postType;
    } else if (postTypeFilter) {
        filter.postType = Array.isArray(postTypeFilter) ? { $in: postTypeFilter } : postTypeFilter;
    }

    if (userRole) filter.userRole = userRole;
    if (city) filter["location.city"] = new RegExp(city, "i");
    if (state) filter["location.state"] = new RegExp(state, "i");
    if (country) filter["location.country"] = new RegExp(country, "i");
    if (difficulty) filter.difficulty = difficulty;
    if (categories) {
        const catFilter = buildCategoryFilter(categories);
        if (catFilter) filter.categories = catFilter;
    }
    if (isFeatured !== undefined) filter.isFeatured = isFeatured === "true" || isFeatured === true;
    if (minPrice || maxPrice) {
        filter["price.perPerson"] = {};
        if (minPrice) filter["price.perPerson"].$gte = Number(minPrice);
        if (maxPrice) filter["price.perPerson"].$lte = Number(maxPrice);
    }
    return filter;
}

/** Interleave multiple sorted arrays round-robin with unique ID deduplication */
export function roundRobinMerge(sources: any[][], skip: number, limit: number): any[] {
    const seenIds = new Set<string>();
    const merged: any[] = [];
    const maxLen = Math.max(...sources.map(s => s.length), 0);
    for (let i = 0; i < maxLen; i++) {
        for (const list of sources) {
            if (i < list.length) {
                const id = list[i]._id?.toString();
                if (id && !seenIds.has(id)) {
                    seenIds.add(id);
                    merged.push(list[i]);
                }
            }
        }
    }
    return merged.slice(skip, skip + limit);
}

/** Remove assets from S3 that were deleted during an update */
export async function cleanupMediaAssets(storageService: any, oldAssets: any[] = [], newAssets: any[] = []): Promise<void> {
    const newPublicIds = new Set(newAssets.map((a: any) => a.public_id).filter(Boolean));
    for (const asset of oldAssets) {
        if (asset.public_id && !newPublicIds.has(asset.public_id)) {
            await storageService.delete(asset.public_id).catch(() => {});
        }
    }
}

/** Delete media assets from both S3 and Google Drive permanently */
export async function deleteMediaAssets(storageService: any, googleDriveService: any, assets: any[] = []): Promise<void> {
    for (const asset of assets) {
        if (asset.public_id) {
            await storageService.delete(asset.public_id).catch(() => {});
        }
        if (asset.googleDriveFileId) {
            await googleDriveService.deleteMedia(asset.googleDriveFileId).catch(() => {});
        }
    }
}

module.exports = {
    parseIfJson,
    LISTING_CARD_PROJECTION,
    calculateDistance,
    toRadians,
    expandCategories,
    buildCategoryFilter,
    attachDistanceToTreks,
    isValidS3MediaUrl,
    getPlatformFeeRate,
    calculatePricingAndFees,
    recordHostHistory,
    parsePostPayload,
    buildPostsFilter,
    roundRobinMerge,
    cleanupMediaAssets,
    deleteMediaAssets
};
