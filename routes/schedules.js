const express = require("express");
const { checkAuth, checkOptionalAuth } = require("../middleware/checkRole");
const scheduleHandler = require("../handlers/scheduleHandler");

const scheduleRouter = express.Router();

/**
 * API: Send immediate invitation to friends (Bulk Support)
 */
scheduleRouter.post("/send-friend-invite", checkAuth, scheduleHandler.sendFriendInvite);

/**
 * API: Remove an invited friend - Multi-method support for live server stability
 */
scheduleRouter.delete("/post/:postId/invite/:friendId", checkAuth, scheduleHandler.removeInvitedFriend);
scheduleRouter.post("/post/:postId/invite/:friendId/remove", checkAuth, scheduleHandler.removeInvitedFriend);

/**
 * API: Get my initiated schedules
 */
scheduleRouter.get("/me", checkAuth, scheduleHandler.getMySchedules);

/**
 * API: Get invitations sent to me
 */
scheduleRouter.get("/invites", checkAuth, scheduleHandler.getReceivedInvites);

/**
 * API: Create schedule and invite friends
 */
scheduleRouter.post("/", checkAuth, scheduleHandler.createSchedule);

/**
 * API: Respond to invitation
 */
scheduleRouter.post("/:id/respond", checkAuth, scheduleHandler.respondToInvite);

/**
 * API: Get invitation status (Guaranteed Session Persistence)
 */
scheduleRouter.get("/post/:postId/status", checkOptionalAuth, scheduleHandler.getScheduleStatus);

/**
 * API: Delete experience/group session (Full Reset)
 */
scheduleRouter.delete("/:id", checkOptionalAuth, scheduleHandler.deleteSchedule);

/**
 * API: Update schedule details (initiator's travelers count)
 */
scheduleRouter.patch("/:id", checkAuth, scheduleHandler.updateSchedule);

module.exports = scheduleRouter;
