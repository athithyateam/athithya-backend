const mongoose = require("mongoose");
const { User, Post, Review, Booking, Notification, CommunityPost, Conversation, Message, HostHistory } = require("../../db/mongoose");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3");
const { parseIfJson } = require("../../utils/postUtils");

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

exports.updateProfile = async (req, res) => {
    try {
        const { firstname, lastname, description, removeAvatar, interests, avatarUrl, avatarPublicId } = req.body;
        const { phone, physicalAddress, pincode, existingAadhaar, city, district, state, yearsOfExperience } = req.body;
        
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Rule 1: Unverified hosts cannot update any profile details
        if (user.role === "host" && user.hostStatus !== "approved") {
            return res.status(400).json({
                success: false,
                isUnverifiedHost: true,
                message: "You cannot update your profile until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval."
            });
        }

        const currentDetails = user.hostDetails || {};
        const isYearsSupplied = yearsOfExperience !== undefined && yearsOfExperience !== null && yearsOfExperience !== "" && !isNaN(parseInt(yearsOfExperience));
        let parsedYears = currentDetails.yearsOfExperience || 0;
        if (isYearsSupplied) {
            parsedYears = Math.min(30, Math.max(0, parseInt(yearsOfExperience) || 0));
        }

        // Rule 2: Approved hosts — changes to name, bio, avatar, yearsOfExperience, address, phone, aadhaar must be reviewed by admin
        if (user.role === "host" && user.hostStatus === "approved") {
            const isNameChanging = (firstname && (firstname || "").trim() !== (user.firstname || "").trim()) || (lastname && (lastname || "").trim() !== (user.lastname || "").trim());
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
            if (req.body.aadhaar) {
                newAadhaar = Array.isArray(req.body.aadhaar) ? req.body.aadhaar : (parseIfJson(req.body.aadhaar) || []);
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
                    return res.status(400).json({ success: false, message: "Please verify your updated phone number first using OTP" });
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
                const { sendHtmlEmail } = require("../../utils/emailService");
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

                const adminHtml = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                        <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                        </div>
                        <div style="padding: 20px;">
                            <h2 style="color: #333; margin-top: 0;">Host Profile Update Request</h2>
                            <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                <strong>${hostname}</strong> has requested to update their host verification details. Please review their requested updates.
                            </p>
                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Proposed Details</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Name:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${hostname}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.email}</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Phone:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.phone || "N/A"}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Address:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.physicalAddress || "N/A"}</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">City:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.city || "N/A"}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">District:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.district || "N/A"}</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">State:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.state || "N/A"}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Pin Code:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${user.pendingHostDetails.pincode || "N/A"}</td>
                                </tr>
                            </table>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Uploaded Proposed Documents</h3>
                            <div style="margin-top: 10px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee;">
                                ${docListHtml}
                            </div>
                        </div>
                    </div>
                `;
                sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin host profile update verification email:", err));
                
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

                    // Notify admins via Socket.io
                    const io = req.app.get("io");
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

                return res.status(200).json({
                    success: true,
                    isPendingReview: true,
                    message: "Your profile updates have been submitted to the admin panel for review. Once approved, your profile will be updated successfully.",
                    user: getUserFields(user, true)
                });
            }
        }

        // Regular guest profile updates
        if (firstname) user.firstname = firstname;
        if (lastname) user.lastname = lastname;
        if (description !== undefined) user.description = description;

        const targetCity = city || req.body.locationCity;
        const targetState = state || req.body.locationState;
        const targetCountry = req.body.country || req.body.locationCountry;
        const targetAddress = req.body.address || req.body.locationAddress;

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

        return res.status(200).json({
            success: true, 
            message: "Profile updated successfully",
            isPendingReview: false,
            user: getUserFields(user, true)
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        return res.status(500).json({ success: false, message: error.message || "Error updating profile" });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { latitude, longitude, address, city, state, country } = req.body;
        if (!latitude || !longitude) return res.status(400).json({ success: false, message: "Coordinates required" });

        const updatedUser = await User.findByIdAndUpdate(
            req.user.userId,
            { location: { latitude: parseFloat(latitude), longitude: parseFloat(longitude), address: address || '', city: city || '', state: state || '', country: country || '', lastUpdated: new Date() } },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) return res.status(404).json({ success: false, message: "User not found" });
        return res.status(200).json({ success: true, message: "Location updated", data: { userId: updatedUser._id, location: updatedUser.location } });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update location" });
    }
};

exports.getLocation = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('location role firstname lastname');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        return res.status(200).json({ success: true, data: { userId: user._id, role: user.role, name: `${user.firstname} ${user.lastname}`, location: user.location || null } });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch location" });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid user ID format" });
        }
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const skip = (page - 1) * limit;

        const user = await User.findById(userId).select('-password -otp -otpExpires');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const isOwner = req.user && String(req.user.userId) === String(userId);
        const baseQuery = { user: userId, status: 'active' };
        if (!isOwner) {
            baseQuery.isHidden = { $ne: true };
        }

        // Total count for metadata
        const totalPosts = await Post.countDocuments(baseQuery);
        
        // Paginated posts
        const posts = await Post.find(baseQuery)
            .populate('user', 'firstname lastname avatar role username isHostVerified verifiedBadge')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const postStats = {
            total: totalPosts,
            experiences: await Post.countDocuments({ ...baseQuery, postType: 'experience' }),
            services: await Post.countDocuments({ ...baseQuery, postType: 'service' }),
            treks: await Post.countDocuments({ ...baseQuery, postType: 'trek' }),
            plans: await Post.countDocuments({ ...baseQuery, postType: 'plan' })
        };

        const totalPages = Math.ceil(totalPosts / limit);

        let reviews = [];
        let reviewStats = null;
        if (user.role === 'host') {
            const currentUserIdStr = req.user?.userId?.toString();
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

        const currentUserIdStr = req.user?.userId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || req.user?.role === 'admin'));
        const userData = getUserFields(user, isOwnProfileOrAdmin);
        
        userData.isFriend = currentUserIdStr && (user.friends || []).some(id => id && id.toString() === currentUserIdStr);
        userData.isRequestedFriend = currentUserIdStr && (user.friendRequests || []).some(id => id && id.toString() === currentUserIdStr);

        res.status(200).json({
            success: true,
            data: {
                user: userData,
                postStats, 
                posts, 
                pagination: {
                    totalPosts,
                    totalPages,
                    currentPage: page,
                    limit
                },
                reviews: user.role === 'host' ? reviews : undefined, 
                reviewStats: user.role === 'host' ? reviewStats : undefined
            }
        });
    } catch (error) {
        console.error("Profile fetch error (getProfile):", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to fetch profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

exports.getCompleteProfile = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid user ID format" });
        }
        const user = await User.findById(userId).select('-password -otp -otpExpires');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const posts = await Post.find({ user: userId, status: 'active' }).sort({ createdAt: -1 });
        const experiences = posts.filter(p => p.postType === 'experience');
        const services = posts.filter(p => p.postType === 'service');
        const treks = posts.filter(p => p.postType === 'trek');
        const plans = posts.filter(p => p.postType === 'plan');

        const itineraries = posts.filter(p => p.postType === 'plan');
        const reviewsWritten = await Review.find({ reviewer: userId, comment: { $exists: true, $ne: "" } }).populate('host', 'firstname lastname avatar').populate('post', 'title postType').sort({ createdAt: -1 });

        let reviewsReceived = [];
        let reviewStats = null;
        if (user.role === 'host') {
            const currentUserIdStr = req.user?.userId?.toString();
            const allHostReviews = await Review.find({ host: userId }).populate('reviewer', 'firstname lastname avatar').populate('post', 'title postType').sort({ createdAt: -1 });
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

        const currentUserIdStr = req.user?.userId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === userId || req.user?.role === 'admin'));
        const userData = getUserFields(user, isOwnProfileOrAdmin);
        userData.isFriend = currentUserIdStr && (user.friends || []).some(id => id && id.toString() === currentUserIdStr);
        userData.isRequestedFriend = currentUserIdStr && (user.friendRequests || []).some(id => id && id.toString() === currentUserIdStr);

        res.status(200).json({
            success: true,
            data: {
                user: userData,
                stats, 
                posts: { all: posts, experiences, services, treks, plans }, 
                itineraries,
                reviews: { written: reviewsWritten, received: user.role === 'host' ? reviewsReceived : [] },
                reviewStats: user.role === 'host' ? reviewStats : null
            }
        });
    } catch (error) {
        console.error("Profile fetch error (getCompleteProfile):", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to fetch complete profile",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
exports.getTopRatedHosts = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
        const { limit = 100, page = 1, minRating = 0, location } = req.query;
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

        return res.status(200).json({
            success: true,
            count: topRatedHosts.length,
            total: totalHostsCount,
            page: Number(page),
            totalPages: Math.ceil(totalHostsCount / limitValue) || 1,
            hosts: topRatedHosts
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching top-rated hosts" });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -otp -otpExpires');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        
        const currentUserIdStr = req.user?.userId?.toString();
        const isOwnProfileOrAdmin = !!(currentUserIdStr && (currentUserIdStr === req.params.id || req.user?.role === 'admin'));

        let isFollowing = false, isRequested = false;
        if (currentUserIdStr && req.params.id !== currentUserIdStr) {
            isFollowing = (user.friends || []).some(id => id.toString() === currentUserIdStr);
            isRequested = (user.friendRequests || []).some(id => id.toString() === currentUserIdStr);
        }
        
        const userData = getUserFields(user, isOwnProfileOrAdmin);
        return res.status(200).json({
            success: true,
            user: { ...userData, isFollowing, isRequested }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching user" });
    }
};

exports.deleteMyAccount = async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 1. Delete Avatar from S3
        if (user.avatar && user.avatar.public_id) {
            try { await deleteFromS3(user.avatar.public_id); } catch (err) {}
        }

        // 2. Delete Host Documents (Aadhaar) from S3
        if (user.hostDetails?.aadhaarCard) {
            if (Array.isArray(user.hostDetails.aadhaarCard)) {
                for (const doc of user.hostDetails.aadhaarCard) {
                    if (doc.public_id) {
                        try { await deleteFromS3(doc.public_id); } catch (err) {}
                    }
                }
            } else if (user.hostDetails.aadhaarCard.public_id) {
                try { await deleteFromS3(user.hostDetails.aadhaarCard.public_id); } catch (err) {}
            }
        }

        // 3. Delete all Posts and their media from S3
        const userPosts = await Post.find({ user: userId });
        for (const post of userPosts) {
            // Cleanup Photos
            if (post.photos && post.photos.length > 0) {
                for (const img of post.photos) {
                    if (img.public_id) {
                        try { await deleteFromS3(img.public_id); } catch (err) {}
                    }
                }
            }
            // Cleanup Videos
            if (post.videos && post.videos.length > 0) {
                for (const vid of post.videos) {
                    if (vid.public_id) {
                        try { await deleteFromS3(vid.public_id); } catch (err) {}
                    }
                }
            }
        }
        await Post.deleteMany({ user: userId });

        // 4. Delete all Community Posts and their media
        const userCommunityPosts = await CommunityPost.find({ user: userId });
        for (const cp of userCommunityPosts) {
            if (cp.media && cp.media.length > 0) {
                for (const m of cp.media) {
                    if (m.public_id) {
                        try { await deleteFromS3(m.public_id); } catch (err) {}
                    }
                }
            }
        }
        await CommunityPost.deleteMany({ user: userId });

        // 5. Itineraries are deleted as part of Post.deleteMany

        // 6. Delete all Bookings (where user is host or guest)
        await Booking.deleteMany({ $or: [{ guest: userId }, { host: userId }] });

        // 7. Delete all Reviews (written by user or about user) and recalculate post ratings
        const userSubmittedReviews = await Review.find({ reviewer: userId, post: { $ne: null } });
        const affectedPostIds = [...new Set(userSubmittedReviews.map(r => r.post?.toString()).filter(Boolean))];

        await Review.deleteMany({ $or: [{ reviewer: userId }, { host: userId }] });

        for (const postId of affectedPostIds) {
            try {
                const remainingReviews = await Review.find({ post: postId });
                const count = remainingReviews.length;
                const average = count > 0 
                    ? Math.round((remainingReviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 
                    : 0;
                await Post.findByIdAndUpdate(postId, {
                    'rating.average': average,
                    'rating.count': count
                });
            } catch (err) {
                console.error("Error recalculating post rating on account deletion:", err);
            }
        }

        // 8. Delete all Notifications
        await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

        // 9. Delete all Conversations and their Messages
        const userConversations = await Conversation.find({ participants: userId });
        for (const conv of userConversations) {
            await Message.deleteMany({ conversationId: conv._id });
        }
        await Conversation.deleteMany({ participants: userId });

        // 9. Remove user from all friends' lists and request lists
        await User.updateMany(
            { $or: [{ friends: userId }, { friendRequests: userId }] },
            { $pull: { friends: userId, friendRequests: userId } }
        );

        // 10. Finally, delete the user record
        await User.findByIdAndDelete(userId);

        res.status(200).json({
            success: true,
            message: "Account and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Account deletion error:", error);
        res.status(500).json({ success: false, message: "Failed to delete account" });
    }
};
