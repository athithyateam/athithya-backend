

/**
 * Helper to parse JSON fields sent as strings in form-data
 * @param {any} value - The value to parse
 * @returns {any} - The parsed value or the original value
 */
const parseIfJson = (value) => {
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
};


/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 - Latitude of coordinate 1
 * @param {number} lon1 - Longitude of coordinate 1
 * @param {number} lat2 - Latitude of coordinate 2
 * @param {number} lon2 - Longitude of coordinate 2
 * @returns {number} - Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees 
 * @returns {number}
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

const LISTING_CARD_PROJECTION = "title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount savesCount clicks user createdAt approvedAt";

/**
 * Expand special category names such as 'others' or 'other'
 * @param {string|string[]} categories
 * @returns {string[]}
 */
const expandCategories = (categories) => {
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
};

/**
 * Build mongo filter for categories query
 * @param {string|string[]} categories
 * @returns {object|undefined}
 */
const buildCategoryFilter = (categories) => {
    if (!categories) return undefined;
    const expCats = expandCategories(categories);
    const list = Array.isArray(categories) ? categories : String(categories).split(',');
    const isOtherFilter = list.some(c => ['other', 'others'].includes(String(c).trim().toLowerCase()));
    if (isOtherFilter) {
        return { $in: expCats, $nin: ['Safari', 'safari', 'SAFARI'] };
    }
    return { $in: expCats };
};

/**
 * Attach calculated distance to a list of trek documents
 * @param {any[]} treks
 * @param {number} refLat
 * @param {number} refLng
 * @returns {any[]}
 */
const attachDistanceToTreks = (treks, refLat, refLng) => {
    return (treks || []).map(trek => {
        const trekObj = typeof trek.toObject === 'function' ? trek.toObject() : { ...trek };
        if (trek.location?.coordinates?.coordinates) {
            const [trekLng, trekLat] = trek.location.coordinates.coordinates;
            trekObj.distance = Math.round(calculateDistance(refLat, refLng, trekLat, trekLng) * 10) / 10;
            trekObj.distanceUnit = 'km';
        }
        return trekObj;
    });
};

module.exports = {
    parseIfJson,
    calculateDistance,
    toRadians,
    LISTING_CARD_PROJECTION,
    expandCategories,
    buildCategoryFilter,
    attachDistanceToTreks
};
