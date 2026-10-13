const express = require("express");
const { GuestSchedule, Post } = require("../db/mongoose");
const { checkAuth } = require("../middleware/checkRole");

const router = express.Router();

/**
 * POST /api/guest-schedules
 * Create or update a guest scheduled experience
 */
router.post("/", checkAuth, async (req, res) => {
    try {
        if (req.user.role === 'host') {
            return res.status(400).json({ success: false, message: "Hosts cannot schedule experiences. Only guests can." });
        }

        const { postId, scheduledDate, scheduledTime } = req.body;
        if (!postId || !scheduledDate || !scheduledTime) {
            return res.status(400).json({ success: false, message: "Post ID, date, and time are required" });
        }

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ success: false, message: "Experience not found" });
        }

        // Combine date and time to create UTC Date object
        const [year, month, day] = scheduledDate.split('-').map(Number);
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        const targetDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);

        if (isNaN(targetDateTime.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid date or time format" });
        }

        if (targetDateTime <= new Date()) {
            return res.status(400).json({ success: false, message: "Scheduled date and time must be in the future" });
        }

        // Upsert schedule for this user and post
        let schedule = await GuestSchedule.findOne({ user: req.user.userId, post: postId });
        if (schedule) {
            schedule.scheduledDate = scheduledDate;
            schedule.scheduledTime = scheduledTime;
            schedule.scheduledDateTime = targetDateTime;
            schedule.status = 'scheduled';
            await schedule.save();
        } else {
            schedule = await GuestSchedule.create({
                user: req.user.userId,
                post: postId,
                postType: post.postType || 'experience',
                scheduledDate,
                scheduledTime,
                scheduledDateTime: targetDateTime,
                status: 'scheduled'
            });
        }

        await schedule.populate('post', 'title photos images price location rating reviewCount postType');

        res.status(200).json({
            success: true,
            message: "Experience scheduled successfully!",
            schedule
        });
    } catch (err) {
        console.error("Error scheduling experience:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to schedule experience" });
    }
});

/**
 * GET /api/guest-schedules/me
 * Get all active scheduled experiences for the logged-in guest
 */
router.get("/me", checkAuth, async (req, res) => {
    try {
        const schedules = await GuestSchedule.find({
            user: req.user.userId,
            status: 'scheduled'
        })
        .populate('post', 'title photos images price location rating reviewCount postType clicks')
        .sort({ scheduledDateTime: 1 });

        res.status(200).json({
            success: true,
            schedules
        });
    } catch (err) {
        console.error("Error fetching guest schedules:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to fetch schedules" });
    }
});

/**
 * GET /api/guest-schedules/check/:postId
 * Check if the logged-in user has scheduled a specific post
 */
router.get("/check/:postId", checkAuth, async (req, res) => {
    try {
        const schedule = await GuestSchedule.findOne({
            user: req.user.userId,
            post: req.params.postId,
            status: 'scheduled'
        }).populate('post', 'title photos images price location rating reviewCount postType');

        res.status(200).json({
            success: true,
            isScheduled: !!schedule,
            schedule: schedule || null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * DELETE /api/guest-schedules/:id
 * Delete / unschedule an experience
 */
router.delete("/:id", checkAuth, async (req, res) => {
    try {
        const schedule = await GuestSchedule.findOne({
            _id: req.params.id,
            user: req.user.userId
        });

        if (!schedule) {
            return res.status(404).json({ success: false, message: "Scheduled experience not found" });
        }

        await GuestSchedule.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Experience unscheduled successfully"
        });
    } catch (err) {
        console.error("Error unscheduling experience:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to unschedule" });
    }
});

module.exports = router;
