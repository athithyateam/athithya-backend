const { Post, User, Itinerary } = require("../db/mongoose");
const { deleteFile } = require("../services/storageService");

// helper to parse JSON fields sent as strings in form-data
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

// CREATE ITINERARY/PLAN
const createItinerary = async (req, res) => {
    try {
        // Ensure req.body exists and has required fields
        const title = req.body?.title;
        const subtitle = req.body?.subtitle;
        const description = req.body?.description;
        const location = req.body?.location;
        const price = req.body?.price;
        const capacity = req.body?.capacity;
        const planName = req.body?.planName;
        const priceTotal = req.body?.priceTotal;
        const pricePerPerson = req.body?.pricePerPerson;
        const maxPeople = req.body?.maxPeople;
        const duration = req.body?.duration;
        const difficulty = req.body?.difficulty;
        const categories = req.body?.categories;
        const tags = req.body?.tags;
        const amenities = req.body?.amenities;
        const availability = req.body?.availability;

        const parsedLocation = parseIfJson(location);
        const parsedDuration = parseIfJson(duration);
        const parsedPrice = parseIfJson(price);
        const parsedCapacity = parseIfJson(capacity);
        const parsedTags = parseIfJson(tags);
        const parsedAmenities = parseIfJson(amenities);
        const parsedAvailability = parseIfJson(availability);

        // Validation
        if (!title || !description) {
            return res.status(400).json({
                success: false,
                message: "Title and description are required"
            });
        }

        // Photos and videos come as JSON arrays of S3 objects from the frontend
        let photoUrls = [];
        let videoUrls = [];
        if (req.body.photos) {
            photoUrls = Array.isArray(req.body.photos) ? req.body.photos : (JSON.parse(req.body.photos) || []);
        }
        if (req.body.videos) {
            videoUrls = Array.isArray(req.body.videos) ? req.body.videos : (JSON.parse(req.body.videos) || []);
        }

        // Build price and capacity objects
        const priceObj = {};
        if (parsedPrice?.perPerson) priceObj.perPerson = Number(parsedPrice.perPerson);
        else if (pricePerPerson) priceObj.perPerson = Number(pricePerPerson);
        if (priceTotal) priceObj.total = Number(priceTotal);

        const capacityObj = {};
        if (parsedCapacity?.maxPeople) capacityObj.maxPeople = Number(parsedCapacity.maxPeople);
        else if (maxPeople) capacityObj.maxPeople = Number(maxPeople);

        const itinerary = await Post.create({
            user: req.user.userId,
            userRole: req.user.role,
            postType: 'plan',
            title,
            subtitle,
            description,
            location: parsedLocation || {},
            plan: planName ? { name: planName } : undefined,
            price: priceObj,
            capacity: capacityObj,
            tags: parsedTags || [],
            amenities: parsedAmenities || [],
            availability: parsedAvailability || {},
            duration: parsedDuration || undefined,
            difficulty: difficulty || undefined,
            categories: parseIfJson(categories) || [],
            photos: photoUrls,
            videos: videoUrls
        });

        return res.status(201).json({
            success: true,
            message: "Itinerary created successfully",
            itinerary
        });
    } catch (error) {
        console.error("Create itinerary error:", error);
        return res.status(500).json({
            success: false,
            message: "Error creating itinerary",
            error: error.message
        });
    }
};

// GET ALL ITINERARIES - Public (with filtering)
const getItineraries = async (req, res) => {
    try {
        const {
            city, country, state,
            minPrice, maxPrice, tags,
            difficulty, categories,
            page = 1, limit = 20
        } = req.query;

        // Build filter query - only for plan postType
        const filter = { postType: 'plan', status: 'active' };

        if (city) filter['location.city'] = new RegExp(city, 'i');
        if (state) filter['location.state'] = new RegExp(state, 'i');
        if (country) filter['location.country'] = new RegExp(country, 'i');
        if (tags) filter.tags = { $in: tags.split(',') };

        if (difficulty) filter.difficulty = difficulty;
        if (categories) filter.categories = { $in: categories.split(',') };

        // Price range filter
        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const skip = (Number(page) - 1) * Number(limit);

        const itineraries = await Post.find(filter)
            .populate('user', 'firstname lastname email role avatar')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);

        const total = await Post.countDocuments(filter);

        return res.status(200).json({
            success: true,
            count: itineraries.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            itineraries
        });
    } catch (error) {
        console.error("Get itineraries error:", error);
        return res.status(500).json({ success: false, message: "Error fetching itineraries" });
    }
};

// GET SINGLE ITINERARY BY ID - Public
const getItineraryById = async (req, res) => {
    try {
        const itinerary = await Post.findById(req.params.id)
            .populate('user', 'firstname lastname email role avatar');

        if (!itinerary) {
            return res.status(404).json({ success: false, message: "Itinerary not found" });
        }

        if (itinerary.postType !== 'plan') {
            return res.status(400).json({ success: false, message: "This is not an itinerary" });
        }

        return res.status(200).json({ success: true, itinerary });
    } catch (error) {
        console.error("Get itinerary error:", error);
        return res.status(500).json({ success: false, message: "Error fetching itinerary" });
    }
};

// GET USER'S ITINERARIES - Public (view anyone's itineraries)
const getUserItineraries = async (req, res) => {
    try {
        const itineraries = await Post.find({
            user: req.params.userId,
            postType: 'plan'
        })
            .populate('user', 'firstname lastname email role avatar')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: itineraries.length,
            itineraries
        });
    } catch (error) {
        console.error("Get user itineraries error:", error);
        return res.status(500).json({ success: false, message: "Error fetching user itineraries" });
    }
};

// GET MY ITINERARIES - Authenticated user's own itineraries
const getMyItineraries = async (req, res) => {
    try {
        const itineraries = await Post.find({
            user: req.user.userId,
            postType: 'plan'
        })
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: itineraries.length,
            itineraries
        });
    } catch (error) {
        console.error("Get my itineraries error:", error);
        return res.status(500).json({ success: false, message: "Error fetching your itineraries" });
    }
};

// UPDATE ITINERARY - Only itinerary owner
const updateItinerary = async (req, res) => {
    try {
        const itinerary = await Post.findById(req.params.id);

        if (!itinerary) {
            return res.status(404).json({ success: false, message: "Itinerary not found" });
        }

        if (itinerary.postType !== 'plan') {
            return res.status(400).json({ success: false, message: "This is not an itinerary" });
        }

        // Check if user is the owner
        if (itinerary.user.toString() !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: "You can only edit your own itineraries"
            });
        }

        const {
            title, subtitle, description, location,
            planName, priceTotal, pricePerPerson, maxPeople,
            duration, difficulty, tags, status, categories, availability,
            existingPhotos: existingPhotosStr,
            existingVideos: existingVideosStr
        } = req.body;

        const parsedLocation = parseIfJson(location);
        const parsedDuration = parseIfJson(duration);
        const parsedTags = parseIfJson(tags);
        const parsedCategories = parseIfJson(categories);
        const parsedAvailability = parseIfJson(availability);
        const existingPhotos = parseIfJson(existingPhotosStr) || [];
        const existingVideos = parseIfJson(existingVideosStr) || [];

        // Cloudinary/S3 cleanup for removed photos
        const currentPhotoIds = existingPhotos.map(p => p.public_id).filter(id => id);
        for (const photo of (itinerary.photos || [])) {
            if (photo.public_id && !currentPhotoIds.includes(photo.public_id)) {
                await deleteFile(photo.public_id);
            }
        }

        // Cleanup for removed videos
        const currentVideoIds = existingVideos.map(v => v.public_id).filter(id => id);
        for (const video of (itinerary.videos || [])) {
            if (video.public_id && !currentVideoIds.includes(video.public_id)) {
                await deleteFile(video.public_id);
            }
        }

        // New photos/videos come as JSON arrays of S3 objects from the frontend
        let newPhotos = [];
        let newVideos = [];
        if (req.body.photos) {
            const allPhotos = Array.isArray(req.body.photos) ? req.body.photos : (JSON.parse(req.body.photos || '[]') || []);
            newPhotos = allPhotos.filter(p => !existingPhotos.find(e => e.public_id === p.public_id));
        }
        if (req.body.videos) {
            const allVideos = Array.isArray(req.body.videos) ? req.body.videos : (JSON.parse(req.body.videos || '[]') || []);
            newVideos = allVideos.filter(v => !existingVideos.find(e => e.public_id === v.public_id));
        }

        // Update fields
        if (title) itinerary.title = title;
        if (subtitle) itinerary.subtitle = subtitle;
        if (description) itinerary.description = description;

        itinerary.photos = [...existingPhotos, ...newPhotos];
        itinerary.videos = [...existingVideos, ...newVideos];

        if (parsedLocation) itinerary.location = { ...itinerary.location, ...parsedLocation };

        // update price
        if (priceTotal || pricePerPerson) {
            itinerary.price = { ...itinerary.price };
            if (priceTotal) itinerary.price.total = Number(priceTotal);
            if (pricePerPerson) itinerary.price.perPerson = Number(pricePerPerson);
        }

        // update capacity
        if (maxPeople) {
            itinerary.capacity = { ...itinerary.capacity };
            itinerary.capacity.maxPeople = Number(maxPeople);
        }

        // update plan name
        if (planName) {
            itinerary.plan = { ...(itinerary.plan || {}), name: planName };
        }

        if (parsedTags) itinerary.tags = parsedTags;
        if (parsedCategories) itinerary.categories = parsedCategories;
        if (parsedAvailability) itinerary.availability = parsedAvailability;
        if (status) itinerary.status = status;

        // Update itinerary-specific fields
        if (parsedDuration) itinerary.duration = parsedDuration;
        if (difficulty) itinerary.difficulty = difficulty;

        await itinerary.save();

        return res.status(200).json({
            success: true,
            message: "Itinerary updated successfully",
            itinerary
        });
    } catch (error) {
        console.error("Update itinerary error:", error);
        return res.status(500).json({ success: false, message: "Error updating itinerary", error: error.message });
    }
};

// DELETE ITINERARY - Only itinerary owner
const deleteItinerary = async (req, res) => {
    try {
        const itinerary = await Post.findById(req.params.id);

        if (!itinerary) {
            return res.status(404).json({ success: false, message: "Itinerary not found" });
        }

        if (itinerary.postType !== 'plan') {
            return res.status(400).json({ success: false, message: "This is not an itinerary" });
        }

        // Check if user is the owner
        if (itinerary.user.toString() !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: "You can only delete your own itineraries"
            });
        }

        if (req.user.role !== 'admin') {
            itinerary.deleteRequested = true;
            await itinerary.save();
            return res.status(200).json({
                success: true,
                message: "Deletion request submitted for review",
                pendingReview: true
            });
        }

        await Post.findByIdAndDelete(req.params.id);

        return res.status(200).json({
            success: true,
            message: "Itinerary deleted successfully"
        });
    } catch (error) {
        console.error("Delete itinerary error:", error);
        return res.status(500).json({ success: false, message: "Error deleting itinerary" });
    }
};

// SAVE / BOOKMARK ITINERARY
const saveItinerary = async (req, res) => {
    try {
        const userId = req.user.userId;
        const itineraryId = req.params.id;

        if (req.user.role === 'host') {
            return res.status(400).json({ success: false, message: "You can't save another host experience, if you are already a host" });
        }

        const itinerary = await (Itinerary || Post).findById(itineraryId);
        if (!itinerary) return res.status(404).json({ success: false, message: "Itinerary not found" });

        await User.findByIdAndUpdate(userId, { $addToSet: { savedPosts: itineraryId } });

        return res.status(200).json({ success: true, message: "Itinerary saved successfully" });
    } catch (err) {
        console.error("Save itinerary error:", err);
        return res.status(500).json({ success: false, message: "Error saving itinerary" });
    }
};

// UNSAVE / UNBOOKMARK ITINERARY
const unsaveItinerary = async (req, res) => {
    try {
        const userId = req.user.userId;
        const itineraryId = req.params.id;

        await User.findByIdAndUpdate(userId, { $pull: { savedPosts: itineraryId } });

        return res.status(200).json({ success: true, message: "Itinerary removed from saved list" });
    } catch (err) {
        console.error("Unsave itinerary error:", err);
        return res.status(500).json({ success: false, message: "Error unsaving itinerary" });
    }
};

// TOGGLE REACTION ON ITINERARY - Authenticated users
const reactToItinerary = async (req, res) => {
    try {
        const { emoji } = req.body;

        // Validate emoji input
        if (!emoji || typeof emoji !== 'string') {
            return res.status(400).json({
                success: false,
                message: "Valid emoji is required"
            });
        }

        const itinerary = await Post.findById(req.params.id);

        if (!itinerary) {
            return res.status(404).json({ success: false, message: "Itinerary not found" });
        }

        if (itinerary.postType !== 'plan') {
            return res.status(400).json({ success: false, message: "This is not an itinerary" });
        }

        const userId = req.user.userId;

        // Fetch user to get accurate name
        const user = await User.findById(userId);
        const userName = user ? `${user.firstname} ${user.lastname}` : "User";

        // Ensure reactions array exists
        if (!itinerary.reactions) itinerary.reactions = [];

        const existingIndex = itinerary.reactions.findIndex(r => r.user.toString() === userId);

        let action = '';
        if (existingIndex > -1) {
            // Check if same emoji
            if (itinerary.reactions[existingIndex].emoji === emoji) {
                // Remove - user clicked the same emoji to unreact
                itinerary.reactions.splice(existingIndex, 1);
                action = 'removed';
            } else {
                // Update - user changed to a different emoji
                itinerary.reactions[existingIndex].emoji = emoji;
                itinerary.reactions[existingIndex].name = userName;
                itinerary.reactions[existingIndex].timestamp = Date.now();
                action = 'updated';
            }
        } else {
            // Add - new reaction
            itinerary.reactions.push({
                user: userId,
                name: userName,
                emoji
            });
            action = 'added';
        }

        await itinerary.save();

        // Calculate reaction statistics
        const reactionStats = {};
        itinerary.reactions.forEach(reaction => {
            reactionStats[reaction.emoji] = (reactionStats[reaction.emoji] || 0) + 1;
        });

        return res.status(200).json({
            success: true,
            message: `Reaction ${action}`,
            action,
            reactions: itinerary.reactions,
            reactionStats,
            totalReactions: itinerary.reactions.length,
            userReaction: action === 'removed' ? null : emoji
        });

    } catch (error) {
        console.error("Itinerary reaction error:", error);
        return res.status(500).json({
            success: false,
            message: "Error updating reaction",
            error: error.message
        });
    }
};

// GET REACTION STATISTICS FOR AN ITINERARY - Public
const getItineraryReactions = async (req, res) => {
    try {
        const itinerary = await Post.findById(req.params.id).select('reactions postType');

        if (!itinerary) {
            return res.status(404).json({ success: false, message: "Itinerary not found" });
        }

        if (itinerary.postType !== 'plan') {
            return res.status(400).json({ success: false, message: "This is not an itinerary" });
        }

        // Calculate reaction statistics
        const reactionStats = {};
        const reactions = itinerary.reactions || [];

        reactions.forEach(reaction => {
            if (!reactionStats[reaction.emoji]) {
                reactionStats[reaction.emoji] = {
                    count: 0,
                    users: []
                };
            }
            reactionStats[reaction.emoji].count++;
            reactionStats[reaction.emoji].users.push({
                userId: reaction.user,
                name: reaction.name,
                timestamp: reaction.timestamp
            });
        });

        // Get user's reaction if authenticated
        let userReaction = null;
        if (req.user && req.user.userId) {
            const userReactionObj = reactions.find(r => r.user.toString() === req.user.userId);
            if (userReactionObj) {
                userReaction = userReactionObj.emoji;
            }
        }

        return res.status(200).json({
            success: true,
            totalReactions: reactions.length,
            reactionStats,
            userReaction,
            allReactions: reactions
        });

    } catch (error) {
        console.error("Get itinerary reactions error:", error);
        return res.status(500).json({
            success: false,
            message: "Error fetching reactions",
            error: error.message
        });
    }
};

// GET ITINERARIES/PLANS AND EXPERIENCES BY LOCATION - For single location page
const getCombinedLocationData = async (req, res) => {
    try {
        const {
            city, state, country,
            page = 1, limit = 20
        } = req.query;

        if (!city && !state && !country) {
            return res.status(400).json({
                success: false,
                message: "At least one location parameter (city, state, or country) is required"
            });
        }

        // Build location filter
        const locationFilter = { status: 'active' };
        if (city) locationFilter['location.city'] = new RegExp(city, 'i');
        if (state) locationFilter['location.state'] = new RegExp(state, 'i');
        if (country) locationFilter['location.country'] = new RegExp(country, 'i');

        const skip = (Number(page) - 1) * Number(limit);

        // Get itineraries/plans for this location
        const plansFilter = { ...locationFilter, postType: 'plan' };
        const plans = await Post.find(plansFilter)
            .populate('user', 'firstname lastname email role avatar')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);

        // Get experiences for this location
        const experiencesFilter = { ...locationFilter, postType: 'experience' };
        const experiences = await Post.find(experiencesFilter)
            .populate('user', 'firstname lastname email role avatar')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);

        const totalPlans = await Post.countDocuments(plansFilter);
        const totalExperiences = await Post.countDocuments(experiencesFilter);

        return res.status(200).json({
            success: true,
            location: {
                city: city || null,
                state: state || null,
                country: country || null
            },
            plans: {
                data: plans,
                count: plans.length,
                total: totalPlans,
                page: Number(page),
                totalPages: Math.ceil(totalPlans / Number(limit))
            },
            experiences: {
                data: experiences,
                count: experiences.length,
                total: totalExperiences,
                page: Number(page),
                totalPages: Math.ceil(totalExperiences / Number(limit))
            }
        });
    } catch (error) {
        console.error("Get location combined data error:", error);
        return res.status(500).json({
            success: false,
            message: "Error fetching location data",
            error: error.message
        });
    }
};

// GET COMPLETE ITINERARIES/PLANS FOR EXPLORE PAGE
const getExploreComplete = async (req, res) => {
    try {
        const {
            city, country, state,
            minPrice, maxPrice, tags,
            difficulty, categories,
            sortBy = 'recent', // recent, popular, rating, price_low, price_high
            page = 1, limit = 20
        } = req.query;

        // Build filter query
        const filter = { postType: 'plan', status: 'active' };

        // Location filters
        if (city) filter['location.city'] = new RegExp(city, 'i');
        if (state) filter['location.state'] = new RegExp(state, 'i');
        if (country) filter['location.country'] = new RegExp(country, 'i');

        // Tags and categories filters
        if (tags) filter.tags = { $in: tags.split(',') };
        if (difficulty) filter.difficulty = difficulty;
        if (categories) filter.categories = { $in: categories.split(',') };

        // Price range filter
        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const skip = (Number(page) - 1) * Number(limit);

        // Sort options
        let sortOption = { createdAt: -1 }; // default: recent
        switch (sortBy) {
            case 'popular':
                sortOption = { 'reactions.length': -1, createdAt: -1 };
                break;
            case 'rating':
                sortOption = { 'rating.average': -1, 'rating.count': -1 };
                break;
            case 'price_low':
                sortOption = { 'price.perPerson': 1 };
                break;
            case 'price_high':
                sortOption = { 'price.perPerson': -1 };
                break;
            default:
                sortOption = { createdAt: -1 };
        }

        const itineraries = await Post.find(filter)
            .populate('user', 'firstname lastname email role avatar description')
            .sort(sortOption)
            .limit(Number(limit))
            .skip(skip);

        const total = await Post.countDocuments(filter);

        // Get aggregated stats for the explore page
        const stats = await Post.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    avgPrice: { $avg: '$price.perPerson' },
                    minPrice: { $min: '$price.perPerson' },
                    maxPrice: { $max: '$price.perPerson' },
                    totalPlans: { $sum: 1 }
                }
            }
        ]);

        // Get unique locations available
        const uniqueLocations = await Post.aggregate([
            { $match: { postType: 'plan', status: 'active' } },
            {
                $group: {
                    _id: {
                        city: '$location.city',
                        state: '$location.state',
                        country: '$location.country'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        return res.status(200).json({
            success: true,
            count: itineraries.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            stats: stats[0] || { avgPrice: 0, minPrice: 0, maxPrice: 0, totalPlans: 0 },
            topLocations: uniqueLocations.map(loc => ({
                city: loc._id.city,
                state: loc._id.state,
                country: loc._id.country,
                count: loc.count
            })),
            itineraries
        });
    } catch (error) {
        console.error("Get explore itineraries error:", error);
        return res.status(500).json({
            success: false,
            message: "Error fetching explore itineraries",
            error: error.message
        });
    }
};

module.exports = {
    createItinerary,
    getItineraries,
    getItineraryById,
    getUserItineraries,
    getMyItineraries,
    updateItinerary,
    deleteItinerary,
    saveItinerary,
    unsaveItinerary,
    reactToItinerary,
    getItineraryReactions,
    getCombinedLocationData,
    getExploreComplete
};
