const express = require("express")
const mongoose = require("mongoose");
const { Booking, Post, User, Notification, Schedule } = require("../db/mongoose")
const { checkAuth, checkOptionalAuth } = require("../middleware/checkRole")
const scheduleRouter = express.Router()

/**
 * API: Send immediate invitation to friends (Bulk Support)
 */
scheduleRouter.post("/send-friend-invite", checkAuth, async (req, res) => {
    try {
        if (req.user.role === 'host') {
            return res.status(400).json({ success: false, message: "Hosts cannot engage with another host's experience. Only guests can." });
        }
        const { postId, friendId, friendIds, bookingDate, scheduleId } = req.body;
        const initiator = await User.findById(req.user.userId);
        const post = await Post.findById(postId);

        if (!post) return res.status(404).json({ success: false, message: "Post not found" });
        if (!initiator) return res.status(404).json({ success: false, message: "User not found" });

        // Normalize to array of IDs
        let targetIds = [];
        if (Array.isArray(friendIds) && friendIds.length > 0) {
            targetIds = friendIds;
        } else if (friendId) {
            targetIds = [friendId];
        }

        if (targetIds.length === 0) return res.status(400).json({ success: false, message: "No friends selected" });

        let schedule = null;
        if (scheduleId && mongoose.Types.ObjectId.isValid(scheduleId)) {
            schedule = await Schedule.findById(scheduleId);
            if (schedule && String(schedule.initiator) !== String(req.user.userId)) {
                return res.status(403).json({ success: false, message: "Only the group initiator can invite friends to this group" });
            }
        }
        
        if (!schedule) {
            schedule = new Schedule({
                initiator: req.user.userId,
                post: postId,
                postType: post.postType,
                postTitle: post.title,
                invitedPeople: [],
                bookingDate: bookingDate ? new Date(bookingDate) : new Date(),
                numberOfPeople: req.body.numberOfPeople || 1,
                status: 'planning'
            });
        }

        // Validate invitation limits
        const currentInvitedCount = schedule.invitedPeople.length;
        const initiatorCount = Number(schedule.numberOfPeople || req.body.numberOfPeople || 1);
        const newInvitesCount = targetIds.filter(fId => !schedule.invitedPeople.some(inv => String(inv.user) === String(fId))).length;

        if (currentInvitedCount + newInvitesCount > 2) {
            return res.status(400).json({ success: false, message: "You can invite a maximum of 2 friends" });
        }
        if (initiatorCount + currentInvitedCount + newInvitesCount > 3) {
            return res.status(400).json({ success: false, message: "Total group size (travelers + invited friends) cannot exceed 3" });
        }

        const io = req.app.get('io');

        for (const fId of targetIds) {
            const alreadyInvited = schedule.invitedPeople.some(inv => String(inv.user) === String(fId));
            if (!alreadyInvited) {
                schedule.invitedPeople.push({
                    user: fId,
                    status: 'pending',
                    invitedAt: new Date()
                });

                // Create individual notifications
                const notification = await Notification.create({
                    recipient: fId,
                    sender: req.user.userId,
                    title: "Experience Invitation",
                    message: `${initiator.firstname} ${initiator.lastname} invited you to join: "${post.title}"`,
                    type: 'invite_sent',
                    link: `/post/${postId}?scheduleId=${schedule._id}`,
                    metadata: { postId: postId, scheduleId: schedule._id }
                });

                if (io) {
                    io.to(fId.toString()).emit('new_notification', notification);
                }
            } else {
                const idx = schedule.invitedPeople.findIndex(inv => String(inv.user) === String(fId));
                schedule.invitedPeople[idx].invitedAt = new Date();
                schedule.invitedPeople[idx].status = 'pending';
            }
        }

        await schedule.save();
        const populatedSchedule = await Schedule.findById(schedule._id)
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');

        res.json({ success: true, message: "Invitations sent successfully", data: populatedSchedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * INTERNAL FUNCTION: Shared Removal Logic
 */
const performFriendRemoval = async (postId, friendId, initiatorId) => {
    const schedule = await Schedule.findOne({ post: postId, initiator: initiatorId, status: 'planning' });
    if (!schedule) throw new Error("Schedule not found");

    schedule.invitedPeople = schedule.invitedPeople.filter(p => String(p.user?._id || p.user) !== String(friendId));
    
    await Notification.deleteMany({ 
        recipient: friendId, 
        type: 'invite_sent',
        'metadata.postId': postId 
    });

    await schedule.save();
    return await schedule.populate([
        { path: 'initiator', select: 'firstname lastname avatar' },
        { path: 'invitedPeople.user', select: 'firstname lastname avatar' }
    ]);
};

/**
 * API: Remove an invited friend - Multi-method support for live server stability
 */
scheduleRouter.delete("/post/:postId/invite/:friendId", checkAuth, async (req, res) => {
    try {
        const schedule = await performFriendRemoval(req.params.postId, req.params.friendId, req.user.userId);
        res.json({ success: true, data: schedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

scheduleRouter.post("/post/:postId/invite/:friendId/remove", checkAuth, async (req, res) => {
    try {
        const schedule = await performFriendRemoval(req.params.postId, req.params.friendId, req.user.userId);
        res.json({ success: true, data: schedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Get my initiated schedules
 */
scheduleRouter.get("/me", checkAuth, async (req, res) => {
    try {
        const schedules = await Schedule.find({ initiator: req.user.userId })
            .populate('post', 'title photos images price location')
            .populate('invitedPeople.user', 'firstname lastname avatar')
            .populate('bookingId')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: schedules });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Get invitations sent to me
 */
scheduleRouter.get("/invites", checkAuth, async (req, res) => {
    try {
        const schedules = await Schedule.find({ 'invitedPeople.user': req.user.userId })
            .populate('initiator', 'firstname lastname avatar')
            .populate('post', 'title photos images price location')
            .populate('bookingId')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: schedules });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Create schedule and invite friends
 */
scheduleRouter.post("/", checkAuth, async (req, res) => {
    try {
        if (req.user.role === 'host') {
            return res.status(400).json({ success: false, message: "Hosts cannot engage with another host's experience. Only guests can." });
        }
        const { postId, invitedUserIds, bookingDate, numberOfPeople } = req.body;
        const post = await Post.findById(postId);
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });

        const validUsers = await User.find({ _id: { $in: invitedUserIds }, role: { $ne: 'host' } });
        const numTravelers = Number(numberOfPeople || 1);

        if (validUsers.length > 2) {
            return res.status(400).json({ success: false, message: "You can invite a maximum of 2 friends" });
        }
        if (numTravelers + validUsers.length > 3) {
            return res.status(400).json({ success: false, message: "Total group size (travelers + invited friends) cannot exceed 3" });
        }

        const invitedPeople = validUsers.map(u => ({
            user: u._id,
            status: 'pending'
        }));

        const schedule = new Schedule({
            initiator: req.user.userId,
            post: postId,
            postType: post.postType,
            postTitle: post.title,
            invitedPeople,
            bookingDate: new Date(bookingDate),
            numberOfPeople: numberOfPeople || 1,
            status: 'planning'
        });

        await schedule.save();
        const initiator = await User.findById(req.user.userId);
        const io = req.app.get('io');
        
        await Promise.all(validUsers.map(async (friend) => {
            const notification = await Notification.create({
                recipient: friend._id,
                sender: req.user.userId,
                title: "Experience Invitation",
                message: `${initiator.firstname} ${initiator.lastname} invited you to join: "${post.title}"`,
                type: 'invite_sent',
                link: `/post/${postId}?scheduleId=${schedule._id}`,
                metadata: { postId, scheduleId: schedule._id }
            });
            if (io) io.to(friend._id.toString()).emit('new_notification', notification);
        }));

        res.status(201).json({ success: true, message: "Invites sent", data: schedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Respond to invitation
 */
scheduleRouter.post("/:id/respond", checkAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const schedule = await Schedule.findById(req.params.id);
        if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found" });

        const inviteIndex = schedule.invitedPeople.findIndex(inv => inv.user.toString() === req.user.userId.toString());
        if (inviteIndex === -1) return res.status(403).json({ success: false, message: "Unauthorized" });

        schedule.invitedPeople[inviteIndex].status = status;
        schedule.invitedPeople[inviteIndex].respondedAt = new Date();

        if (status === 'accepted') {
            const allAccepted = schedule.invitedPeople.every(p => p.status === 'accepted');
            if (allAccepted) {
                schedule.status = 'confirmed';
                const io = req.app.get('io');
                const groupReadyNotification = await Notification.create({
                    recipient: schedule.initiator,
                    sender: req.user.userId,
                    title: "Group Ready!",
                    message: `Everyone accepted for "${schedule.postTitle}"!`,
                    type: 'booking_accepted',
                    metadata: { scheduleId: schedule._id }
                });
                if (io) io.to(schedule.initiator.toString()).emit('new_notification', groupReadyNotification);
            }
        }

        await schedule.save();
        res.json({ success: true, data: schedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Get invitation status (Guaranteed Session Persistence)
 */
scheduleRouter.get("/post/:postId/status", checkOptionalAuth, async (req, res) => {
    try {
        const { scheduleId } = req.query;
        let schedule = null;
        
        // 1. Priority: Find by ID
        if (scheduleId && mongoose.Types.ObjectId.isValid(scheduleId)) {
            schedule = await Schedule.findOne({
                _id: scheduleId,
                post: req.params.postId,
                status: { $in: ['planning', 'confirmed'] }
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar')
            .populate({
                path: 'bookingId',
                populate: [
                    { path: 'guest', select: 'firstname lastname avatar' },
                    { path: 'joinedUsers.user', select: 'firstname lastname avatar' }
                ]
            });

            // EXPIRATION CHECK: If the user has a scheduleId but is NO LONGER invited (Removed)
            if (schedule && req.user?.userId) {
                const isInitiator = String(schedule.initiator?._id || schedule.initiator) === String(req.user.userId);
                const isInvited = schedule.invitedPeople.some(inv => String(inv.user?._id || inv.user) === String(req.user.userId));
                
                if (!isInitiator && !isInvited) {
                    const Obj = schedule.toObject();
                    Obj.isInviteExpired = true;
                    return res.json({ success: true, data: Obj });
                }
            }
        }
        
        // 2. Fallback: Initiator
        if (!schedule && req.user) {
            schedule = await Schedule.findOne({
                post: req.params.postId,
                initiator: req.user.userId,
                status: 'planning'
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
        }

        // 3. Fallback: Invited Participants
        if (!schedule && req.user) {
            schedule = await Schedule.findOne({
                post: req.params.postId,
                'invitedPeople.user': req.user.userId,
                status: 'planning'
            })
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');
        }

        if (schedule && req.user) {
            const inviteIndex = schedule.invitedPeople.findIndex(inv => String(inv.user?._id || inv.user) === String(req.user.userId));
            if (inviteIndex !== -1) {
                const invite = schedule.invitedPeople[inviteIndex];
                const isInitiator = String(schedule.initiator?._id || schedule.initiator) === String(req.user.userId);
                
                const ONE_HOUR = 60 * 60 * 1000;
                const isPending = invite.status === 'pending';
                const isTimedOut = (new Date().getTime() - new Date(invite.invitedAt).getTime()) > ONE_HOUR;

                if (!isInitiator && isPending && isTimedOut) {
                    const Obj = schedule.toObject();
                    Obj.isInviteExpired = true;
                    return res.json({ success: true, data: Obj });
                }

                if (isPending && !isTimedOut) {
                    schedule.invitedPeople[inviteIndex].status = 'accepted';
                    schedule.invitedPeople[inviteIndex].respondedAt = new Date();
                    await schedule.save();
                }
            }
        }

        res.json({ success: true, data: schedule });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Delete experience/group session (Full Reset)
 */
scheduleRouter.delete("/:id", checkOptionalAuth, async (req, res) => {
    try {
        if (!req.user?.userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const schedule = await Schedule.findById(req.params.id);
        if (!schedule) return res.status(200).json({ success: true, message: "Already removed" });

        // Only initiator can delete the whole session
        if (String(schedule.initiator) !== String(req.user.userId)) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        await Schedule.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Session cancelled" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * API: Update schedule details (initiator's travelers count)
 */
scheduleRouter.patch("/:id", checkAuth, async (req, res) => {
    try {
        const { numberOfPeople } = req.body;
        const schedule = await Schedule.findById(req.params.id);
        if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found" });

        if (String(schedule.initiator) !== String(req.user.userId)) {
            return res.status(403).json({ success: false, message: "Only the initiator can update the schedule" });
        }

        if (numberOfPeople !== undefined) {
            const num = Number(numberOfPeople);
            if (isNaN(num) || num < 1) {
                return res.status(400).json({ success: false, message: "Invalid traveler count" });
            }
            // Enforce total group size limit of 3 (initiator travelers + invited friends)
            const invitedCount = schedule.invitedPeople?.length || 0;
            if (num + invitedCount > 3) {
                return res.status(400).json({ success: false, message: "Total group size (travelers + invited friends) cannot exceed 3" });
            }
            schedule.numberOfPeople = num;
        }

        await schedule.save();
        const populated = await Schedule.findById(schedule._id)
            .populate('initiator', 'firstname lastname avatar')
            .populate('invitedPeople.user', 'firstname lastname avatar');

        res.json({ success: true, message: "Schedule updated successfully", data: populated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = scheduleRouter;
