const { Post, Booking, Notification, HostAuditLog } = require("../../db/mongoose");
const { deleteFile } = require("../../services/storageService");
const { sendHtmlEmail } = require("../../services/emailService");
const { notificationService } = require("../../services/notificationService");

exports.getAllExperiences = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || "";
        const category = req.query.category || "";
        const host = req.query.host || "";
        
        const { User } = require("../../db/mongoose");
        let query = {};

        if (category) {
            const lc = category.trim().toLowerCase();
            if (lc === "others" || lc === "other") {
                query.categories = { $in: ["Others", "Other", "Rock Climbing", "Flyboarding", "rock-climbing", "flyboarding"] };
            } else {
                query.categories = category;
            }
        }
        if (host) {
            query.user = host;
        }

        if (search) {
            const userIds = await User.find({
                $or: [
                    { firstname: { $regex: search, $options: "i" } },
                    { lastname: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } }
                ]
            }).select('_id');

            const searchConditions = [
                { title: { $regex: search, $options: "i" } },
                { "location.city": { $regex: search, $options: "i" } },
                { user: { $in: userIds } }
            ];

            if (Object.keys(query).length > 0) {
                query = {
                    $and: [
                        query,
                        { $or: searchConditions }
                    ]
                };
            } else {
                query = { $or: searchConditions };
            }
        }

        const totalDocuments = await Post.countDocuments(query);
        const totalPages = Math.ceil(totalDocuments / limit);

        const experiences = await Post.find(query)
            .populate("user", "firstname lastname avatar email")
            .select("-policies -accessibility -what_to_bring -itinerary -reactions -pendingUpdate")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
            
        res.json({ 
            success: true, 
            experiences, 
            totalPages, 
            currentPage: page,
            totalDocuments 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getPendingExperiences = async (req, res) => {
    try {
        const experiences = await Post.find({
            $or: [
                { status: "pending" },
                { pendingUpdate: { $ne: null } },
                { deleteRequested: true },
                { hideRequested: true },
                { unhideRequested: true }
            ]
        }).populate("user", "firstname lastname avatar email");

        const mapped = experiences.map(exp => {
            const expObj = exp.toObject();
            if (expObj.deleteRequested) {
                expObj.isDeleteRequested = true;
            }
            if (expObj.hideRequested) {
                expObj.isHideRequested = true;
            }
            if (expObj.unhideRequested) {
                expObj.isUnhideRequested = true;
            }
            if (expObj.pendingUpdate) {
                return {
                    ...expObj,
                    ...expObj.pendingUpdate,
                    isPendingUpdate: true,
                    originalFields: {
                        title: exp.title,
                        subtitle: exp.subtitle,
                        description: exp.description,
                        longDescription: exp.longDescription,
                        location: exp.location,
                        price: exp.price,
                        amenities: exp.amenities,
                        privacyPolicy: exp.privacyPolicy,
                        capacity: exp.capacity,
                        availability: exp.availability,
                        categories: exp.categories,
                        difficulty: exp.difficulty,
                        duration: exp.duration,
                        photos: exp.photos,
                        videos: exp.videos,
                        plan: exp.plan
                    }
                };
            }
            return expObj;
        });

        res.json({ success: true, experiences: mapped });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateExperience = async (req, res) => {
    try {
        const updates = req.body;
        const post = await Post.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
        if (!post) return res.status(404).json({ success: false, message: "Experience not found" });
        res.json({ success: true, message: "Experience updated successfully", post });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateExperienceStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        if (!['active', 'inactive', 'archived', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const post = await Post.findById(req.params.id).populate('user');
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        const hostUser = post.user;
        const hostEmail = hostUser?.email;
        const hostFirstName = hostUser?.firstname || "Host";

        if (post.deleteRequested) {
            if (status === 'active') {
                const hostId = post.user?._id || post.user;
                const postTitle = post.title;
                // ── 1. Archive to HostAuditLog FIRST (while S3 files still exist) ──
                try {
                    const hostName = post.user ? `${post.user.firstname} ${post.user.lastname}` : "Unknown Host";
                    
                    await HostAuditLog.create({
                        type: "experience_delete",
                        hostId: hostId,
                        hostName: hostName,
                        snapshot: {
                            title: post.title || "",
                            subtitle: post.subtitle || "",
                            description: post.description || "",
                            longDescription: post.longDescription || "",
                            price: post.price,
                            duration: post.duration,
                            location: post.location,
                            capacity: post.capacity,
                            amenities: post.amenities || [],
                            rules: post.privacyPolicy || [],
                            photos: post.photos || [],
                            categories: post.categories || []
                        }
                    });
                    
                    // Prune to only keep last 10 experience_delete records globally
                    const items = await HostAuditLog.find({ type: "experience_delete" }).sort({ createdAt: -1 });
                    if (items.length > 10) {
                        const idsToDelete = items.slice(10).map(item => item._id);
                        await HostAuditLog.deleteMany({ _id: { $in: idsToDelete } });
                    }
                } catch (historyErr) {
                    console.error("Error logging deleted experience to audit log during admin approval:", historyErr);
                }

                // ── 2. Now delete S3 assets and bookings ──
                const assets = [...(post.photos || []), ...(post.videos || [])];
                for (const asset of assets) {
                    if (asset.public_id) {
                        await deleteFile(asset.public_id);
                    }
                }
                await Booking.updateMany(
                    { post: post._id, status: { $in: ['pending', 'accepted', 'in_progress', 'cancel_requested'] } },
                    { $set: { status: 'cancelled' } }
                );

                // ── 3. Finally delete the post document ──
                await Post.findByIdAndDelete(post._id);

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: req.user.userId,
                    title: "Experience Deletion Approved",
                    message: `The experience "${postTitle}" you requested for deletion has successfully been approved and deleted.`,
                    type: "success"
                });

                // Send email
                if (hostEmail) {
                    const subject = "Experience Deletion Approved - Athithya";
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: #2e7d32; margin-top: 0;">Experience Deletion Approved</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">
                                    Hi ${hostFirstName},
                                </p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    The experience "${postTitle}" you requested for deletion has successfully been approved and deleted.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion approved email:", err));
                }

                return res.json({ success: true, message: "Experience deletion request approved and deleted successfully" });
            } else if (status === 'inactive') {
                post.deleteRequested = false;
                await post.save();

                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user.userId,
                    title: "Experience Deletion Rejected",
                    message: `The deletion request for your experience "${post.title}" was reviewed and rejected. The experience remains active.`,
                    type: "info",
                    link: `/profile/${post.user?._id || post.user}`
                });

                // Send email
                if (hostEmail) {
                    const subject = "Experience Deletion Rejected - Athithya";
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: #c62828; margin-top: 0;">Experience Deletion Rejected</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">
                                    Hi ${hostFirstName},
                                </p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    The deletion request for your experience "${post.title}" was reviewed and rejected. The experience remains active.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion rejected email:", err));
                }

                return res.json({ success: true, message: "Experience deletion request rejected. Post remains active.", post });
            }
        }

        if (post.hideRequested) {
            if (status === 'active') {
                post.isHidden = true;
                post.hideRequested = false;
                post.unhideRequested = false;
                await post.save();

                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user.userId,
                    title: "Experience Hide Request Approved",
                    message: `Your request to hide experience "${post.title}" has been approved by admin.`,
                    type: "info",
                    link: `/profile/${post.user?._id || post.user}`
                });

                return res.json({ success: true, message: "Experience hide request approved successfully", post });
            } else if (status === 'inactive') {
                post.hideRequested = false;
                await post.save();

                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user.userId,
                    title: "Experience Hide Request Rejected",
                    message: `Your request to hide experience "${post.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${post.user?._id || post.user}`
                });

                return res.json({ success: true, message: "Experience hide request rejected", post });
            }
        }

        if (post.unhideRequested) {
            if (status === 'active') {
                post.isHidden = false;
                post.unhideRequested = false;
                post.hideRequested = false;
                await post.save();

                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user.userId,
                    title: "Experience Unhide Request Approved",
                    message: `Your request to unhide experience "${post.title}" has been approved by admin. It is now live on the platform.`,
                    type: "success",
                    link: `/profile/${post.user?._id || post.user}`
                });

                return res.json({ success: true, message: "Experience unhide request approved successfully", post });
            } else if (status === 'inactive') {
                post.unhideRequested = false;
                await post.save();

                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user.userId,
                    title: "Experience Unhide Request Rejected",
                    message: `Your request to unhide experience "${post.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${post.user?._id || post.user}`
                });

                return res.json({ success: true, message: "Experience unhide request rejected", post });
            }
        }

        if (status === 'active') {
            if (post.pendingUpdate) {
                // Apply all fields from pendingUpdate to the main post fields
                const fieldsToCopy = [
                    'title', 'subtitle', 'description', 'longDescription', 'location', 'price',
                    'amenities', 'capacity', 'availability', 'categories', 'difficulty',
                    'duration', 'privacyPolicy', 'discounts', 'season', 'plan', 'photos', 'videos', 'isFeatured'
                ];
                fieldsToCopy.forEach(field => {
                    if (post.pendingUpdate[field] !== undefined) {
                        post[field] = post.pendingUpdate[field];
                    }
                });
                post.pendingUpdate = null;
            }
            post.status = 'active';
            post.approvedAt = new Date();
            post.isHidden = false;
            post.deleteRequested = false;
            post.hideRequested = false;
            post.unhideRequested = false;
        } else if (status === 'inactive') {
            // Rejecting the changes
            if (post.status === 'active') {
                // If it was already active, keep it active but clear pendingUpdate
                post.pendingUpdate = null;
            } else {
                // Otherwise, mark it inactive and clear pendingUpdate
                post.status = 'inactive';
                post.pendingUpdate = null;
            }
            post.deleteRequested = false;
            post.hideRequested = false;
            post.unhideRequested = false;
        } else {
            post.status = status;
        }

        if (remarks !== undefined) {
            post.adminRemarks = remarks;
        }

        await post.save();
        await Post.updateOne({ _id: post._id }, { $unset: { pendingUpdate: 1 } });

        // Handle standard post approval/rejection notifications
        if (status === 'active' || status === 'inactive') {
            const isApproved = status === 'active';
            const emailSubject = isApproved ? "Experience Approved & Published! - Athithya" : "Experience Submission Update - Athithya";
            const emailMessage = isApproved
                ? `Congratulations! Your experience "${post.title}" has been approved and is now active on Athithya.`
                : `Your experience "${post.title}" was reviewed and rejected. ${remarks ? `Remarks: ${remarks}` : "Please check your details and try again."}`;

            try {
                await notificationService.sendNotification({
                    recipient: post.user?._id || post.user,
                    sender: req.user?.userId || req.user?.id,
                    title: isApproved ? "Experience Approved" : "Experience Rejected",
                    message: emailMessage,
                    type: isApproved ? "success" : "error",
                    link: isApproved ? `/post/${post._id}` : `/profile/${post.user?._id || post.user}`
                });

                if (hostEmail) {
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: ${isApproved ? '#2e7d32' : '#c62828'}; margin-top: 0;">${isApproved ? 'Experience Approved' : 'Experience Rejected'}</h2>
                                <p style="color: #333; font-size: 16px; line-height: 1.6;">
                                    Hi ${hostFirstName},
                                </p>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    ${emailMessage}
                                </p>
                                ${isApproved ? `
                                <div style="margin-top: 30px; text-align: center;">
                                    <a href="https://athithya.in" style="background-color: #C59A2F; color: #fff; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 14px;">View Your Experience</a>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, emailSubject, htmlContent).catch(err => console.error("Failed to send experience status email:", err));
                }
            } catch (notifErr) {
                console.error("Error creating experience approval notification:", notifErr);
            }
        }

        res.json({ success: true, message: `Experience status updated to ${status}`, post });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteExperience = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: "Experience not found" });

        // Delete S3 assets (photos/videos)
        const assets = [...(post.photos || []), ...(post.videos || [])];
        for (const asset of assets) {
                await deleteFile(asset.public_id);
        }

        // Cascade soft-delete active bookings
        await Booking.updateMany(
            { post: req.params.id, status: { $in: ['pending', 'accepted', 'in_progress', 'cancel_requested'] } },
            { $set: { status: 'cancelled' } }
        );

        // Remove any HostAuditLog audit records belonging to this host for this experience title
        await HostAuditLog.deleteMany({
            type: "experience_delete",
            hostId: post.user,
            $or: [
                { 'snapshot.title': post.title },
                { experienceTitle: post.title }
            ]
        });

        await Post.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Experience deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
