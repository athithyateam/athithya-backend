const { parseIfJson } = require("../../utils/postUtils");

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

export function isValidS3MediaUrl(item: any, bucketName: string = process.env.AWS_BUCKET_NAME || ""): boolean {
    const urlStr = typeof item === "string" ? item : item?.url;
    if (!urlStr || typeof urlStr !== "string") return false;
    if (urlStr.startsWith("/")) return true;
    return urlStr.includes("amazonaws.com") && urlStr.includes(bucketName);
}

export function calculatePricingAndFees(priceObj: any): { basePrice: number; feeRate: number; platformFee: number; guestPrice: number; formattedDetails: string } {
    if (!priceObj) {
        return { basePrice: 0, feeRate: 0, platformFee: 0, guestPrice: 0, formattedDetails: "N/A" };
    }
    const basePrice = Number(priceObj.perPerson || priceObj.amount || priceObj.total || 0);
    const feeRate = basePrice < 2000 ? 0.05 : basePrice <= 5000 ? 0.035 : 0.02;
    const platformFee = Math.round(basePrice * feeRate);
    const guestPrice = basePrice + platformFee;

    const formattedDetails = `
        Host Price: ₹${basePrice.toLocaleString()}<br/>
        Platform Fee: ₹${platformFee.toLocaleString()} (${(feeRate * 100).toFixed(1)}%)<br/>
        <strong>Final Guest Price: ₹${guestPrice.toLocaleString()}</strong>
    `;

    return { basePrice, feeRate, platformFee, guestPrice, formattedDetails };
}

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

    // Location processing
    const baseLoc = basePost?.location || {};
    const parsedLoc = parseIfJson(location) || {};
    const locObj = { ...baseLoc, ...parsedLoc };
    if (city !== undefined) locObj.city = city;
    if (state !== undefined) locObj.state = state;
    if (country !== undefined) locObj.country = country;
    if (meetingPoint !== undefined) locObj.meetingPoint = meetingPoint;

    if (locObj.coordinates) {
        if (
            locObj.coordinates.type === 'Point' &&
            Array.isArray(locObj.coordinates.coordinates) &&
            locObj.coordinates.coordinates.length === 2 &&
            locObj.coordinates.coordinates.every((coord: any) => typeof coord === 'number' && !isNaN(coord))
        ) {
            // Valid Point coordinates
        } else {
            delete locObj.coordinates;
        }
    }
    if (Object.keys(locObj).length > 0) fields.location = locObj;

    // Price processing
    const basePrice = basePost?.price || {};
    const parsedPrice = parseIfJson(price) || {};
    const priceObj = { ...basePrice, ...parsedPrice };
    if (priceTotal !== undefined && priceTotal !== "") priceObj.total = Number(priceTotal);
    if (pricePerPerson !== undefined && pricePerPerson !== "") priceObj.perPerson = Number(pricePerPerson);
    if (period !== undefined) priceObj.period = period;
    if (Object.keys(priceObj).length > 0) fields.price = priceObj;

    // Capacity processing
    const baseCap = basePost?.capacity || {};
    const parsedCap = parseIfJson(capacity) || {};
    const capObj = { ...baseCap, ...parsedCap };
    if (maxPeople !== undefined && maxPeople !== "") capObj.maxPeople = Number(maxPeople);
    if (Object.keys(capObj).length > 0) fields.capacity = capObj;

    // Duration processing
    const baseDur = basePost?.duration || {};
    const parsedDur = parseIfJson(duration) || {};
    const durObj = { ...baseDur, ...parsedDur };
    if (payload.minutes !== undefined || minutes !== undefined) durObj.minutes = Number(payload.minutes ?? minutes);
    if (payload.hours !== undefined || hours !== undefined) durObj.hours = Number(payload.hours ?? hours);
    if (days !== undefined && days !== "") durObj.days = Number(days);
    if (nights !== undefined && nights !== "") durObj.nights = Number(nights);
    if (Object.keys(durObj).length > 0) fields.duration = durObj;

    // Array and simple fields
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

module.exports = {
    parsePostPayload,
    calculatePricingAndFees,
    isValidS3MediaUrl
};
