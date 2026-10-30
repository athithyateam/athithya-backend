const { Experience, Notification, HostAuditLog, User, SavedExperience } = require("../../db/mongoose");
const { reviewService } = require("../../services/reviewService");
const { bookingService } = require("../../services/bookingService");
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

        const totalDocuments = await Experience.countDocuments(query);
        const totalPages = Math.ceil(totalDocuments / limit);

        const experiences = await Experience.find(query)
            .populate("user", "firstname lastname avatar email")
            .select("-pendingUpdate")
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
        const experiences = await Experience.find({
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
        const experience = await Experience.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
        if (!experience) return res.status(404).json({ success: false, message: "Experience not found" });
        res.json({ success: true, message: "Experience updated successfully", experience });
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

        const experience = await Experience.findById(req.params.id).populate('user');
        if (!experience) return res.status(404).json({ success: false, message: "Experience not found" });

        const hostUser = experience.user;
        const hostEmail = hostUser?.email;
        const hostFirstName = hostUser?.firstname || "Host";

        if (experience.deleteRequested) {
            if (status === 'active') {
                const hostId = experience.user?._id || experience.user;
                const experienceTitle = experience.title;
                // ── 1. Archive to HostAuditLog FIRST (while S3 files still exist) ──
                try {
                    const hostName = experience.user ? `${experience.user.firstname} ${experience.user.lastname}` : "Unknown Host";
                    
                    await HostAuditLog.create({
                        type: "experience_delete",
                        hostId: hostId,
                        hostName: hostName,
                        snapshot: {
                            title: experience.title || "",
                            subtitle: experience.subtitle || "",
                            description: experience.description || "",
                            longDescription: experience.longDescription || "",
                            price: experience.price,
                            duration: experience.duration,
                            location: experience.location,
                            capacity: experience.capacity,
                            amenities: experience.amenities || [],
                            rules: experience.privacyPolicy || [],
                            photos: experience.photos || [],
                            categories: experience.categories || []
                        }
                    });
                    
                    const items = await HostAuditLog.find({ type: "experience_delete" }).sort({ createdAt: -1 });
                    if (items.length > 10) {
                        const idsToDelete = items.slice(10).map(item => item._id);
                        await HostAuditLog.deleteMany({ _id: { $in: idsToDelete } });
                    }
                } catch (historyErr) {
                    console.error("Error logging deleted experience to audit log during admin approval:", historyErr);
                }

                // ── 2. Now delete S3 assets and bookings ──
                const assets = [...(experience.photos || []), ...(experience.videos || [])];
                for (const asset of assets) {
                    if (asset.public_id) {
                        await deleteFile(asset.public_id);
                    }
                }
                await bookingService.cancelBookingsForExperience(experience._id);

                // ── 3. Clean bookmarks and reviews, then delete experience ──
                await SavedExperience.deleteMany({ experience: experience._id });
                await reviewService.deleteExperienceReviews(experience._id);
                await Experience.findByIdAndDelete(experience._id);

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: req.user.userId,
                    title: "Experience Deletion Approved",
                    message: `The experience "${experienceTitle}" you requested for deletion has successfully been approved and deleted.`,
                    type: "success"
                });

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
                                    The experience "${experienceTitle}" you requested for deletion has successfully been approved and deleted.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion approved email:", err));
                }

                return res.json({ success: true, message: "Experience deletion request approved and deleted successfully" });
            } else if (status === 'inactive') {
                experience.deleteRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user.userId,
                    title: "Experience Deletion Rejected",
                    message: `The deletion request for your experience "${experience.title}" was reviewed and rejected. The experience remains active.`,
                    type: "info",
                    link: `/profile/${experience.user?._id || experience.user}`
                });

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
                                    The deletion request for your experience "${experience.title}" was reviewed and rejected. The experience remains active.
                                </p>
                            </div>
                        </div>
                    `;
                    sendHtmlEmail(hostEmail, subject, htmlContent).catch(err => console.error("Failed to send deletion rejected email:", err));
                }

                return res.json({ success: true, message: "Experience deletion request rejected. Experience remains active.", experience });
            }
        }

        if (experience.hideRequested) {
            if (status === 'active') {
                experience.isHidden = true;
                experience.hideRequested = false;
                experience.unhideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user.userId,
                    title: "Experience Hide Request Approved",
                    message: `Your request to hide experience "${experience.title}" has been approved by admin.`,
                    type: "info",
                    link: `/profile/${experience.user?._id || experience.user}`
                });

                return res.json({ success: true, message: "Experience hide request approved successfully", experience });
            } else if (status === 'inactive') {
                experience.hideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user.userId,
                    title: "Experience Hide Request Rejected",
                    message: `Your request to hide experience "${experience.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${experience.user?._id || experience.user}`
                });

                return res.json({ success: true, message: "Experience hide request rejected", experience });
            }
        }

        if (experience.unhideRequested) {
            if (status === 'active') {
                experience.isHidden = false;
                experience.unhideRequested = false;
                experience.hideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user.userId,
                    title: "Experience Unhide Request Approved",
                    message: `Your request to unhide experience "${experience.title}" has been approved by admin. It is now live on the platform.`,
                    type: "success",
                    link: `/profile/${experience.user?._id || experience.user}`
                });

                return res.json({ success: true, message: "Experience unhide request approved successfully", experience });
            } else if (status === 'inactive') {
                experience.unhideRequested = false;
                await experience.save();

                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user.userId,
                    title: "Experience Unhide Request Rejected",
                    message: `Your request to unhide experience "${experience.title}" was reviewed and rejected.`,
                    type: "info",
                    link: `/profile/${experience.user?._id || experience.user}`
                });

                return res.json({ success: true, message: "Experience unhide request rejected", experience });
            }
        }

        if (status === 'active') {
            if (experience.pendingUpdate) {
                const fieldsToCopy = [
                    'title', 'subtitle', 'description', 'longDescription', 'location', 'price',
                    'amenities', 'capacity', 'availability', 'categories', 'difficulty',
                    'duration', 'privacyPolicy', 'discounts', 'season', 'plan', 'photos', 'videos', 'isFeatured'
                ];
                fieldsToCopy.forEach(field => {
                    if (experience.pendingUpdate[field] !== undefined) {
                        experience[field] = experience.pendingUpdate[field];
                    }
                });
                experience.pendingUpdate = null;
            }
            experience.status = 'active';
            experience.approvedAt = new Date();
            experience.isHidden = false;
            experience.deleteRequested = false;
            experience.hideRequested = false;
            experience.unhideRequested = false;
        } else if (status === 'inactive') {
            if (experience.status === 'active') {
                experience.pendingUpdate = null;
            } else {
                experience.status = 'inactive';
                experience.pendingUpdate = null;
            }
            experience.deleteRequested = false;
            experience.hideRequested = false;
            experience.unhideRequested = false;
        } else {
            experience.status = status;
        }

        if (remarks !== undefined) {
            experience.adminRemarks = remarks;
        }

        await experience.save();
        await Experience.updateOne({ _id: experience._id }, { $unset: { pendingUpdate: 1 } });

        if (status === 'active' || status === 'inactive') {
            const isApproved = status === 'active';
            const emailSubject = isApproved ? "Experience Approved & Published! - Athithya" : "Experience Submission Update - Athithya";
            const emailMessage = isApproved
                ? `Congratulations! Your experience "${experience.title}" has been approved and is now active on Athithya.`
                : `Your experience "${experience.title}" was reviewed and rejected. ${remarks ? `Remarks: ${remarks}` : "Please check your details and try again."}`;

            try {
                await notificationService.sendNotification({
                    recipient: experience.user?._id || experience.user,
                    sender: req.user?.userId || req.user?.id,
                    title: isApproved ? "Experience Approved" : "Experience Rejected",
                    message: emailMessage,
                    type: isApproved ? "success" : "error",
                    link: isApproved ? `/experiences/${experience._id}` : `/profile/${experience.user?._id || experience.user}`
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

        res.json({ success: true, message: `Experience status updated to ${status}`, experience });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteExperience = async (req, res) => {
    try {
        const experience = await Experience.findById(req.params.id);
        if (!experience) return res.status(404).json({ success: false, message: "Experience not found" });

        const assets = [...(experience.photos || []), ...(experience.videos || [])];
        for (const asset of assets) {
            if (asset.public_id) {
                await deleteFile(asset.public_id);
            }
        }

        await bookingService.cancelBookingsForExperience(req.params.id);

        await HostAuditLog.deleteMany({
            type: "experience_delete",
            hostId: experience.user,
            $or: [
                { 'snapshot.title': experience.title },
                { experienceTitle: experience.title }
            ]
        });

        await SavedExperience.deleteMany({ experience: req.params.id });
        await reviewService.deleteExperienceReviews(req.params.id);
        await Experience.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Experience deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
