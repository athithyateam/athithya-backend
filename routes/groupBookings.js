const express = require("express");
const { checkAuth, checkOptionalAuth } = require("../middleware/checkRole");
const groupBookingHandler = require("../handlers/groupBookingHandler");

const router = express.Router();

/**
 * API: Send immediate invitation to friends (Bulk Support)
 */
router.post("/send-friend-invite", checkAuth, groupBookingHandler.sendFriendInvite);

/**
 * API: Remove an invited friend - Multi-method support for live client stability
 */
router.delete("/post/:postId/invite/:friendId", checkAuth, groupBookingHandler.removeInvitedFriend);
router.post("/post/:postId/invite/:friendId/remove", checkAuth, groupBookingHandler.removeInvitedFriend);

/**
 * API: Get my initiated group bookings
 */
router.get("/me", checkAuth, groupBookingHandler.getMyGroupBookings);

/**
 * API: Get group booking invitations sent to me
 */
router.get("/invites", checkAuth, groupBookingHandler.getReceivedInvites);

/**
 * API: Create group booking and invite friends
 */
router.post("/", checkAuth, groupBookingHandler.createGroupBooking);

/**
 * API: Respond to invitation
 */
router.post("/:id/respond", checkAuth, groupBookingHandler.respondToInvite);

/**
 * API: Get group booking session status
 */
router.get("/post/:postId/status", checkOptionalAuth, groupBookingHandler.getGroupBookingStatus);

/**
 * API: Delete experience group session
 */
router.delete("/:id", checkOptionalAuth, groupBookingHandler.deleteGroupBooking);

/**
 * API: Update group booking traveler count
 */
router.patch("/:id", checkAuth, groupBookingHandler.updateGroupBooking);

module.exports = router;
