const { Post, User, Notification } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const { upload } = require("../../services/storageService");
const { sendHtmlEmail } = require("../../utils/emailService");
const { notifyAdmins } = require("../../utils/notifyAdminHelper");

exports.createPost = async (req, res) => {
    try {
        const hostUser = await User.findById(req.user.userId);
        if (!hostUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Restrict experience creation to approved hosts only
        if (req.user.role === 'host' && hostUser.hostStatus !== 'approved') {
            return res.status(403).json({
                success: false,
                message: "You cannot add experiences until your host account is verified and approved by an admin. If you have already submitted for verification, please wait for admin approval."
            });
        }

        const {
            postType, title, subtitle, description, longDescription, location,
            price, amenities, capacity, availability,
            planName, priceTotal, pricePerPerson, maxPeople,
            duration, difficulty, categories, isFeatured,
            city, state, country, meetingPoint, days, nights, period, minutes, hours,
            privacyPolicy, discounts
        } = req.body;

        if (!title || !description) {
            return res.status(400).json({ success: false, message: "Title and description are required" });
        }

        let photoUrls = [];
        let videoUrls = [];

        // Parse photos and videos if sent in body (JSON)
        if (req.body.photos) {
            photoUrls = parseIfJson(req.body.photos) || [];
        }
        if (req.body.videos) {
            videoUrls = parseIfJson(req.body.videos) || [];
        }

        // Validate S3 origin for pre-uploaded photo and video URLs
        const bucketName = process.env.AWS_BUCKET_NAME || '';
        const isValidUrl = (item) => {
            const urlStr = typeof item === 'string' ? item : item?.url;
            if (!urlStr || typeof urlStr !== 'string') return false;
            if (urlStr.startsWith('/')) return true;
            return urlStr.includes('amazonaws.com') && urlStr.includes(bucketName);
        };

        if (photoUrls.some(p => !isValidUrl(p)) || videoUrls.some(v => !isValidUrl(v))) {
            return res.status(400).json({ success: false, message: "Invalid media URL. All photos and videos must be hosted on Athithya's S3 storage." });
        }

        // Multer fallback for backward compatibility
        if (req.files) {
            if (req.files["photos"]) {
                const photosPromises = req.files["photos"].map(file => upload(file, "posts"));
                const photosResults = await Promise.all(photosPromises);
                const uploadedPhotos = photosResults.map(result => ({
                    url: result.secure_url,
                    public_id: result.public_id,
                    resource_type: result.resource_type || 'image'
                }));
                photoUrls = [...photoUrls, ...uploadedPhotos];
            }
            if (req.files["videos"]) {
                const videosPromises = req.files["videos"].map(file => upload(file, "posts"));
                const videosResults = await Promise.all(videosPromises);
                const uploadedVideos = videosResults.map(result => ({
                    url: result.secure_url,
                    public_id: result.public_id,
                    resource_type: result.resource_type || 'video'
                }));
                videoUrls = [...videoUrls, ...uploadedVideos];
            }
        }

        const parsedLocation = parseIfJson(location) || {};
        const locationObj = { ...parsedLocation };
        if (city) locationObj.city = city;
        if (state) locationObj.state = state;
        if (country) locationObj.country = country;
        if (meetingPoint) locationObj.meetingPoint = meetingPoint;

        if (locationObj.coordinates) {
            if (locationObj.coordinates.type === 'Point' &&
                Array.isArray(locationObj.coordinates.coordinates) &&
                locationObj.coordinates.coordinates.length === 2 &&
                locationObj.coordinates.coordinates.every(coord => typeof coord === 'number' && !isNaN(coord))) {
                // Valid
            } else {
                delete locationObj.coordinates;
            }
        }

        const parsedPrice = parseIfJson(price) || {};
        const priceObj = { ...parsedPrice };
        if (priceTotal) priceObj.total = Number(priceTotal);
        if (pricePerPerson) priceObj.perPerson = Number(pricePerPerson);
        if (period) priceObj.period = period;

        const parsedCapacity = parseIfJson(capacity) || {};
        const capacityObj = { ...parsedCapacity };
        if (maxPeople) capacityObj.maxPeople = Number(maxPeople);

        const parsedDuration = parseIfJson(duration) || {};
        const durationObj = { ...parsedDuration };
        if (req.body.minutes !== undefined || minutes !== undefined) durationObj.minutes = Number(req.body.minutes ?? minutes);
        if (req.body.hours !== undefined || hours !== undefined) durationObj.hours = Number(req.body.hours ?? hours);
        if (days) durationObj.days = Number(days);
        if (nights) durationObj.nights = Number(nights);

        const postData = {
            user: req.user.userId,
            userRole: req.user.role,
            postType: postType || req.postTypeDefault,
            title,
            subtitle,
            description,
            longDescription,
            photos: photoUrls,
            videos: videoUrls,
            location: Object.keys(locationObj).length > 0 ? locationObj : undefined,
            plan: planName ? { name: planName } : undefined,
            price: Object.keys(priceObj).length > 0 ? priceObj : undefined,
            amenities: parseIfJson(amenities) || [],
            privacyPolicy: parseIfJson(privacyPolicy) || [],
            capacity: Object.keys(capacityObj).length > 0 ? capacityObj : undefined,
            duration: Object.keys(durationObj).length > 0 ? durationObj : undefined,
            categories: parseIfJson(categories) || [],
            status: 'pending',
            isFeatured: isFeatured === 'true' || isFeatured === true || false,
            discounts: parseIfJson(discounts) || [],
            difficulty: difficulty || undefined,
            availability: parseIfJson(availability),
            season: parseIfJson(req.body.season) || undefined
        };

        const post = await Post.create(postData);

        // Asynchronously sync experience media to Google Drive in background
        setImmediate(async () => {
            try {
                const { syncMediaFromUrl } = require("../../services/googleDriveService");
                let modified = false;
                if (post.photos && Array.isArray(post.photos)) {
                    for (let i = 0; i < post.photos.length; i++) {
                        const p = post.photos[i];
                        if (p.url && !p.googleDriveFileId) {
                            const ext = p.url.split('.').pop().split('?')[0] || "jpg";
                            const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                            const res = await syncMediaFromUrl({
                                url: p.url,
                                fileName: `EXP_${cleanTitle}_${post._id}_photo_${i + 1}.${ext}`,
                                category: 'experiences'
                            });
                            if (res?.fileId) {
                                p.googleDriveFileId = res.fileId;
                                modified = true;
                            }
                        }
                    }
                }
                if (post.videos && Array.isArray(post.videos)) {
                    for (let i = 0; i < post.videos.length; i++) {
                        const v = post.videos[i];
                        if (v.url && !v.googleDriveFileId) {
                            const ext = v.url.split('.').pop().split('?')[0] || "mp4";
                            const cleanTitle = (post.title || "experience").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
                            const res = await syncMediaFromUrl({
                                url: v.url,
                                fileName: `EXP_${cleanTitle}_${post._id}_video_${i + 1}.${ext}`,
                                mimeType: 'video/mp4',
                                category: 'experiences'
                            });
                            if (res?.fileId) {
                                v.googleDriveFileId = res.fileId;
                                modified = true;
                            }
                        }
                    }
                }
                if (modified) {
                    await Post.findByIdAndUpdate(post._id, { photos: post.photos, videos: post.videos });
                }
            } catch (driveErr) {
                console.error("[GoogleDriveSync] Post creation background sync failed:", driveErr.message);
            }
        });

        // Retrieve Host Details
        try {
            const hostUser = await User.findById(req.user.userId);
            const hostname = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "A host";
            const hostEmail = hostUser ? hostUser.email : "N/A";

            // Notify Admin via email
            const adminEmail = "teamsathithya@gmail.com";
            const adminSubject = `New Experience Awaiting Approval - Athithya`;
            
            // Location details formatting
            let locationDetails = "N/A";
            if (post.location) {
                locationDetails = `
                    ${post.location.address || ""}<br/>
                    ${post.location.city || ""}, ${post.location.state || ""}, ${post.location.country || ""}
                `;
            }

            // Price details formatting
            let priceDetails = "N/A";
            if (post.price) {
                const basePrice = post.price.perPerson || post.price.amount || post.price.total || 0;
                const feeRate = basePrice < 2000 ? 0.05 : basePrice <= 5000 ? 0.035 : 0.02;
                const platformFee = Math.round(basePrice * feeRate);
                const guestPrice = basePrice + platformFee;
                priceDetails = `
                    Host Price: ₹${basePrice.toLocaleString()}<br/>
                    Platform Fee: ₹${platformFee.toLocaleString()} (${(feeRate * 100).toFixed(1)}%)<br/>
                    <strong>Final Guest Price: ₹${guestPrice.toLocaleString()}</strong>
                `;
            }

            const adminHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: #333; margin-top: 0;">New Experience Submitted</h2>
                        <p style="color: #555; font-size: 16px; line-height: 1.6;">
                            <strong>${hostname}</strong> has added a new experience in Athithya, and is waiting for approval. Please review his approval.
                        </p>
                        <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Experience Overview</h3>
                        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Title:</td>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #1a1a1a;">${post.title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Category:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${(post.categories || []).join(", ") || "N/A"}</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Host Name:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${hostname} (${hostEmail})</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Location:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${locationDetails}</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Pricing & Fees:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${priceDetails}</td>
                            </tr>
                        </table>

                        <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Description</h3>
                        <div style="margin-top: 10px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; color: #555; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
                            ${post.description}
                        </div>
                    </div>
                </div>
            `;
            notifyAdmins(req, {
                senderId: req.user.userId,
                title: "New Experience Approval Request",
                message: `Host ${hostname} submitted "${post.title}" for approval.`,
                link: `/admin?reviewId=${post._id}`,
                type: "info",
                emailSubject: adminSubject,
                emailHtml: adminHtml,
                metadata: { postId: post._id, userId: req.user.userId }
            });
        } catch (mailErr) {
            console.error("Error sending experience notification:", mailErr);
        }

        return res.status(201).json({ success: true, message: "Post created successfully", post });
    } catch (error) {
        console.error("Create post error:", error);
        return res.status(500).json({ success: false, message: "Error creating post", error: error.message });
    }
};
