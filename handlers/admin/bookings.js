const { Booking } = require("../../db/mongoose");

exports.getAllBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || "";
        
        const { User, Post } = require("../../db/mongoose");
        let query = { isInviteBooking: { $ne: true } };

        if (search) {
            const userIds = await User.find({
                $or: [
                    { firstname: { $regex: search, $options: "i" } },
                    { lastname: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } }
                ]
            }).select('_id');

            const postIds = await Post.find({
                title: { $regex: search, $options: "i" }
            }).select('_id');

            query = {
                isInviteBooking: { $ne: true },
                $or: [
                    { guest: { $in: userIds } },
                    { host: { $in: userIds } },
                    { post: { $in: postIds } },
                    { postTitle: { $regex: search, $options: "i" } }
                ]
            };
        }

        const totalDocuments = await Booking.countDocuments(query);
        const totalPages = Math.ceil(totalDocuments / limit);

        const bookings = await Booking.find(query)
            .populate("guest", "firstname lastname email avatar")
            .populate("host", "firstname lastname email avatar")
            .populate("post", "title photos")
            .populate({
                path: "parentBookingId",
                populate: { path: "guest", select: "firstname lastname email" }
            })
            .populate({
                path: "joinedUsers.user",
                select: "firstname lastname email avatar"
            })
            .populate("joinedUsers.booking")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
            
        res.json({ 
            success: true, 
            bookings, 
            totalPages, 
            currentPage: page,
            totalDocuments 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateBooking = async (req, res) => {
    try {
        const updates = req.body;
        const booking = await Booking.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
            .populate("guest", "firstname lastname avatar email")
            .populate("host", "firstname lastname avatar email")
            .populate("post", "title photos")
            .populate({
                path: "parentBookingId",
                populate: { path: "guest", select: "firstname lastname email" }
            })
            .populate({
                path: "joinedUsers.user",
                select: "firstname lastname email avatar"
            })
            .populate("joinedUsers.booking");
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
        res.json({ success: true, message: "Booking updated successfully", booking });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteBooking = async (req, res) => {
    try {
        const booking = await Booking.findByIdAndDelete(req.params.id);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
        // Cascade delete invited bookings associated with this parent booking
        await Booking.deleteMany({ parentBookingId: req.params.id });
        res.json({ success: true, message: "Booking deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
