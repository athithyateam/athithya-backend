const { groupBookingService } = require("../services/bookings/groupBookingService");

const sendFriendInvite = async (req, res) => {
    try {
        const io = req.app.get('io');
        const data = await groupBookingService.sendFriendInvite(req.user.userId, req.body, io);
        res.json({ success: true, message: "Invitations sent successfully", data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const removeInvitedFriend = async (req, res) => {
    try {
        const expId = req.params.experienceId;
        const data = await groupBookingService.removeInvitedFriend(expId, req.params.friendId, req.user.userId);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const getMyGroupBookings = async (req, res) => {
    try {
        const data = await groupBookingService.getMyGroupBookings(req.user.userId);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const getReceivedInvites = async (req, res) => {
    try {
        const data = await groupBookingService.getReceivedInvites(req.user.userId);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const createGroupBooking = async (req, res) => {
    try {
        const io = req.app.get('io');
        const data = await groupBookingService.createGroupBooking(req.user.userId, req.body, io);
        res.status(201).json({ success: true, message: "Invites sent", data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const respondToInvite = async (req, res) => {
    try {
        const io = req.app.get('io');
        const data = await groupBookingService.respondToInvite(req.user.userId, req.params.id, req.body.status, io);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const getGroupBookingStatus = async (req, res) => {
    try {
        const expId = req.params.experienceId;
        const targetBookingId = req.query.groupBookingId || req.query.scheduleId;
        const data = await groupBookingService.getGroupBookingStatus(expId, targetBookingId, req.user?.userId);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const deleteGroupBooking = async (req, res) => {
    try {
        if (!req.user?.userId) return res.status(401).json({ success: false, message: "Unauthorized" });
        await groupBookingService.deleteGroupBooking(req.params.id, req.user.userId);
        res.json({ success: true, message: "Session cancelled" });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const updateGroupBooking = async (req, res) => {
    try {
        const data = await groupBookingService.updateGroupBooking(req.params.id, req.user.userId, req.body.numberOfPeople);
        res.json({ success: true, message: "Group booking updated successfully", data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

module.exports = {
    sendFriendInvite,
    removeInvitedFriend,
    getMyGroupBookings,
    getReceivedInvites,
    createGroupBooking,
    respondToInvite,
    getGroupBookingStatus,
    deleteGroupBooking,
    updateGroupBooking
};
