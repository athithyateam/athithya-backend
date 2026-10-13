

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

module.exports = {
    parseIfJson,
    calculateDistance,
    toRadians
};
