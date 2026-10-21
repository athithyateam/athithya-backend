const { Post, User, Notification } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const { upload, deleteFile } = require("../../services/storageService");
const { notifyAdmins } = require("../../utils/notifyAdminHelper");

exports.updatePost = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        if (post.user.toString() !== req.user.userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "You can only edit your own posts" });
        }

        const {
            title, subtitle, description, longDescription, location, price, amenities,
            capacity, availability, categories, isFeatured, status,
            difficulty, duration, privacyPolicy, discounts, season,
            existingPhotos: existingPhotosStr, existingVideos: existingVideosStr,
            planName, priceTotal, pricePerPerson, maxPeople
        } = req.body;

        const existingPhotos = parseIfJson(existingPhotosStr) || [];
        const existingVideos = parseIfJson(existingVideosStr) || [];

        const isLive = post.status === 'active';
        const isHost = req.user.role !== 'admin';

        // Only delete from S3 if we're not a host editing a live post
        if (!isLive || !isHost) {
            const currentPhotoIds = existingPhotos.map(p => p.public_id).filter(id => id);
            for (const photo of (post.photos || [])) {
                if (photo.public_id && !currentPhotoIds.includes(photo.public_id)) {
                    await deleteFile(photo.public_id);
                }
            }
            const currentVideoIds = existingVideos.map(v => v.public_id).filter(id => id);
            for (const video of (post.videos || [])) {
                if (video.public_id && !currentVideoIds.includes(video.public_id)) {
                    await deleteFile(video.public_id);
                }
            }
        }

        let photos = [];
        if (req.body.photos) {
            photos = parseIfJson(req.body.photos) || [];
        } else {
            photos = [...existingPhotos];
        }

        let videos = [];
        if (req.body.videos) {
            videos = parseIfJson(req.body.videos) || [];
        } else {
            videos = [...existingVideos];
        }

        let newPhotos = [];
        if (req.files && req.files["photos"]) {
            for (const file of req.files["photos"]) {
                const result = await upload(file, "posts");
                newPhotos.push({ url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type || 'image' });
            }
        }
        let newVideos = [];
        if (req.files && req.files["videos"]) {
            for (const file of req.files["videos"]) {
                const result = await upload(file, "posts");
                newVideos.push({ url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type || 'video' });
            }
        }

        photos = [...photos, ...newPhotos];
        videos = [...videos, ...newVideos];

        // Validate S3 origin for photo and video URLs
        const bucketName = process.env.AWS_BUCKET_NAME || '';
        const isValidUrl = (item) => {
            const urlStr = typeof item === 'string' ? item : item?.url;
            if (!urlStr || typeof urlStr !== 'string') return false;
            if (urlStr.startsWith('/')) return true;
            return urlStr.includes('amazonaws.com') && urlStr.includes(bucketName);
        };

        if (photos.some(p => !isValidUrl(p)) || videos.some(v => !isValidUrl(v))) {
            return res.status(400).json({ success: false, message: "Invalid media URL. All photos and videos must be hosted on Athithya's S3 storage." });
        }

        if (isHost && isLive) {
            // Save updates in pendingUpdate
            const pending = {};
            if (title) pending.title = title;
            if (subtitle) pending.subtitle = subtitle;
            if (description) pending.description = description;
            if (longDescription !== undefined) pending.longDescription = longDescription;
            if (location) pending.location = { ...post.location, ...parseIfJson(location) };
            if (price || priceTotal || pricePerPerson) {
                pending.price = { ...post.price, ...parseIfJson(price) };
                if (priceTotal) pending.price.total = Number(priceTotal);
                if (pricePerPerson) pending.price.perPerson = Number(pricePerPerson);
            }
            if (amenities) pending.amenities = parseIfJson(amenities);
            if (privacyPolicy) pending.privacyPolicy = parseIfJson(privacyPolicy);
            if (capacity || maxPeople) {
                pending.capacity = { ...post.capacity, ...parseIfJson(capacity) };
                if (maxPeople) pending.capacity.maxPeople = Number(maxPeople);
            }
            if (availability) pending.availability = { ...post.availability, ...parseIfJson(availability) };
            if (categories) pending.categories = parseIfJson(categories);
            if (difficulty) pending.difficulty = difficulty;
            if (duration || req.body.minutes || req.body.hours || req.body.days) {
                const parsedDur = parseIfJson(duration) || {};
                if (req.body.minutes || req.body.minutes === 0) parsedDur.minutes = Number(req.body.minutes);
                if (req.body.hours || req.body.hours === 0) parsedDur.hours = Number(req.body.hours);
                if (req.body.days || req.body.days === 0) parsedDur.days = Number(req.body.days);
                pending.duration = parsedDur;
            }
            if (isFeatured !== undefined) pending.isFeatured = isFeatured === 'true' || isFeatured === true;
            if (discounts !== undefined) pending.discounts = parseIfJson(discounts) || [];
            if (season !== undefined) pending.season = parseIfJson(season) || undefined;
            if (planName) pending.plan = { ...(post.plan || {}), name: planName };
            
            pending.photos = photos;
            pending.videos = videos;

            post.pendingUpdate = pending;
            await post.save();

            // Fetch host info for email
            const hostUser = await User.findById(req.user.userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

            const emailSubject = `Experience Update Submitted - ${post.title}`;
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: #C59A2F; margin-top: 0;">Experience Update Pending Approval</h2>
                        <p style="color: #333; font-size: 15px;">Host <strong>${hostName}</strong> has submitted updates for live experience <strong>"${post.title}"</strong>.</p>
                        <p style="color: #777; font-size: 12px; margin-top: 20px;">Please log in to the admin panel to review and approve or reject these changes.</p>
                    </div>
                </div>
            `;

            notifyAdmins(req, {
                senderId: req.user.userId,
                title: "Experience Update Pending Approval",
                message: `Host ${hostName} submitted changes to "${post.title}" for your review.`,
                link: `/admin?reviewId=${post._id}`,
                type: "info",
                emailSubject: emailSubject,
                emailHtml: emailHtml,
                metadata: { postId: post._id, userId: req.user.userId }
            });

            return res.status(200).json({ success: true, message: "Changes submitted for admin approval. The experience remains active with original details.", post });
        } else {
            // Admin or not live post: update directly
            if (title) post.title = title;
            if (subtitle) post.subtitle = subtitle;
            if (description) post.description = description;
            if (longDescription !== undefined) post.longDescription = longDescription;
            if (location) post.location = { ...post.location, ...parseIfJson(location) };
            if (price || priceTotal || pricePerPerson) {
                post.price = { ...post.price, ...parseIfJson(price) };
                if (priceTotal) post.price.total = Number(priceTotal);
                if (pricePerPerson) post.price.perPerson = Number(pricePerPerson);
            }
            if (amenities) post.amenities = parseIfJson(amenities);
            if (privacyPolicy) post.privacyPolicy = parseIfJson(privacyPolicy);
            if (capacity || maxPeople) {
                post.capacity = { ...post.capacity, ...parseIfJson(capacity) };
                if (maxPeople) post.capacity.maxPeople = Number(maxPeople);
            }
            if (availability) post.availability = { ...post.availability, ...parseIfJson(availability) };
            if (categories) post.categories = parseIfJson(categories);
            if (difficulty) post.difficulty = difficulty;
            if (duration || req.body.minutes || req.body.hours || req.body.days) {
                const parsedDur = parseIfJson(duration) || {};
                if (req.body.minutes || req.body.minutes === 0) parsedDur.minutes = Number(req.body.minutes);
                if (req.body.hours || req.body.hours === 0) parsedDur.hours = Number(req.body.hours);
                if (req.body.days || req.body.days === 0) parsedDur.days = Number(req.body.days);
                post.duration = parsedDur;
            }
            if (isFeatured !== undefined) post.isFeatured = isFeatured === 'true' || isFeatured === true;
            if (discounts !== undefined) post.discounts = parseIfJson(discounts) || [];
            if (season !== undefined) post.season = parseIfJson(season) || undefined;
            if (planName) post.plan = { ...(post.plan || {}), name: planName };
            
            post.photos = photos;
            post.videos = videos;

            // If a host edits a non-live post, send it back to pending
            if (isHost) {
                post.status = 'pending';
            } else if (status) {
                post.status = status;
            }
            post.pendingUpdate = null;

            await post.save();

            // Notify all admins if a host submitted a non-live post for re-approval
            if (isHost) {
                try {
                    const admins = await User.find({ role: 'admin' });
                    const notifications = admins.map(admin => ({
                        recipient: admin._id,
                        sender: req.user.userId,
                        title: "Experience Re-submitted for Approval",
                        message: `A host has updated and re-submitted "${post.title}" for your review.`,
                        type: 'info',
                        link: `/admin?reviewId=${post._id}`,
                        metadata: { postId: post._id, userId: req.user.userId }
                    }));
                    await Notification.insertMany(notifications);
                } catch (notifErr) {
                    console.error("Failed to notify admins about post re-submission:", notifErr);
                }
            }

            return res.status(200).json({ success: true, message: "Post updated successfully", post });
        }
    } catch (error) {
        console.error("Update post error:", error);
        return res.status(500).json({ success: false, message: "Error updating post", error: error.message });
    }
};

exports.updatePostStatus = async (req, res) => {
    try {
        const { status, remarks } = req.body;
        if (!['active', 'inactive', 'archived', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

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
        } else {
            post.status = status;
        }

        if (remarks !== undefined) {
            post.adminRemarks = remarks;
        }

        await post.save();
        return res.status(200).json({ success: true, message: `Status updated to ${status}`, post });
    } catch (error) {
        console.error("Error updating status:", error);
        return res.status(500).json({ success: false, message: "Error updating status" });
    }
};

exports.requestHidePost = async (req, res) => {
    try {
        const { reason } = req.body;

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        if (post.user.toString() !== req.user.userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "You can only hide or unhide your own posts" });
        }

        const isCurrentlyHidden = Boolean(post.isHidden);

        if (isCurrentlyHidden) {
            // UNHIDE: Direct unhide without admin approval requirement
            post.isHidden = false;
            post.hideRequested = false;
            post.unhideRequested = false;
            post.hideReason = "";
            await post.save();

            return res.status(200).json({
                success: true,
                message: "Experience unhidden successfully and is now active on the platform.",
                isHidden: false,
                hideRequested: false,
                unhideRequested: false
            });
        }

        // HIDE: Requires reason and sends request to admin for review
        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, message: "Reason is required to hide an experience." });
        }

        post.hideRequested = true;
        post.unhideRequested = false;
        post.hideReason = reason.trim();

        await post.save();

        // Fetch host info for email notification
        const hostUser = await User.findById(req.user.userId);
        const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

        const emailSubject = `Experience Hide Request - ${post.title}`;
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #C59A2F; margin-top: 0;">Experience Hide Request</h2>
                    <p style="color: #333; font-size: 15px;">Host <strong>${hostName}</strong> has requested to hide their experience <strong>"${post.title}"</strong>.</p>
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; margin-top: 15px;">
                        <strong style="color: #C59A2F;">Host Reason:</strong>
                        <p style="margin: 5px 0 0 0; color: #555; font-size: 14px; white-space: pre-wrap;">"${reason.trim()}"</p>
                    </div>
                    <p style="color: #777; font-size: 12px; margin-top: 20px;">Please log in to the admin panel to review and approve or reject this request.</p>
                </div>
            </div>
        `;

        notifyAdmins(req, {
            senderId: req.user.userId,
            title: `Experience Hide Request`,
            message: `Host ${hostName} requested to hide "${post.title}". Reason: "${reason.trim()}"`,
            link: `/admin?tab=approvals`,
            type: "info",
            emailSubject: emailSubject,
            emailHtml: emailHtml,
            metadata: { postId: post._id, userId: req.user.userId }
        });

        return res.status(200).json({
            success: true,
            message: `Request to hide experience submitted for admin review.`,
            hideRequested: post.hideRequested,
            unhideRequested: false
        });
    } catch (error) {
        console.error("Error processing hide/unhide:", error);
        return res.status(500).json({ success: false, message: "Error processing hide/unhide request" });
    }
};
