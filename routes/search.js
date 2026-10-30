const express = require("express");
const searchHandler = require("../handlers/searchHandler");

const searchRouter = express.Router();

// SEARCH API - Search across all experiences and people
searchRouter.get("/", searchHandler.searchAll);

// ADVANCED SEARCH - More detailed search with multiple filters (POST or GET)
searchRouter.post("/advanced", searchHandler.advancedSearch);
searchRouter.get("/advanced", searchHandler.advancedSearch);

// GET SEARCH SUGGESTIONS - Quick autocomplete suggestions
searchRouter.get("/suggestions", searchHandler.getSearchSuggestions);

// GET BY LOCATION - Get all experiences by location
searchRouter.get("/by-location", searchHandler.searchByLocation);

// GEOCODING PROXY - Reverse
searchRouter.get("/geocode/reverse", searchHandler.reverseGeocode);

// GEOCODING PROXY - Search
searchRouter.get("/geocode/search", searchHandler.geocodeSearch);

module.exports = searchRouter;
