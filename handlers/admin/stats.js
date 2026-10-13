const { User, Post, Booking, Review } = require("../../db/mongoose");

exports.getAdminStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalPosts = await Post.countDocuments({ status: "active" });
        const totalBookings = await Booking.countDocuments({ status: { $nin: ["cancelled", "rejected"] } });
        const totalReviews = await Review.countDocuments();

        const roleCounts = await User.aggregate([
            { $group: { _id: "$role", count: { $sum: 1 } } }
        ]);

        const postCounts = await Post.aggregate([
            { $group: { _id: "$postType", count: { $sum: 1 } } }
        ]);

        const categoryCounts = await Post.aggregate([
            { $unwind: "$categories" },
            { $group: { _id: "$categories", count: { $sum: 1 } } }
        ]);

        const hostCategoryCounts = await Post.aggregate([
            { $unwind: "$categories" },
            { $group: { 
                _id: { user: "$user", category: "$categories" }, 
                count: { $sum: 1 } 
              } 
            },
            { $lookup: {
                from: "users",
                localField: "_id.user",
                foreignField: "_id",
                as: "userInfo"
              }
            },
            { $unwind: "$userInfo" },
            { $project: {
                _id: 0,
                userId: "$_id.user",
                firstname: "$userInfo.firstname",
                lastname: "$userInfo.lastname",
                email: "$userInfo.email",
                avatar: "$userInfo.avatar",
                category: "$_id.category",
                count: 1
              }
            }
        ]);

        const recentUsers = await User.find().select("firstname lastname email role createdAt avatar").sort({ createdAt: -1 }).limit(5);
        const recentPosts = await Post.find().populate("user", "firstname lastname avatar").sort({ createdAt: -1 }).limit(5);
        const recentBookings = await Booking.find().populate("guest", "firstname lastname avatar").populate("post", "title").sort({ createdAt: -1 }).limit(5);

        const statistics = {
            totalUsers,
            totalPosts,
            totalBookings,
            totalReviews,
            roles: roleCounts.reduce((acc, curr) => { acc[curr._id] = curr.count; return acc; }, {}),
            postsByType: postCounts.reduce((acc, curr) => { acc[curr._id] = curr.count; return acc; }, {}),
            categoryStats: categoryCounts.reduce((acc, curr) => { acc[curr._id] = curr.count; return acc; }, {}),
            hostCategoryStats: hostCategoryCounts,
            activities: {
                recentUsers,
                recentPosts,
                recentExperiences: recentPosts,
                recentBookings
            }
        };

        res.json({ success: true, statistics });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
