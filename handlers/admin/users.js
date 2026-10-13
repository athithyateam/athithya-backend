const { User, HostHistory, Review, Post, Notification } = require("../../db/mongoose");

exports.getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || "";
        const role = req.query.role || "all";
        const skip = (page - 1) * limit;

        const query = {};
        if (role && role !== "all") {
            const normRole = role.replace(/s$/, "");
            query.role = normRole;
        }
        if (search) {
            query.$or = [
                { firstname: { $regex: search, $options: "i" } },
                { lastname: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } }
            ];
        }

        // Parallelize paginated fetch + all three count queries
        const [users, totalUsers, allCount, guestsCount, hostsCount] = await Promise.all([
            User.find(query)
                .select("-password -savedPosts -likedPosts -bookmarkedItineraries -notifications")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(query),
            User.countDocuments({}),
            User.countDocuments({ role: "guest" }),
            User.countDocuments({ role: "host" })
        ]);

        res.json({
            success: true,
            count: users.length,
            totalPages: Math.ceil(totalUsers / limit),
            currentPage: page,
            totalUsers,
            allCount,
            guestsCount,
            hostsCount,
            users
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id, '-password');
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        return res.status(200).json({ success: true, user });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching user" });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const updates = req.body;
        delete updates.password;

        if (updates.verifyBadge) {
            const reqBookings = Number(updates.verifyBadge.requiredBookings) || 1;
            const successCount = Number(updates.verifyBadge.successfulBookingsCount) || 0;
            
            updates.verifyBadge.requiredBookings = reqBookings;
            updates.verifyBadge.successfulBookingsCount = successCount;
            updates.verifyBadge.enabled = successCount >= reqBookings;
        }

        // Sync and validate hostDetails if provided
        if (updates.hostDetails) {
            if (updates.hostDetails.yearsOfExperience !== undefined) {
                updates.hostDetails.yearsOfExperience = Math.min(30, Math.max(0, parseInt(updates.hostDetails.yearsOfExperience, 10) || 0));
            }

            const existingUser = await User.findById(req.params.id);
            if (existingUser) {
                updates.hostDetails = {
                    ...(existingUser.hostDetails ? existingUser.hostDetails.toObject() : {}),
                    ...updates.hostDetails
                };

                if (updates.hostDetails.city || updates.hostDetails.state) {
                    const newLocation = {
                        ...(existingUser.location ? existingUser.location.toObject() : {}),
                        city: updates.hostDetails.city || (existingUser.location ? existingUser.location.city : ""),
                        state: updates.hostDetails.state || (existingUser.location ? existingUser.location.state : "Uttarakhand"),
                        country: 'India',
                        lastUpdated: new Date()
                    };
                    updates.location = newLocation;
                }
            }
        }

        const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).select("-password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, message: "User updated successfully", user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        if (!['guest', 'host', 'admin'].includes(role)) return res.status(400).json({ success: false, message: "Invalid role" });
        const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, message: `User role updated to ${role}`, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findByIdAndDelete(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Purge all HostHistory audit records for this user (profile_update + experience_delete)
        await HostHistory.deleteMany({ hostId: userId });

        // Delete all Reviews submitted by this user or about this host, and recalculate ratings
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
            } catch (calcErr) {
                console.error("Error recalculating post rating on admin user delete:", calcErr);
            }
        }

        // Clean up notifications
        await Notification.deleteMany({ $or: [{ recipient: userId }, { sender: userId }] });

        // Remove user ID from all friends and friendRequests arrays
        await User.updateMany(
            { $or: [{ friends: userId }, { friendRequests: userId }] },
            { $pull: { friends: userId, friendRequests: userId } }
        );

        res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
