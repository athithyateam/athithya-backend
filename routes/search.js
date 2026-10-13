const express = require("express");
const { Post, User } = require("../db/mongoose");
const searchRouter = express.Router();

const escapeRegex = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// SEARCH API - Search across all posts and people
searchRouter.get("/", async (req, res) => {
    try {
        const {
            q, // search query
            type = "all", // all, itinerary, experience, trek, service, people
            location, // city or country filter
            city, // optional city alias
            difficulty, // difficulty level for treks
            category, // category filter
            minPrice,
            maxPrice,
            sortBy = "createdAt", // createdAt, rating, price
            sortOrder = "desc", // desc, asc
            page = 1,
            limit = 20
        } = req.query;

        const effectiveLocation = (location || city || "").trim();

        let postResults = [];
        let userResults = [];
        let totalPostCount = 0;
        let totalUserCount = 0;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Normalize search type aliases
        let searchType = (type || "all").toLowerCase().trim();
        if (searchType === "experiences" || searchType === "experience") searchType = "experience";
        else if (searchType === "hosts" || searchType === "host") searchType = "host";
        else if (searchType === "guests" || searchType === "guest") searchType = "guest";
        else if (searchType === "people") searchType = "people";

        // --- 1. SEARCH POSTS ---
        if (searchType === "all" || ["itinerary", "experience", "trek", "service"].includes(searchType)) {
            let postQuery = { status: "active" };

            if (searchType === "itinerary") postQuery.postType = "plan";
            else if (searchType === "experience") postQuery.postType = { $in: ["experience", "plan", "trek", "service"] };
            else if (searchType === "trek") postQuery.postType = "trek";
            else if (searchType === "service") postQuery.postType = "service";
            else if (searchType === "all") postQuery.postType = { $in: ["plan", "experience", "trek", "service"] };

            const andConditions = [];

            if (q && q.trim()) {
                const escapedQ = escapeRegex(q);
                andConditions.push({
                    $or: [
                        { title: { $regex: escapedQ, $options: "i" } },
                        { subtitle: { $regex: escapedQ, $options: "i" } },
                        { description: { $regex: escapedQ, $options: "i" } },
                        { "location.city": { $regex: escapedQ, $options: "i" } },
                        { "location.state": { $regex: escapedQ, $options: "i" } },
                        { "location.country": { $regex: escapedQ, $options: "i" } },
                        { "location.address": { $regex: escapedQ, $options: "i" } },
                        { categories: { $regex: escapedQ, $options: "i" } }
                    ]
                });
            }

            if (effectiveLocation) {
                const escapedLocation = escapeRegex(effectiveLocation);
                andConditions.push({
                    $or: [
                        { "location.city": { $regex: escapedLocation, $options: "i" } },
                        { "location.state": { $regex: escapedLocation, $options: "i" } },
                        { "location.country": { $regex: escapedLocation, $options: "i" } }
                    ]
                });
            }

            if (andConditions.length > 0) {
                postQuery.$and = andConditions;
            }

            if (difficulty) postQuery.difficulty = difficulty;
            if (category) {
                const lc = String(category).trim().toLowerCase();
                if (lc === "others" || lc === "other") {
                    postQuery.categories = { $in: ["Others", "Other", "Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding"] };
                } else {
                    postQuery.categories = { $in: [category] };
                }
            }

            if (minPrice || maxPrice) {
                postQuery["price.perPerson"] = {};
                if (minPrice) postQuery["price.perPerson"].$gte = parseFloat(minPrice);
                if (maxPrice) postQuery["price.perPerson"].$lte = parseFloat(maxPrice);
            }

            let sortOptions = {};
            if (sortBy === "rating") sortOptions["rating.average"] = sortOrder === "asc" ? 1 : -1;
            else if (sortBy === "price") sortOptions["price.perPerson"] = sortOrder === "asc" ? 1 : -1;
            else sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

            postResults = await Post.find(postQuery)
                .select("title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount clicks user createdAt")
                .populate("user", "firstname lastname email avatar role hostStatus verifyBadge")
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNum)
                .lean();

            totalPostCount = await Post.countDocuments(postQuery);

            postResults = postResults.map(item => ({ ...item, rating: item.rating?.average || 0 }));
        }

        // --- 2. SEARCH PEOPLE ---
        if (searchType === "all" || searchType === "people" || searchType === "host" || searchType === "guest") {
            let userQuery = {};

            if (searchType === "host") userQuery.role = "host";
            if (searchType === "guest") userQuery.role = { $in: ["guest", "user"] };

            const userAndConditions = [];

            if (q && q.trim()) {
                const escapedQ = escapeRegex(q);
                userAndConditions.push({
                    $or: [
                        { firstname: { $regex: escapedQ, $options: "i" } },
                        { lastname: { $regex: escapedQ, $options: "i" } },
                        { email: { $regex: escapedQ, $options: "i" } },
                        { "location.city": { $regex: escapedQ, $options: "i" } },
                        { "location.state": { $regex: escapedQ, $options: "i" } },
                        { "location.country": { $regex: escapedQ, $options: "i" } },
                        { "location.address": { $regex: escapedQ, $options: "i" } },
                        { bio: { $regex: escapedQ, $options: "i" } },
                        { description: { $regex: escapedQ, $options: "i" } }
                    ]
                });
            }

            if (effectiveLocation) {
                const escapedLocation = escapeRegex(effectiveLocation);
                userAndConditions.push({
                    $or: [
                        { "location.city": { $regex: escapedLocation, $options: "i" } },
                        { "location.state": { $regex: escapedLocation, $options: "i" } },
                        { "location.country": { $regex: escapedLocation, $options: "i" } }
                    ]
                });
            }

            if (userAndConditions.length > 0) {
                userQuery.$and = userAndConditions;
            }

            userResults = await User.find(userQuery)
                .select("firstname lastname email avatar role location description bio")
                .limit(searchType === "all" ? 5 : limitNum)
                .skip(searchType === "all" ? 0 : skip)
                .lean();

            totalUserCount = await User.countDocuments(userQuery);
        }

        const totalResults = totalPostCount + totalUserCount;
        const totalPages = Math.ceil(((searchType === 'people' || searchType === 'host' || searchType === 'guest') ? totalUserCount : totalPostCount) / limitNum);

        const combinedResults = (searchType === 'people' || searchType === 'host' || searchType === 'guest')
            ? userResults
            : (searchType === 'all' ? [...postResults, ...userResults.map(u => ({ ...u, postType: 'user' }))] : postResults);

        res.status(200).json({
            success: true,
            message: "Search completed successfully",
            data: {
                results: combinedResults,
                people: userResults,
                posts: postResults,
                pagination: {
                    currentPage: pageNum,
                    totalPages,
                    totalResults,
                    resultsPerPage: limitNum,
                },
                filters: {
                    query: q || null,
                    type: searchType,
                    location: location || null
                }
            }
        });

    } catch (error) {
        console.error("Search API error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to perform search",
            error: error.message
        });
    }
});

// ADVANCED SEARCH - More detailed search with multiple filters
// POST /api/search/advanced
searchRouter.post("/advanced", async (req, res) => {
    try {
        const {
            searchText,
            postTypes = ["plan", "experience"], // array of types
            locations = [], // array of cities/countries
            difficulties = [], // array of difficulty levels
            categories = [], // array of categories
            priceRange = {},
            durationRange = {}, // for itineraries
            amenities = [], // array of amenities
            rating = null, // minimum rating
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = req.body;

        // Build query
        let query = { status: "active" };

        // Filter by post types
        if (postTypes && postTypes.length > 0) {
            query.postType = { $in: postTypes };
        }

        // Text search
        if (searchText && searchText.trim()) {
            query.$text = { $search: searchText };
        }

        // Location filter
        if (locations && locations.length > 0) {
            query.$or = [
                { "location.city": { $in: locations.map(l => new RegExp(l, "i")) } },
                { "location.country": { $in: locations.map(l => new RegExp(l, "i")) } }
            ];
        }

        // Difficulty filter
        if (difficulties && difficulties.length > 0) {
            query.difficulty = { $in: difficulties };
        }

        // Categories filter
        if (categories && categories.length > 0) {
            const expanded = categories.flatMap(c => {
                const lc = String(c).trim().toLowerCase();
                if (lc === "others" || lc === "other") {
                    return ["Others", "Other", "Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding"];
                }
                return [c];
            });
            query.categories = { $in: expanded };
        }

        // Price range
        if (priceRange.min !== undefined || priceRange.max !== undefined) {
            query["price.perPerson"] = {};
            if (priceRange.min !== undefined) {
                query["price.perPerson"].$gte = priceRange.min;
            }
            if (priceRange.max !== undefined) {
                query["price.perPerson"].$lte = priceRange.max;
            }
        }

        // Duration range (for itineraries)
        if (durationRange.minDays !== undefined || durationRange.maxDays !== undefined) {
            query["duration.days"] = {};
            if (durationRange.minDays !== undefined) {
                query["duration.days"].$gte = durationRange.minDays;
            }
            if (durationRange.maxDays !== undefined) {
                query["duration.days"].$lte = durationRange.maxDays;
            }
        }

        // Amenities filter
        if (amenities && amenities.length > 0) {
            query.amenities = { $all: amenities };
        }

        // Minimum rating filter
        if (rating !== null && rating !== undefined) {
            query["rating.average"] = { $gte: parseFloat(rating) };
        }

        // Sorting
        let sortOptions = {};
        if (sortBy === "rating") {
            sortOptions["rating.average"] = sortOrder === "asc" ? 1 : -1;
        } else if (sortBy === "price") {
            sortOptions["price.perPerson"] = sortOrder === "asc" ? 1 : -1;
        } else {
            sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;
        }

        // Pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Execute query
        const [results, totalCount] = await Promise.all([
            Post.find(query)
                .select("title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount clicks user createdAt")
                .populate("user", "firstname lastname email avatar role hostStatus verifyBadge")
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Post.countDocuments(query)
        ]);

        // Calculate pagination
        const totalPages = Math.ceil(totalCount / limitNum);

        res.status(200).json({
            success: true,
            message: "Advanced search completed successfully",
            data: {
                results,
                pagination: {
                    currentPage: pageNum,
                    totalPages,
                    totalResults: totalCount,
                    resultsPerPage: limitNum,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            }
        });

    } catch (error) {
        console.error("Advanced search error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to perform advanced search",
            error: error.message
        });
    }
});

// GET SEARCH SUGGESTIONS - Quick autocomplete suggestions
// GET /api/search/suggestions?q=query
searchRouter.get("/suggestions", async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || !q.trim()) {
            return res.status(400).json({
                success: false,
                message: "Query parameter 'q' is required"
            });
        }

        const escapedQ = escapeRegex(q);

        // Get title suggestions
        const suggestions = await Post.find({
            status: "active",
            postType: { $in: ["plan", "experience"] },
            $or: [
                { title: { $regex: escapedQ, $options: "i" } },
                { "location.city": { $regex: escapedQ, $options: "i" } }
            ]
        })
            .select("title location.city postType")
            .limit(10)
            .lean();

        // Format suggestions
        const formatted = suggestions.map(item => ({
            text: item.title,
            location: item.location?.city || "",
            type: item.postType === "plan" ? "itinerary" : "experience"
        }));

        res.status(200).json({
            success: true,
            data: {
                suggestions: formatted
            }
        });

    } catch (error) {
        console.error("Search suggestions error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get search suggestions",
            error: error.message
        });
    }
});

// GET BY LOCATION - Get all itineraries and experiences by location
// GET /api/search/by-location?location=city&type=all&sortBy=createdAt&page=1&limit=20
searchRouter.get("/by-location", async (req, res) => {
    try {
        const {
            location,
            type = "all", // all, itinerary, experience
            sortBy = "createdAt",
            sortOrder = "desc",
            page = 1,
            limit = 20
        } = req.query;

        // Validate location parameter
        if (!location || !location.trim()) {
            return res.status(400).json({
                success: false,
                message: "Location parameter is required"
            });
        }

        const escapedLocation = escapeRegex(location);

        // Build query
        let query = {
            status: "active",
            $or: [
                { "location.city": { $regex: escapedLocation, $options: "i" } },
                { "location.state": { $regex: escapedLocation, $options: "i" } },
                { "location.country": { $regex: escapedLocation, $options: "i" } }
            ]
        };

        // Filter by type
        if (type === "itinerary") {
            query.postType = "plan";
        } else if (type === "experience") {
            query.postType = "experience";
        } else if (type === "all") {
            query.postType = { $in: ["plan", "experience"] };
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid type parameter. Must be 'all', 'itinerary', or 'experience'"
            });
        }

        // Sorting
        let sortOptions = {};
        if (sortBy === "rating") {
            sortOptions["rating.average"] = sortOrder === "asc" ? 1 : -1;
        } else if (sortBy === "price") {
            sortOptions["price.perPerson"] = sortOrder === "asc" ? 1 : -1;
        } else {
            sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;
        }

        // Pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Execute query
        const [results, totalCount] = await Promise.all([
            Post.find(query)
                .select("title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount clicks user createdAt")
                .populate("user", "firstname lastname email avatar role hostStatus verifyBadge")
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Post.countDocuments(query)
        ]);

        // Group results by type for better organization
        const itineraries = results.filter(item => item.postType === "plan");
        const experiences = results.filter(item => item.postType === "experience");

        // Calculate pagination
        const totalPages = Math.ceil(totalCount / limitNum);

        res.status(200).json({
            success: true,
            message: `Found ${totalCount} results for location: ${location}`,
            data: {
                location: location,
                summary: {
                    total: totalCount,
                    itineraries: itineraries.length,
                    experiences: experiences.length
                },
                results: {
                    all: results,
                    itineraries: itineraries,
                    experiences: experiences
                },
                pagination: {
                    currentPage: pageNum,
                    totalPages,
                    totalResults: totalCount,
                    resultsPerPage: limitNum,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            }
        });

    } catch (error) {
        console.error("Location search error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to search by location",
            error: error.message
        });
    }
});

// GEODECODING PROXY - Proxy Nominatim/Google requests to avoid CORS/User-Agent issues and increase accuracy
searchRouter.get("/geocode/reverse", async (req, res) => {
    try {
        const { lat, lon } = req.query;
        if (!lat || !lon) return res.status(400).json({ success: false, message: "lat and lon are required" });

        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (apiKey) {
            try {
                const axios = require('axios');
                const googleResponse = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
                    params: {
                        latlng: `${lat},${lon}`,
                        key: apiKey
                    }
                });

                if (googleResponse.data.status === 'OK' && googleResponse.data.results.length > 0) {
                    const result = googleResponse.data.results[0];
                    const addressComponents = result.address_components;

                    const getComponent = (types) => {
                        const comp = addressComponents.find(c => types.some(t => c.types.includes(t)));
                        return comp ? comp.long_name : '';
                    };

                    const countryCodeComp = addressComponents.find(c => c.types.includes('country'));
                    const country_code = countryCodeComp ? countryCodeComp.short_name.toLowerCase() : '';

                    const state = getComponent(['administrative_area_level_1']);
                    const county = getComponent(['administrative_area_level_2']);
                    const city = getComponent(['locality']) || getComponent(['postal_town']);
                    const town = getComponent(['sublocality_level_1']) || getComponent(['neighborhood']);
                    const village = getComponent(['sublocality_level_2']) || getComponent(['sublocality_level_3']);
                    const country = getComponent(['country']);
                    const postcode = getComponent(['postal_code']);

                    const addr = {
                        state,
                        county,
                        district: county,
                        city: city || town || village,
                        town: town || city || village,
                        village: village || town || city,
                        country,
                        country_code,
                        postcode
                    };

                    // Filter out empty strings
                    Object.keys(addr).forEach(key => {
                        if (!addr[key]) delete addr[key];
                    });

                    const responseData = {
                        place_id: result.place_id,
                        lat: result.geometry.location.lat.toString(),
                        lon: result.geometry.location.lng.toString(),
                        display_name: result.formatted_address,
                        address: addr
                    };

                    return res.json(responseData);
                }
            } catch (err) {
                console.error("Google Geocode reverse error, falling back to Nominatim:", err.message);
            }
        }

        const axios = require('axios');
        const response = await axios.get(`https://nominatim.openstreetmap.org/reverse`, {
            params: { format: 'json', lat, lon },
            headers: { 'User-Agent': 'AthithyaApp/1.0 (athithya.in)' }
        });

        res.json(response.data);
    } catch (error) {
        console.error("Reverse geocode error:", error.message);
        res.status(500).json({ success: false, message: "Geocoding failed" });
    }
});

searchRouter.get("/geocode/search", async (req, res) => {
    try {
        const { q, ...extra } = req.query;
        if (!q) return res.status(400).json({ success: false, message: "q is required" });

        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (apiKey) {
            try {
                const axios = require('axios');
                const params = {
                    address: q,
                    key: apiKey
                };

                // Parse viewbox (from Nominatim format min_lon,max_lat,max_lon,min_lat to Google bounds)
                if (req.query.viewbox) {
                    const [min_lon, max_lat, max_lon, min_lat] = req.query.viewbox.split(',').map(Number);
                    if (!isNaN(min_lon) && !isNaN(max_lat) && !isNaN(max_lon) && !isNaN(min_lat)) {
                        params.bounds = `${min_lat},${min_lon}|${max_lat},${max_lon}`;
                    }
                }

                // Limit query specifically to India
                params.components = 'country:IN';

                const googleResponse = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, { params });

                if (googleResponse.data.status === 'OK' && googleResponse.data.results.length > 0) {
                    const results = googleResponse.data.results.map(result => {
                        const addressComponents = result.address_components;

                        const getComponent = (types) => {
                            const comp = addressComponents.find(c => types.some(t => c.types.includes(t)));
                            return comp ? comp.long_name : '';
                        };

                        const countryCodeComp = addressComponents.find(c => c.types.includes('country'));
                        const country_code = countryCodeComp ? countryCodeComp.short_name.toLowerCase() : '';

                        const state = getComponent(['administrative_area_level_1']);
                        const county = getComponent(['administrative_area_level_2']);
                        const city = getComponent(['locality']) || getComponent(['postal_town']);
                        const town = getComponent(['sublocality_level_1']) || getComponent(['neighborhood']);
                        const village = getComponent(['sublocality_level_2']) || getComponent(['sublocality_level_3']);
                        const country = getComponent(['country']);
                        const postcode = getComponent(['postal_code']);

                        const nameComponent = addressComponents[0] ? addressComponents[0].long_name : q;

                        const addr = {
                            state,
                            county,
                            district: county,
                            city: city || town || village,
                            town: town || city || village,
                            village: village || town || city,
                            country,
                            country_code,
                            postcode
                        };

                        Object.keys(addr).forEach(key => {
                            if (!addr[key]) delete addr[key];
                        });

                        return {
                            place_id: result.place_id,
                            lat: result.geometry.location.lat.toString(),
                            lon: result.geometry.location.lng.toString(),
                            display_name: result.formatted_address,
                            name: nameComponent,
                            address: addr
                        };
                    });

                    return res.json(results);
                }
            } catch (err) {
                console.error("Google Geocode search error, falling back to Nominatim:", err.message);
            }
        }

        const axios = require('axios');
        const response = await axios.get(`https://nominatim.openstreetmap.org/search`, {
            params: { format: 'json', q, ...extra },
            headers: { 'User-Agent': 'AthithyaApp/1.0 (athithya.in)' }
        });

        res.json(response.data);
    } catch (error) {
        console.error("Geocode search error:", error.message);
        res.status(500).json({ success: false, message: "Search failed" });
    }
});

module.exports = searchRouter;
