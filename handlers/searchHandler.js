/**
 * Search Handler
 * HTTP controller layer for search, location discovery, suggestions, and geocoding.
 * Delegates domain querying to SearchService and geospatial resolutions to GeocodingService.
 */

const { searchService } = require("../services/searchService");
const { geocodingService } = require("../services/geocodingService");

/**
 * Universal search across experiences and people
 * GET /api/search
 */
const searchAll = async (req, res) => {
    try {
        const result = await searchService.searchAll(req.query);
        return res.status(200).json({
            success: true,
            message: "Search completed successfully",
            data: result
        });
    } catch (error) {
        console.error("Search API error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to perform search",
            error: error.message
        });
    }
};

/**
 * Multi-criteria advanced search
 * POST /api/search/advanced or GET /api/search/advanced
 */
const advancedSearch = async (req, res) => {
    try {
        const payload = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
        const result = await searchService.advancedSearch(payload);
        return res.status(200).json({
            success: true,
            message: "Advanced search completed successfully",
            data: result
        });
    } catch (error) {
        console.error("Advanced search error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to perform advanced search",
            error: error.message
        });
    }
};

/**
 * Autocomplete search suggestions
 * GET /api/search/suggestions
 */
const getSearchSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== "string" || !q.trim()) {
            return res.status(400).json({
                success: false,
                message: "Query parameter 'q' is required"
            });
        }
        const result = await searchService.getSearchSuggestions(q);
        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Search suggestions error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to get search suggestions",
            error: error.message
        });
    }
};

/**
 * Search experiences by location name
 * GET /api/search/by-location
 */
const searchByLocation = async (req, res) => {
    try {
        const { location } = req.query;
        if (!location || typeof location !== "string" || !location.trim()) {
            return res.status(400).json({
                success: false,
                message: "Location parameter is required"
            });
        }
        const result = await searchService.searchByLocation(req.query);
        return res.status(200).json({
            success: true,
            message: `Found ${result.summary.total} results for location: ${result.location}`,
            data: result
        });
    } catch (error) {
        console.error("Location search error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to search by location",
            error: error.message
        });
    }
};

/**
 * Reverse geocode coordinates to address components
 * GET /api/search/geocode/reverse
 */
const reverseGeocode = async (req, res) => {
    try {
        const { lat, lon } = req.query;
        if (lat === undefined || lon === undefined || lat === "" || lon === "") {
            return res.status(400).json({
                success: false,
                message: "lat and lon are required"
            });
        }

        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
            return res.status(400).json({
                success: false,
                message: "lat must be between -90 and 90, and lon between -180 and 180"
            });
        }

        const result = await geocodingService.reverseGeocode(latNum, lonNum);
        return res.status(200).json(result);
    } catch (error) {
        console.error("Reverse geocode error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Geocoding failed",
            error: error.message
        });
    }
};

/**
 * Forward geocode query to places/coordinates
 * GET /api/search/geocode/search
 */
const geocodeSearch = async (req, res) => {
    try {
        const { q, ...extra } = req.query;
        if (!q || typeof q !== "string" || !q.trim()) {
            return res.status(400).json({
                success: false,
                message: "q is required"
            });
        }
        const result = await geocodingService.geocodeSearch(q, extra);
        return res.status(200).json(result);
    } catch (error) {
        console.error("Geocode search error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Search failed",
            error: error.message
        });
    }
};

module.exports = {
    searchAll,
    advancedSearch,
    getSearchSuggestions,
    searchByLocation,
    reverseGeocode,
    geocodeSearch
};
