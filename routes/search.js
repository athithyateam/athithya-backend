const express = require("express");
const searchHandler = require("../handlers/searchHandler");

const searchRouter = express.Router();

// SEARCH API - Search across all posts and people
searchRouter.get("/", searchHandler.searchAll);

// ADVANCED SEARCH - More detailed search with multiple filters
searchRouter.post("/advanced", searchHandler.advancedSearch);

// GET SEARCH SUGGESTIONS - Quick autocomplete suggestions
searchRouter.get("/suggestions", searchHandler.getSearchSuggestions);

// GET BY LOCATION - Get all itineraries and experiences by location
searchRouter.get("/by-location", searchHandler.searchByLocation);

// GEODECODING PROXY - Reverse
searchRouter.get("/geocode/reverse", searchHandler.reverseGeocode);

// GEODECODING PROXY - Search
searchRouter.get("/geocode/search", searchHandler.geocodeSearch);

module.exports = searchRouter;
