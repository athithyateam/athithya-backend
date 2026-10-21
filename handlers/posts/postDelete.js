const { Post, Booking, User, HostHistory } = require("../../db/mongoose");
const { deleteFile } = require("../../services/storageService");
const { deleteMedia } = require("../../services/googleDriveService");
const { notifyAdmins } = require("../../utils/notifyAdminHelper");

exports.deletePost = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        if (post.user.toString() !== req.user.userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "You can only delete your own posts" });
        }

        if (req.user.role !== 'admin') {
            post.deleteRequested = true;
            await post.save();

            const hostUser = await User.findById(req.user.userId);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Host";

            const emailSubject = `Experience Deletion Request - ${post.title}`;
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: #c62828; margin-top: 0;">Experience Deletion Request</h2>
                        <p style="color: #333; font-size: 15px;">Host <strong>${hostName}</strong> has requested to delete their experience <strong>"${post.title}"</strong>.</p>
                        <p style="color: #777; font-size: 12px; margin-top: 20px;">Please log in to the admin panel to review and approve or reject this deletion request.</p>
                    </div>
                </div>
            `;

            notifyAdmins(req, {
                senderId: req.user.userId,
                title: "Experience Deletion Request",
                message: `Host ${hostName} requested to delete experience "${post.title}".`,
                link: `/admin?tab=approvals`,
                type: "warning",
                emailSubject: emailSubject,
                emailHtml: emailHtml,
                metadata: { postId: post._id, userId: req.user.userId }
            });

            return res.status(200).json({ success: true, message: "Deletion request submitted for review", pendingReview: true });
        }

        // ── 1. Archive to HostHistory FIRST (while S3 files still exist) ──
        try {
            const hostUser = await User.findById(post.user);
            const hostName = hostUser ? `${hostUser.firstname} ${hostUser.lastname}` : "Unknown Host";
            
            await HostHistory.create({
                type: "experience_delete",
                hostId: post.user,
                hostName: hostName,
                experienceTitle: post.title || "",
                experienceSubtitle: post.subtitle || "",
                experienceDescription: post.description || "",
                experienceLongDescription: post.longDescription || "",
                experiencePrice: post.price,
                experienceDuration: post.duration,
                experienceLocation: post.location,
                experienceCapacity: post.capacity,
                experienceAmenities: post.amenities || [],
                experienceRules: post.privacyPolicy || [],
                experiencePhotos: post.photos || [],
                experienceCategories: post.categories || []
            });
            
            // Prune to only keep last 10 experience_delete records globally
            const items = await HostHistory.find({ type: "experience_delete" }).sort({ createdAt: -1 });
            if (items.length > 10) {
                const idsToDelete = items.slice(10).map(item => item._id);
                await HostHistory.deleteMany({ _id: { $in: idsToDelete } });
            }
        } catch (historyErr) {
            console.error("Error logging deleted experience to history:", historyErr);
        }

        // ── 2. Now delete S3 assets and Google Drive assets ──
        const assets = [...(post.photos || []), ...(post.videos || [])];
        for (const asset of assets) {
            if (asset.public_id) {
                await deleteFile(asset.public_id);
            }
            if (asset.googleDriveFileId) {
                await deleteMedia(asset.googleDriveFileId);
            }
        }

        // ── 3. Cascade soft-delete active bookings by marking them cancelled, and delete the post document ──
        await Booking.updateMany(
            { post: req.params.id, status: { $in: ['pending', 'accepted', 'in_progress', 'cancel_requested'] } },
            { $set: { status: 'cancelled' } }
        );
        await Post.findByIdAndDelete(req.params.id);
        return res.status(200).json({ success: true, message: "Post deleted successfully" });
    } catch (error) {
        console.error("Delete post error:", error);
        return res.status(500).json({ success: false, message: "Error deleting post" });
    }
};
