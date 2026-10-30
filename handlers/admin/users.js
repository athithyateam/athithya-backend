const { User, HostDetails } = require("../../db/mongoose");
const { profileService } = require("../../services/users/profileService");

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
                .select("-password")
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
        const userObj = user.toObject ? user.toObject() : JSON.parse(JSON.stringify(user));
        if (user.role === 'host') {
            const hostDoc = await HostDetails.findOne({ user: user._id });
            if (hostDoc) {
                userObj.hostDetails = hostDoc;
                userObj.hostStatus = hostDoc.status;
                userObj.verifyBadge = hostDoc.verifyBadge;
                userObj.pendingHostDetails = hostDoc.pendingHostDetails;
            }
        }
        return res.status(200).json({ success: true, user: userObj });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Error fetching user" });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const updates = req.body;
        delete updates.password;

        const hostUpdates = {};

        if (updates.verifyBadge) {
            const reqBookings = Number(updates.verifyBadge.requiredBookings) || 1;
            const successCount = Number(updates.verifyBadge.successfulBookingsCount) || 0;
            
            hostUpdates['verifyBadge.requiredBookings'] = reqBookings;
            hostUpdates['verifyBadge.successfulBookingsCount'] = successCount;
            hostUpdates['verifyBadge.enabled'] = successCount >= reqBookings;
            delete updates.verifyBadge;
        }

        // Sync and validate hostDetails if provided
        if (updates.hostDetails) {
            if (updates.hostDetails.yearsOfExperience !== undefined) {
                updates.hostDetails.yearsOfExperience = Math.min(30, Math.max(0, parseInt(updates.hostDetails.yearsOfExperience, 10) || 0));
            }

            const existingUser = await User.findById(req.params.id);
            if (existingUser) {
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

            for (const [key, val] of Object.entries(updates.hostDetails)) {
                hostUpdates[key] = val;
            }
            delete updates.hostDetails;
        }

        if (Object.keys(hostUpdates).length > 0) {
            await HostDetails.findOneAndUpdate(
                { user: req.params.id },
                { $set: hostUpdates },
                { upsert: true, new: true }
            );
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
        await profileService.deleteAccount(userId);
        res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};
