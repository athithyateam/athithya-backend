const { Post, Review } = require("../../db/mongoose");
const { calculateDistance } = require("../../utils/postUtils");

const LISTING_CARD_PROJECTION = "title subtitle postType photos location price duration difficulty categories discounts isFeatured status rating bookingCount savesCount clicks user createdAt approvedAt";

const expandCategories = (categories) => {
    if (!categories) return [];
    const list = Array.isArray(categories) ? categories : categories.split(',');
    return list.flatMap(c => {
        const trimmed = String(c).trim();
        const lc = trimmed.toLowerCase();
        if (lc === 'others' || lc === 'other') {
            return ['Others', 'Other', 'Rock Climbing', 'Flyboarding', 'rock-climbing', 'flyboarding'];
        }
        return [trimmed];
    });
};

exports.getPosts = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const {
            postType, userRole, city, country, state, minPrice, maxPrice, status,
            difficulty, categories, isFeatured, page = 1, limit = 20, sort = 'latest'
        } = req.query;

        const filter = {};
        if (postType) {
            if (postType.includes(',')) filter.postType = { $in: postType.split(',') };
            else filter.postType = postType;
        } else if (req.postTypeFilter) {
            if (Array.isArray(req.postTypeFilter)) filter.postType = { $in: req.postTypeFilter };
            else filter.postType = req.postTypeFilter;
        }

        if (userRole) filter.userRole = userRole;
        if (city) filter['location.city'] = new RegExp(city, 'i');
        if (state) filter['location.state'] = new RegExp(state, 'i');
        if (country) filter['location.country'] = new RegExp(country, 'i');
        filter.status = status || 'active';
        filter.isHidden = { $ne: true };

        if (difficulty) filter.difficulty = difficulty;
        if (categories) {
            const expCats = expandCategories(categories);
            const isOtherFilter = (Array.isArray(categories) ? categories : categories.split(',')).some(c => ['other', 'others'].includes(String(c).trim().toLowerCase()));
            if (isOtherFilter) {
                filter.categories = { $in: expCats, $nin: ['Safari', 'safari', 'SAFARI'] };
            } else {
                filter.categories = { $in: expCats };
            }
        }
        if (isFeatured !== undefined) filter.isFeatured = isFeatured === 'true';

        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const skip = (Number(page) - 1) * Number(limit);

        // One-by-one round-robin mix: Most Saved -> Most Booked -> Most Clicked -> 2nd Saved -> 2nd Booked -> 2nd Clicked...
        if (sort === 'bookings' || sort === 'loved') {
            const total = await Post.countDocuments(filter);
            const neededLimit = skip + Number(limit);

            const [topSaved, topBooked, topClicked] = await Promise.all([
                Post.find({ ...filter, savesCount: { $gt: 0 } })
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ savesCount: -1, createdAt: -1 })
                    .limit(neededLimit),
                Post.find({ ...filter, bookingCount: { $gt: 0 } })
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ bookingCount: -1, createdAt: -1 })
                    .limit(neededLimit),
                Post.find(filter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ clicks: -1, createdAt: -1 })
                    .limit(neededLimit)
            ]);

            const mergedPosts = [];
            const seenIds = new Set();
            const maxLen = Math.max(topSaved.length, topBooked.length, topClicked.length);

            for (let i = 0; i < maxLen; i++) {
                if (i < topSaved.length) {
                    const idStr = topSaved[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topSaved[i]);
                    }
                }
                if (i < topBooked.length) {
                    const idStr = topBooked[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topBooked[i]);
                    }
                }
                if (i < topClicked.length) {
                    const idStr = topClicked[i]._id.toString();
                    if (!seenIds.has(idStr)) {
                        seenIds.add(idStr);
                        mergedPosts.push(topClicked[i]);
                    }
                }
            }

            const paginatedPosts = mergedPosts.slice(skip, skip + Number(limit));

            return res.status(200).json({
                success: true,
                count: paginatedPosts.length,
                total,
                page: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                posts: paginatedPosts
            });
        }

        let sortObj = { createdAt: -1 }; // Default to newest
        if (sort === 'latest') sortObj = { createdAt: -1 };
        else if (sort === 'clicks') sortObj = { clicks: -1, createdAt: -1 };
        else if (sort === 'rating') sortObj = { 'rating.average': -1, 'rating.count': -1, createdAt: -1 };
        else if (isFeatured === 'true') sortObj = { clicks: -1, createdAt: -1 };
        else sortObj = { clicks: -1, createdAt: -1 }; // Fallback clicks sort

        const posts = await Post.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort(sortObj)
            .limit(Number(limit))
            .skip(skip);

        const total = await Post.countDocuments(filter);

        return res.status(200).json({
            success: true,
            count: posts.length,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit)),
            posts
        });
    } catch (error) {
        console.error("Get posts error:", error);
        return res.status(500).json({ success: false, message: "Error fetching posts" });
    }
};

exports.getPostDetail = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)
            .populate('user', 'firstname lastname email role avatar description location hostDetails hostStatus isHostVerified verifiedBadge createdAt');

        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        post.clicks = (post.clicks || 0) + 1;
        await Post.updateOne({ _id: post._id }, { $inc: { clicks: 1 } });

        const reviews = await Review.find({ post: req.params.id })
            .populate('reviewer', 'firstname lastname avatar role')
            .sort({ createdAt: -1 });

        const reactionStats = {};
        if (post.reactions) {
            post.reactions.forEach(r => { if (r.emoji) reactionStats[r.emoji] = (reactionStats[r.emoji] || 0) + 1; });
        }

        const similarPosts = await Post.find({
            postType: post.postType,
            status: 'active',
            _id: { $ne: post._id },
            $or: [
                { categories: { $in: post.categories || [] } },
                { 'location.city': post.location?.city }
            ]
        }).limit(6);

        // Calculate host rating
        const hostId = post.user?._id;
        let hostRating = { average: 0, count: 0 };
        if (hostId) {
            const mongoose = require("mongoose");
            const hostObjectId = new mongoose.Types.ObjectId(hostId);
            const hostPosts = await Post.find({ user: hostObjectId }).select('_id');
            const hostPostIds = hostPosts.map(p => p._id);
            const baseMatch = hostPostIds.length > 0
                ? { $or: [{ host: hostObjectId }, { post: { $in: hostPostIds } }] }
                : { host: hostObjectId };

            const hostStats = await Review.aggregate([
                { $match: baseMatch },
                { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }
            ]);
            if (hostStats.length > 0) {
                hostRating = { 
                    average: Math.round(hostStats[0].average * 10) / 10, 
                    count: hostStats[0].count 
                };
            }
        }

        return res.status(200).json({
            success: true,
            post: { 
                ...post.toObject(), 
                reactionStats, 
                reactionCount: post.reactions?.length || 0,
                user: post.user ? { ...post.user.toObject(), hostRating } : null
            },
            reviews: { count: reviews.length, data: reviews },
            similarPosts
        });
    } catch (error) {
        console.error("Get post detail error:", error);
        return res.status(500).json({ success: false, message: "Error fetching post detail" });
    }
};

exports.getTopRatedTreks = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const { limit = 10, page = 1, minRating = 0 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const totalFilter = { postType: 'trek', status: 'active' };
        const total = await Post.countDocuments(totalFilter);

        const topRatedTreks = await Review.aggregate([
            { $match: { post: { $exists: true, $ne: null } } },
            { $group: { _id: '$post', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
            { $match: { averageRating: { $gte: Number(minRating) } } },
            { $sort: { averageRating: -1, reviewCount: -1 } },
            { $lookup: { from: 'posts', localField: '_id', foreignField: '_id', as: 'postDetails' } },
            { $unwind: '$postDetails' },
            { $match: { 'postDetails.postType': 'trek', 'postDetails.status': 'active' } },
            { $skip: skip },
            { $limit: Number(limit) },
            { $lookup: { from: 'users', localField: 'postDetails.user', foreignField: '_id', as: 'userDetails' } },
            { $project: {
                _id: '$postDetails._id',
                title: '$postDetails.title',
                description: '$postDetails.description',
                postType: '$postDetails.postType',
                photos: '$postDetails.photos',
                location: '$postDetails.location',
                price: '$postDetails.price',
                duration: '$postDetails.duration',
                difficulty: '$postDetails.difficulty',
                categories: '$postDetails.categories',
                isFeatured: '$postDetails.isFeatured',
                status: '$postDetails.status',
                approvedAt: '$postDetails.approvedAt',
                createdAt: '$postDetails.createdAt',
                user: { $arrayElemAt: ['$userDetails', 0] },
                averageRating: { $round: ['$averageRating', 1] },
                reviewCount: '$reviewCount'
            }}
        ]);

        return res.status(200).json({ success: true, count: topRatedTreks.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), treks: topRatedTreks });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching top-rated treks" });
    }
};

exports.getNearbyTreks = async (req, res) => {
    try {
        const { latitude, longitude, limit = 20, page = 1, difficulty, minPrice, maxPrice, categories } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter = {
            postType: { $in: ['experience', 'service', 'trek', 'plan'] },
            status: 'active'
        };

        if (difficulty) filter.difficulty = difficulty;
        if (categories) {
            const expCats = expandCategories(categories);
            const isOtherFilter = (Array.isArray(categories) ? categories : categories.split(',')).some(c => ['other', 'others'].includes(String(c).trim().toLowerCase()));
            if (isOtherFilter) {
                filter.categories = { $in: expCats, $nin: ['Safari', 'safari', 'SAFARI'] };
            } else {
                filter.categories = { $in: expCats };
            }
        }
        if (minPrice || maxPrice) {
            filter['price.perPerson'] = {};
            if (minPrice) filter['price.perPerson'].$gte = Number(minPrice);
            if (maxPrice) filter['price.perPerson'].$lte = Number(maxPrice);
        }

        const total = await Post.countDocuments(filter);

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        const hasValidCoords = !isNaN(lat) && !isNaN(lng);

        if (hasValidCoords) {
            filter['location.coordinates'] = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] }
                }
            };
            const treks = await Post.find(filter)
                .select(LISTING_CARD_PROJECTION)
                .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                .limit(Number(limit))
                .skip(skip);
            const treksWithDistance = treks.map(trek => {
                const trekObj = trek.toObject();
                if (trek.location?.coordinates?.coordinates) {
                    const [trekLng, trekLat] = trek.location.coordinates.coordinates;
                    trekObj.distance = Math.round(calculateDistance(lat, lng, trekLat, trekLng) * 10) / 10;
                    trekObj.distanceUnit = 'km';
                }
                return trekObj;
            });
            return res.status(200).json({ success: true, count: treksWithDistance.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), treks: treksWithDistance });
        } else {
            // No coordinates or invalid coordinates provided: return Dehradun (lat 30.3165, lng 78.0322) experiences first (within 50km), then remaining sorted by newest
            const dehradunLat = 30.3165;
            const dehradunLng = 78.0322;
            const maxNeeded = skip + Number(limit);

            // 1. Fetch experiences near Dehradun (within 50km)
            const dehradunFilter = { ...filter };
            dehradunFilter['location.coordinates'] = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [dehradunLng, dehradunLat] },
                    $maxDistance: 50000 // 50km in meters
                }
            };

            let dehradunTreks = [];
            try {
                dehradunTreks = await Post.find(dehradunFilter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .limit(maxNeeded);
            } catch (err) {
                console.error("Error fetching Dehradun fallback treks:", err);
            }

            const dehradunTreksWithDistance = dehradunTreks.map(trek => {
                const trekObj = trek.toObject();
                if (trek.location?.coordinates?.coordinates) {
                    const [trekLng, trekLat] = trek.location.coordinates.coordinates;
                    trekObj.distance = Math.round(calculateDistance(dehradunLat, dehradunLng, trekLat, trekLng) * 10) / 10;
                    trekObj.distanceUnit = 'km';
                }
                return trekObj;
            });

            // 2. Fetch other active experiences excluding Dehradun ones, sorted by newest
            const dehradunIds = dehradunTreks.map(t => t._id.toString());
            const fallbackFilter = { ...filter, _id: { $nin: dehradunIds } };
            
            const remainingLimit = Math.max(0, maxNeeded - dehradunTreks.length);
            let fallbackTreks = [];
            if (remainingLimit > 0) {
                fallbackTreks = await Post.find(fallbackFilter)
                    .select(LISTING_CARD_PROJECTION)
                    .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
                    .sort({ createdAt: -1 })
                    .limit(remainingLimit);
            }

            const combinedTreks = [...dehradunTreksWithDistance, ...fallbackTreks];
            
            // Handle manual pagination for combined list
            const paginatedTreks = combinedTreks.slice(skip, skip + Number(limit));

            return res.status(200).json({ 
                success: true, 
                count: paginatedTreks.length, 
                total, 
                page: Number(page), 
                totalPages: Math.ceil(total / Number(limit)), 
                treks: paginatedTreks 
            });
        }
    } catch (error) {
        console.error("Error fetching nearby treks:", error);
        return res.status(500).json({ success: false, message: "Error fetching nearby treks" });
    }
};

exports.getUserPosts = async (req, res) => {
    try {
        const { userId } = req.params;
        const { postType } = req.query;
        const filter = { user: userId };
        if (postType) filter.postType = postType;
        
        const posts = await Post.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort({ createdAt: -1 });
        return res.status(200).json({ success: true, count: posts.length, posts });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching user posts" });
    }
};

exports.getPendingPosts = async (req, res) => {
    try {
        const { postType = 'experience', page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const filter = { postType, status: 'pending' };

        const posts = await Post.find(filter)
            .select(LISTING_CARD_PROJECTION)
            .populate('user', 'firstname lastname email role avatar hostStatus verifyBadge')
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(skip);
        const total = await Post.countDocuments(filter);

        return res.status(200).json({ success: true, count: posts.length, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)), posts });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching pending posts" });
    }
};

exports.getCategoryActivity = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const activity = await Post.aggregate([
            { 
                $match: { 
                    status: 'active', 
                    isHidden: { $ne: true } 
                } 
            },
            { $unwind: "$categories" },
            {
                $group: {
                    _id: { $toLower: "$categories" },
                    categoryName: { $first: "$categories" },
                    latestApprovedAt: {
                        $max: {
                            $ifNull: ["$approvedAt", "$createdAt"]
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { latestApprovedAt: -1 } }
        ]);

        const results = activity.map(item => ({
            category: item.categoryName,
            normalizedCategory: item._id,
            latestApprovedAt: item.latestApprovedAt,
            count: item.count,
            isNew: item.latestApprovedAt ? new Date(item.latestApprovedAt) >= twentyFourHoursAgo : false
        }));

        return res.status(200).json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error("Error fetching category activity:", error);
        return res.status(500).json({ success: false, message: "Error fetching category activity" });
    }
};

