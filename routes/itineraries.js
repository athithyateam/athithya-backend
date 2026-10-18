const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const itineraryHandler = require("../handlers/itineraryHandler");

const itineraryRouter = express.Router();

// CREATE ITINERARY/PLAN
itineraryRouter.post("/", checkAuth, itineraryHandler.createItinerary);

// GET ALL ITINERARIES - Public (with filtering)
itineraryRouter.get("/", itineraryHandler.getItineraries);

// GET ITINERARIES/PLANS AND EXPERIENCES BY LOCATION
itineraryRouter.get("/location/combined", itineraryHandler.getCombinedLocationData);

// GET COMPLETE ITINERARIES/PLANS FOR EXPLORE PAGE
itineraryRouter.get("/explore/complete", itineraryHandler.getExploreComplete);

// GET USER'S ITINERARIES
itineraryRouter.get("/user/:userId", itineraryHandler.getUserItineraries);

// GET MY ITINERARIES
itineraryRouter.get("/my/itineraries", checkAuth, itineraryHandler.getMyItineraries);

// GET SINGLE ITINERARY BY ID
itineraryRouter.get("/:id", itineraryHandler.getItineraryById);

// UPDATE ITINERARY
itineraryRouter.put("/:id", checkAuth, itineraryHandler.updateItinerary);

// DELETE ITINERARY
itineraryRouter.delete("/:id", checkAuth, itineraryHandler.deleteItinerary);

// SAVE / BOOKMARK ITINERARY
itineraryRouter.post("/:id/save", checkAuth, itineraryHandler.saveItinerary);

// UNSAVE / UNBOOKMARK ITINERARY
itineraryRouter.delete("/:id/save", checkAuth, itineraryHandler.unsaveItinerary);

// TOGGLE REACTION ON ITINERARY
itineraryRouter.put("/:id/react", checkAuth, itineraryHandler.reactToItinerary);

// GET REACTION STATISTICS FOR AN ITINERARY
itineraryRouter.get("/:id/reactions", itineraryHandler.getItineraryReactions);

module.exports = itineraryRouter;
