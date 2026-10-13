const { Booking } = require("../../db/mongoose");

exports.getHostRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        // Primary Filter: Only show the "Initiator" (the Guest who started the trip)
        // We exclude anyone with a parentBookingId or marked as isInviteBooking
        const query = { 
            host: req.user.userId,
            isInviteBooking: { $ne: true },
            $or: [
                { parentBookingId: { $exists: false } },
                { parentBookingId: null }
            ]
        };

        if (status) query.status = status;

        const total = await Booking.countDocuments(query);
        const rawBookedData = await Booking.find(query)
            .populate('guest', 'firstname lastname avatar')
            .populate('post', 'title postType photos location duration price')
            .populate({
                path: 'joinedUsers.booking',
                select: 'totalAmount status isInviteBooking'
            })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        // Aggregate Money: Show the total financial value of the entire group to the host
        const bookings = rawBookedData.map(b => {
            const booking = b.toObject();
            
            // Start with the initiator's own payment (e.g., ₹1.15)
            let groupTotalRevenue = Number(booking.totalAmount) || 0;
            
            // Add up payments from all friends who have joined this trip
            if (booking.joinedUsers && Array.isArray(booking.joinedUsers)) {
                booking.joinedUsers.forEach(joined => {
                    if (joined.booking && typeof joined.booking === 'object') {
                        const friendStatus = joined.booking.status;
                        // Sum up revenue if the friend has successfully paid/booked
                        if (['accepted', 'pending', 'completed'].includes(friendStatus)) {
                            groupTotalRevenue += Number(joined.booking.totalAmount || 0);
                        }
                    }
                });
            }
            
            return {
                ...booking,
                totalAmount: groupTotalRevenue // Override to show total group revenue for this trip
            };
        });

        // Sync counts with the new filtered trip view
        const countQuery = (s) => ({ host: req.user.userId, status: s, isInviteBooking: { $ne: true }, $or: [{ parentBookingId: { $exists: false } }, { parentBookingId: null }] });
        
        const pendingCount = await Booking.countDocuments(countQuery('pending'));
        const acceptedCount = await Booking.countDocuments(countQuery('accepted'));
        const declinedCount = await Booking.countDocuments(countQuery('declined'));

        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            },
            summary: {
                pending: pendingCount,
                accepted: acceptedCount,
                declined: declinedCount,
                total: pendingCount + acceptedCount + declinedCount
            }
        });

    } catch (error) {
        console.error("Error fetching booking requests:", error);
        res.status(500).json({ success: false, message: "Failed to fetch booking requests" });
    }
};

exports.getGuestBookings = async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        const query = { guest: req.user.userId };
        if (status) query.status = status;

        const total = await Booking.countDocuments(query);
        const bookings = await Booking.find(query)
            .populate('host', 'firstname lastname email avatar')
            .populate('post', 'title postType photos location duration price')
            .populate('invitedUsers', 'firstname lastname avatar')
            .populate({ path: 'joinedUsers.user', select: 'firstname lastname avatar' })
            .populate({ path: 'joinedUsers.booking', select: 'startDate endDate totalAmount' })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Error fetching guest bookings:", error);
        res.status(500).json({ success: false, message: "Failed to fetch bookings" });
    }
};

exports.getBookingDetails = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId)
            .populate('guest', 'firstname lastname email avatar')
            .populate('host', 'firstname lastname email avatar')
            .populate('post', 'title postType photos location price');

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.guest._id.toString() !== req.user.userId.toString() &&
            booking.host._id.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to view this booking" });
        }

        let result = booking.toObject();
        // If the requester is the host, remove the guest's email to protect guest privacy
        const requesterIdStr = String(req.user.userId).trim();
        const hostIdStr = String(booking.host._id || booking.host).trim();
        if (requesterIdStr === hostIdStr) {
            if (result.guest) {
                delete result.guest.email;
            }
        }

        res.status(200).json({ success: true, data: result });

    } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ success: false, message: "Failed to fetch booking record" });
    }
};
