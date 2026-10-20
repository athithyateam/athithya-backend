const mongoose = require("mongoose");
const { User, Post, Review, Notification, HostHistory } = require("../../db/mongoose");
const { deleteFromS3 } = require("../../utils/s3");
const { parseIfJson } = require("../../utils/postUtils");
const { sendTemplateEmail } = require("../emailService");

/**
 * Record host's previous details to HostHistory collection
 */
const saveHostOldDetails = async (user, changedFields = []) => {
    try {
        if (!user || user.role !== "host") return;
        const hostName = `${user.firstname} ${user.lastname}`;
        await HostHistory.create({
            type: "profile_update",
            hostId: user._id,
            hostName: hostName,
            changedFields: changedFields,
            avatarUrl: user.avatar?.url || "",
            physicalAddress: user.hostDetails?.physicalAddress || "",
            city: user.hostDetails?.city || "",
            district: user.hostDetails?.district || "",
            state: user.hostDetails?.state || "",
            pincode: user.hostDetails?.pincode || "",
            phone: user.hostDetails?.phone || "",
            email: user.email || "",
            aadhaarCard: user.hostDetails?.aadhaarCard || []
        });

        // Prune to only keep last 10 globally
        const items = await HostHistory.find({ type: "profile_update" }).sort({ createdAt: -1 });
        if (items.length > 10) {
            const idsToDelete = items.slice(10).map(item => item._id);
            await HostHistory.deleteMany({ _id: { $in: idsToDelete } });
        }
    } catch (err) {
        console.error("Error saving host old details to history:", err);
    }
};

/**
 * Format user response fields based on requester authorization
 */
const getUserFields = (user, isOwnProfileOrAdmin = false) => {
    let hostDetails = user.hostDetails 
        ? (typeof user.hostDetails.toObject === 'function' ? user.hostDetails.toObject() : JSON.parse(JSON.stringify(user.hostDetails))) 
        : undefined;
    let pendingHostDetails = user.pendingHostDetails 
        ? (typeof user.pendingHostDetails.toObject === 'function' ? user.pendingHostDetails.toObject() : JSON.parse(JSON.stringify(user.pendingHostDetails))) 
        : undefined;

    if (!isOwnProfileOrAdmin) {
        if (hostDetails) {
            delete hostDetails.aadhaarCard;
        }
        if (pendingHostDetails) {
            delete pendingHostDetails.aadhaarCard;
        }
    }

    return {
        id: user._id.toString(),
        _id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: isOwnProfileOrAdmin ? user.email : undefined,
        role: user.role,
        avatar: user.avatar,
        description: user.description,
        isVerified: user.isVerified,
        hostStatus: user.hostStatus,
        hostDetails: hostDetails,
        pendingHostDetails: pendingHostDetails,
        location: user.location,
        activeGridTab: user.activeGridTab || "experience",
        friendsCount: (user.friends || []).filter(Boolean).length,
        interests: user.interests || [],
        walletBalance: isOwnProfileOrAdmin ? (user.walletBalance || 0) : undefined,
        savedPosts: isOwnProfileOrAdmin ? (user.savedPosts || []) : undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
};

/**
 * Service: Fetch a user by ID
 */
const getUserById = async ({ targetUserId, currentUserId, currentUserRole }) => {
    const user = await User.findById(targetUserId).select('-password -otp -otpExpires');
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    const currentUserIdStr = currentUserId?.toString();
    const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === targetUserId || currentUserRole === 'admin'));

    let isFollowing = false;
    let isRequested = false;
    if (currentUserIdStr && targetUserId !== currentUserIdStr) {
        isFollowing = (user.friends || []).some(id => id.toString() === currentUserIdStr);
        isRequested = (user.friendRequests || []).some(id => id.toString() === currentUserIdStr);
    }

    const userData = getUserFields(user, isOwnProfileOrAdmin);
    return { ...userData, isFollowing, isRequested };
};

/**
 * Service: Update user geographic/text location
 */
const updateUserLocation = async (userId, { latitude, longitude, address, city, state, country }) => {
    if (!latitude || !longitude) {
        const error = new Error("Coordinates required");
        error.statusCode = 400;
        throw error;
    }

    const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
            location: {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                address: address || '',
                city: city || '',
                state: state || '',
                country: country || '',
                lastUpdated: new Date()
            }
        },
        { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    return {
        userId: updatedUser._id,
        location: updatedUser.location
    };
};

/**
 * Service: Get saved location for user
 */
const getUserLocation = async (userId) => {
    const user = await User.findById(userId).select('location role firstname lastname');
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    return {
        userId: user._id,
        role: user.role,
        name: `${user.firstname} ${user.lastname}`,
        location: user.location || null
    };
};

/**
 * Service: Get user saved posts
 */
const getSavedPosts = async (userId) => {
    const user = await User.findById(userId).populate({
        path: "savedPosts",
        populate: {
            path: "user",
            select: "firstname lastname avatar"
        }
    });

    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    return user.savedPosts || [];
};

/**
 * Service: Get user profile with posts and ratings
 */
const getProfile = async ({ userId, page = 1, limit = 12, currentUserId, currentUserRole }) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        const error = new Error("Invalid user ID format");
        error.statusCode = 400;
        throw error;
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 12;
    const skip = (pageNum - 1) * limitNum;

    const user = await User.findById(userId).select('-password -otp -otpExpires');
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    const isOwner = currentUserId && String(currentUserId) === String(userId);
    const baseQuery = { user: userId, status: 'active' };
    if (!isOwner) {
        baseQuery.isHidden = { $ne: true };
    }

    const totalPosts = await Post.countDocuments(baseQuery);

    const posts = await Post.find(baseQuery)
        .populate('user', 'firstname lastname avatar role username isHostVerified verifiedBadge')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    const postStats = {
        total: totalPosts,
        experiences: await Post.countDocuments({ ...baseQuery, postType: 'experience' }),
        services: await Post.countDocuments({ ...baseQuery, postType: 'service' }),
        treks: await Post.countDocuments({ ...baseQuery, postType: 'trek' }),
        plans: await Post.countDocuments({ ...baseQuery, postType: 'plan' })
    };

    const totalPages = Math.ceil(totalPosts / limitNum);

    let reviews = [];
    let reviewStats = null;
    if (user.role === 'host') {
        const currentUserIdStr = currentUserId?.toString();
        const allHostReviews = await Review.find({ host: userId }).populate('reviewer', 'firstname lastname avatar').sort({ createdAt: -1 });
        reviews = allHostReviews.filter(r => r.comment && r.comment.trim() !== "").slice(0, 10);

        const totalStats = await Review.aggregate([
            { $match: { host: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: '$host', average: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);

        const writtenCount = allHostReviews.filter(r => r.comment && r.comment.trim() !== "").length;
        const userRatingObj = currentUserIdStr ? await Review.findOne({ host: userId, reviewer: currentUserIdStr, post: null }) : null;

        if (totalStats.length > 0) {
            const avg = totalStats[0].average || 0;
            reviewStats = {
                totalRatings: totalStats[0].count,
                totalReviews: writtenCount,
                averageRating: Number(avg.toFixed(1)),
                currentUserRating: userRatingObj ? userRatingObj.rating : null,
                ratings: { 
                    5: allHostReviews.filter(r => r.rating === 5).length, 
                    4: allHostReviews.filter(r => r.rating === 4).length, 
                    3: allHostReviews.filter(r => r.rating === 3).length, 
                    2: allHostReviews.filter(r => r.rating === 2).length, 
                    1: allHostReviews.filter(r => r.rating === 1).length 
                }
            };
        }
    }

    const currentUserIdStr = currentUserId?.toString();
    const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
    const userData = getUserFields(user, isOwnProfileOrAdmin);

    userData.isFriend = currentUserIdStr && (user.friends || []).some(id => id && id.toString() === currentUserIdStr);
    userData.isRequestedFriend = currentUserIdStr && (user.friendRequests || []).some(id => id && id.toString() === currentUserIdStr);

    return {
        user: userData,
        postStats,
        posts,
        pagination: {
            totalPosts,
            totalPages,
            currentPage: pageNum,
            limit: limitNum
        },
        reviews: user.role === 'host' ? reviews : undefined,
        reviewStats: user.role === 'host' ? reviewStats : undefined
    };
};

/**
 * Service: Get complete profile with categorized posts and stats
 */
const getCompleteProfile = async ({ userId, currentUserId, currentUserRole }) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        const error = new Error("Invalid user ID format");
        error.statusCode = 400;
        throw error;
    }

    const user = await User.findById(userId).select('-password -otp -otpExpires');
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    const posts = await Post.find({ user: userId, status: 'active' }).sort({ createdAt: -1 });
    const experiences = posts.filter(p => p.postType === 'experience');
    const services = posts.filter(p => p.postType === 'service');
    const treks = posts.filter(p => p.postType === 'trek');
    const plans = posts.filter(p => p.postType === 'plan');

    const itineraries = posts.filter(p => p.postType === 'plan');
    const reviewsWritten = await Review.find({ reviewer: userId, comment: { $exists: true, $ne: "" } })
        .populate('host', 'firstname lastname avatar')
        .populate('post', 'title postType')
        .sort({ createdAt: -1 });

    let reviewsReceived = [];
    let reviewStats = null;
    if (user.role === 'host') {
        const currentUserIdStr = currentUserId?.toString();
        const allHostReviews = await Review.find({ host: userId })
            .populate('reviewer', 'firstname lastname avatar')
            .populate('post', 'title postType')
            .sort({ createdAt: -1 });
        reviewsReceived = allHostReviews.filter(r => r.comment && r.comment.trim() !== "");

        const totalStats = await Review.aggregate([
            { $match: { host: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: '$host', average: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);

        const userRatingObj = currentUserIdStr ? await Review.findOne({ host: userId, reviewer: currentUserIdStr, post: null }) : null;

        if (totalStats.length > 0) {
            const avg = totalStats[0].average || 0;
            reviewStats = {
                totalRatings: totalStats[0].count,
                totalReviews: reviewsReceived.length,
                averageRating: Number(avg.toFixed(1)),
                currentUserRating: userRatingObj ? userRatingObj.rating : null,
                ratings: { 
                    5: allHostReviews.filter(r => r.rating === 5).length, 
                    4: allHostReviews.filter(r => r.rating === 4).length, 
                    3: allHostReviews.filter(r => r.rating === 3).length, 
                    2: allHostReviews.filter(r => r.rating === 2).length, 
                    1: allHostReviews.filter(r => r.rating === 1).length 
                }
            };
        }
    }

    const stats = {
        posts: { total: posts.length, experiences: experiences.length, services: services.length, treks: treks.length, plans: plans.length },
        itineraries: { total: plans.length },
        reviews: { written: reviewsWritten.length, received: reviewsReceived.length }
    };

    const currentUserIdStr = currentUserId?.toString();
    const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || currentUserRole === 'admin'));
    const userData = getUserFields(user, isOwnProfileOrAdmin);
    userData.isFriend = currentUserIdStr && (user.friends || []).some(id => id && id.toString() === currentUserIdStr);
    userData.isRequestedFriend = currentUserIdStr && (user.friendRequests || []).some(id => id && id.toString() === currentUserIdStr);

    return {
        user: userData,
        stats,
        posts: { all: posts, experiences, services, treks, plans },
        itineraries,
        reviews: { written: reviewsWritten, received: user.role === 'host' ? reviewsReceived : [] },
        reviewStats: user.role === 'host' ? reviewStats : null
    };
};

/**
 * Service: Get top rated hosts with calculated review averages
 */
const getTopRatedHosts = async ({ limit = 100, page = 1, minRating = 0, location }) => {
    const ratingValue = Number(minRating);
    const limitValue = Number(limit);
    const skipValue = (Number(page) - 1) * limitValue;

    const hostMatch = {
        role: 'host',
        hostStatus: 'approved'
    };

    if (location && location.trim()) {
        const locRegex = new RegExp(location.trim(), 'i');
        hostMatch.$or = [
            { 'location.city': locRegex },
            { 'location.state': locRegex },
            { 'location.country': locRegex },
            { 'location.address': locRegex }
        ];
    }

    const topRatedHosts = await User.aggregate([
        { $match: hostMatch },
        {
            $lookup: {
                from: 'reviews',
                localField: '_id',
                foreignField: 'host',
                as: 'hostReviews'
            }
        },
        {
            $addFields: {
                averageRating: { $ifNull: [{ $avg: '$hostReviews.rating' }, 0] },
                reviewCount: { $size: '$hostReviews' },
                hasReviews: { $cond: [{ $gt: [{ $size: '$hostReviews' }, 0] }, 1, 0] },
                latestReviewDate: { $ifNull: [{ $max: '$hostReviews.createdAt' }, new Date(0)] }
            }
        },
        { $match: { averageRating: { $gte: ratingValue } } },
        { $sort: { hasReviews: -1, averageRating: -1, reviewCount: -1, latestReviewDate: -1, _id: 1 } },
        { $skip: skipValue },
        { $limit: limitValue },
        {
            $lookup: {
                from: 'posts',
                let: { userId: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$user', '$$userId'] }, status: 'active', isHidden: { $ne: true } } },
                    { $project: { _id: 1, title: 1, photos: { $slice: ['$photos', 1] }, price: 1, location: 1 } },
                    { $limit: 3 }
                ],
                as: 'posts'
            }
        },
        {
            $project: {
                _id: 1, firstname: 1, lastname: 1, email: 1,
                role: 1, isVerified: 1, location: 1, avatar: 1,
                verifyBadge: 1,
                hostDetails: 1,
                averageRating: { $round: ['$averageRating', 1] },
                reviewCount: 1,
                totalPosts: { $size: '$posts' },
                posts: 1
            }
        }
    ]);

    const totalHostsCount = await User.countDocuments(hostMatch);

    return {
        count: topRatedHosts.length,
        total: totalHostsCount,
        page: Number(page),
        totalPages: Math.ceil(totalHostsCount / limitValue) || 1,
        hosts: topRatedHosts
    };
};

/**
 * Service: Update user profile (guest or host)
 */
const updateProfile = async ({ userId, profileData, io }) => {
    const {
        firstname, lastname, description, removeAvatar, interests, avatarUrl, avatarPublicId,
        phone, physicalAddress, pincode, existingAadhaar, city, district, state, yearsOfExperience,
        locationCity, locationState, country, locationCountry, address, locationAddress, aadhaar
    } = profileData;

    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    // Rule 1: Unverified hosts cannot update any profile details
    if (user.role === "host" && user.hostStatus !== "approved") {
        const error = new Error("You cannot update your profile until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval.");
        error.statusCode = 400;
        error.isUnverifiedHost = true;
        throw error;
    }

    const currentDetails = user.hostDetails || {};
    const isYearsSupplied = yearsOfExperience !== undefined && yearsOfExperience !== null && yearsOfExperience !== "" && !isNaN(parseInt(yearsOfExperience));
    let parsedYears = currentDetails.yearsOfExperience || 0;
    if (isYearsSupplied) {
        parsedYears = Math.min(30, Math.max(0, parseInt(yearsOfExperience) || 0));
    }

    // Rule 2: Approved hosts — changes to name, bio, avatar, yearsOfExperience, address, phone, aadhaar must be reviewed by admin
    if (user.role === "host" && user.hostStatus === "approved") {
        const isNameChanging = (firstname && (firstname || "").trim() !== (user.firstname || "").trim()) ||
                               (lastname && (lastname || "").trim() !== (user.lastname || "").trim());
        const isDescriptionChanging = description !== undefined && (description || "").trim() !== (user.description || "").trim();
        let isAvatarChanging = false;
        if (removeAvatar === "true" || removeAvatar === true) {
            if (user.avatar && user.avatar.url) isAvatarChanging = true;
        } else if (avatarUrl && (!user.avatar || user.avatar.url !== avatarUrl)) {
            isAvatarChanging = true;
        }

        let parsedExisting = [];
        if (existingAadhaar) {
            try {
                parsedExisting = typeof existingAadhaar === 'string' ? JSON.parse(existingAadhaar) : existingAadhaar;
            } catch (e) {}
        }
        let newAadhaar = [];
        if (aadhaar) {
            newAadhaar = Array.isArray(aadhaar) ? aadhaar : (parseIfJson(aadhaar) || []);
        }
        const rawProposed = [...(Array.isArray(parsedExisting) ? parsedExisting : [parsedExisting]), ...(Array.isArray(newAadhaar) ? newAadhaar : [newAadhaar])];
        const proposedAadhaar = rawProposed.map(item => {
            if (typeof item === 'string') {
                return { url: item, public_id: '' };
            }
            if (item && typeof item === 'object') {
                return {
                    url: item.url || item.fileUrl || '',
                    public_id: item.public_id || item.key || ''
                };
            }
            return null;
        }).filter(item => item && item.url);

        let isVerifChanging = false;
        const hasYearsChanging = isYearsSupplied && parsedYears !== (currentDetails.yearsOfExperience || 0);
        if (hasYearsChanging) isVerifChanging = true;
        if (phone !== undefined && phone.trim() !== '' && phone.trim() !== (currentDetails.phone || '').trim()) {
            const normPhone = phone.trim().replace(/\s+/g, '');
            const normTemp = (currentDetails.tempVerifiedPhone || '').trim().replace(/\s+/g, '');
            if (!normTemp || normPhone !== normTemp) {
                const error = new Error("Please verify your updated phone number first using OTP");
                error.statusCode = 400;
                throw error;
            }
            isVerifChanging = true;
        }
        if (physicalAddress !== undefined && physicalAddress.trim() !== '' && physicalAddress.trim() !== (currentDetails.physicalAddress || '').trim()) isVerifChanging = true;
        if (pincode !== undefined && pincode.trim() !== '' && pincode.trim() !== (currentDetails.pincode || '').trim()) isVerifChanging = true;
        if (city !== undefined && city.trim() !== '' && city.trim() !== (currentDetails.city || '').trim()) isVerifChanging = true;
        if (district !== undefined && district.trim() !== '' && district.trim() !== (currentDetails.district || '').trim()) isVerifChanging = true;
        if (state !== undefined && state.trim() !== '' && state.trim() !== (currentDetails.state || '').trim()) isVerifChanging = true;

        const currentAadhaar = currentDetails.aadhaarCard || [];
        if (proposedAadhaar.length > 0 && proposedAadhaar.length !== currentAadhaar.length) {
            isVerifChanging = true;
        } else if (proposedAadhaar.length > 0) {
            for (let i = 0; i < proposedAadhaar.length; i++) {
                if (proposedAadhaar[i].url !== currentAadhaar[i]?.url || proposedAadhaar[i].public_id !== currentAadhaar[i]?.public_id) {
                    isVerifChanging = true;
                    break;
                }
            }
        }

        const isAnyModified = isNameChanging || isDescriptionChanging || isAvatarChanging || isVerifChanging;

        if (isAnyModified) {
            if (!user.pendingHostDetails) {
                user.pendingHostDetails = {};
            }
            user.pendingHostDetails.firstname = firstname || user.firstname;
            user.pendingHostDetails.lastname = lastname || user.lastname;
            user.pendingHostDetails.description = description !== undefined ? description : user.description;

            if (removeAvatar === "true" || removeAvatar === true) {
                user.pendingHostDetails.avatar = null;
            } else if (avatarUrl) {
                user.pendingHostDetails.avatar = { url: avatarUrl, public_id: avatarPublicId };
            } else {
                user.pendingHostDetails.avatar = user.avatar;
            }

            user.pendingHostDetails.yearsOfExperience = hasYearsChanging ? parsedYears : (currentDetails.yearsOfExperience || 0);
            if (phone !== undefined && phone.trim() !== '') user.pendingHostDetails.phone = phone.trim();
            else user.pendingHostDetails.phone = currentDetails.phone;

            if (physicalAddress !== undefined && physicalAddress.trim() !== '') user.pendingHostDetails.physicalAddress = physicalAddress.trim();
            else user.pendingHostDetails.physicalAddress = currentDetails.physicalAddress;

            if (pincode !== undefined && pincode.trim() !== '') user.pendingHostDetails.pincode = pincode.trim();
            else user.pendingHostDetails.pincode = currentDetails.pincode;

            if (city !== undefined && city.trim() !== '') user.pendingHostDetails.city = city.trim();
            else user.pendingHostDetails.city = currentDetails.city;

            if (district !== undefined && district.trim() !== '') user.pendingHostDetails.district = district.trim();
            else user.pendingHostDetails.district = currentDetails.district;

            if (state !== undefined && state.trim() !== '') user.pendingHostDetails.state = state.trim();
            else user.pendingHostDetails.state = currentDetails.state;

            if (proposedAadhaar.length > 0) {
                user.pendingHostDetails.aadhaarCard = proposedAadhaar;
            } else if (currentDetails.aadhaarCard && currentDetails.aadhaarCard.length > 0) {
                user.pendingHostDetails.aadhaarCard = currentDetails.aadhaarCard;
            }

            if (user.hostDetails) {
                user.hostDetails.tempVerifiedPhone = undefined;
            }

            if (interests !== undefined) {
                try {
                    user.interests = typeof interests === 'string' ? JSON.parse(interests) : interests;
                } catch (e) {
                    user.interests = Array.isArray(interests) ? interests : [];
                }
            }

            await user.save();

            // Send email notification to admin
            const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
            const adminSubject = `Host Profile Update Review Request - Athithya`;
            const hostname = `${user.firstname} ${user.lastname}`;

            let docListHtml = "None";
            if (user.pendingHostDetails.aadhaarCard && user.pendingHostDetails.aadhaarCard.length > 0) {
                docListHtml = user.pendingHostDetails.aadhaarCard.map((doc, idx) => `
                    <div style="margin-bottom: 10px;">
                        <strong>Document ${idx + 1}:</strong> <a href="${doc.url}" target="_blank" style="color: #C59A2F; text-decoration: none; font-weight: bold;">View / Download</a>
                    </div>
                `).join("");
            }

            sendTemplateEmail({
                to: adminEmail,
                subject: adminSubject,
                templateName: "admin-host-profile-update",
                data: {
                    hostname,
                    email: user.email,
                    phone: user.pendingHostDetails.phone || "N/A",
                    address: user.pendingHostDetails.physicalAddress || "N/A",
                    city: user.pendingHostDetails.city || "N/A",
                    district: user.pendingHostDetails.district || "N/A",
                    state: user.pendingHostDetails.state || "N/A",
                    pincode: user.pendingHostDetails.pincode || "N/A",
                    docListHtml
                }
            }).catch(err => console.error("Failed to send admin host profile update verification email:", err));

            // Notify admins via DB notification (bell icon)
            try {
                const admins = await User.find({ role: 'admin' });
                const dbNotifications = admins.map(admin => ({
                    recipient: admin._id,
                    sender: user._id,
                    title: "Host Profile Update Request",
                    message: `Host ${user.firstname} ${user.lastname} has requested to update verification details.`,
                    type: 'info',
                    link: `/admin`,
                    metadata: { userId: user._id }
                }));
                const savedNotifications = await Notification.insertMany(dbNotifications);

                if (io) {
                    savedNotifications.forEach(notif => {
                        io.to(notif.recipient.toString()).emit("new_notification", notif);
                    });
                    io.emit("admin_new_verification_request", {
                        userId: user._id,
                        name: `${user.firstname} ${user.lastname}`,
                        isProfileUpdate: true
                    });
                }
            } catch (notifErr) {
                console.error("Failed to notify admins via DB notification:", notifErr);
            }

            return {
                isPendingReview: true,
                message: "Your profile updates have been submitted to the admin panel for review. Once approved, your profile will be updated successfully.",
                user: getUserFields(user, true)
            };
        }
    }

    // Regular guest profile updates
    if (firstname) user.firstname = firstname;
    if (lastname) user.lastname = lastname;
    if (description !== undefined) user.description = description;

    const targetCity = city || locationCity;
    const targetState = state || locationState;
    const targetCountry = country || locationCountry;
    const targetAddress = address || locationAddress;

    if (targetCity !== undefined || targetState !== undefined || targetCountry !== undefined || targetAddress !== undefined) {
        if (!user.location) user.location = {};
        if (targetCity !== undefined) user.location.city = targetCity;
        if (targetState !== undefined) user.location.state = targetState;
        if (targetCountry !== undefined) user.location.country = targetCountry;
        if (targetAddress !== undefined) user.location.address = targetAddress;
        user.location.lastUpdated = new Date();
    }

    if (removeAvatar === "true" || removeAvatar === true) {
        if (user.avatar && user.avatar.public_id) {
            try { await deleteFromS3(user.avatar.public_id); } catch (err) {}
        }
        user.avatar = undefined;
    } else if (avatarUrl) {
        if (user.avatar && user.avatar.public_id && user.avatar.public_id !== avatarPublicId) {
            try { await deleteFromS3(user.avatar.public_id); } catch (err) {}
        }
        user.avatar = { url: avatarUrl, public_id: avatarPublicId };
    }

    if (interests !== undefined) {
        try {
            user.interests = typeof interests === 'string' ? JSON.parse(interests) : interests;
        } catch (e) {
            if (typeof interests === 'string') {
                user.interests = interests.split(',').map(i => i.trim()).filter(Boolean);
            } else {
                user.interests = interests;
            }
        }
    }

    await user.save();

    return {
        isPendingReview: false,
        message: "Profile updated successfully",
        user: getUserFields(user, true)
    };
};

module.exports = {
    getUserFields,
    saveHostOldDetails,
    getUserById,
    updateUserLocation,
    getUserLocation,
    getSavedPosts,
    getProfile,
    getCompleteProfile,
    getTopRatedHosts,
    updateProfile
};
