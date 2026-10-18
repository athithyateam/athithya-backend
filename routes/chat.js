const express = require("express");
const { checkAuth } = require("../middleware/checkRole");
const chatHandler = require("../handlers/chatHandler");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB (to stay under Vercel's 4.5MB request body limit)
});

const chatRouter = express.Router();

// GET chat eligibility status for a conversation
chatRouter.get("/eligibility/:conversationId", checkAuth, chatHandler.getChatEligibility);

// POST upload attachments (JSON payload, files pre-uploaded directly to S3)
chatRouter.post("/messages/:conversationId/attachments", checkAuth, chatHandler.sendMessageAttachments);

// GET all conversations for the current user
chatRouter.get("/conversations", checkAuth, chatHandler.getConversations);

// GET messages for a specific conversation
chatRouter.get("/messages/:conversationId", checkAuth, chatHandler.getMessages);

// CREATE or GET a 1-on-1 conversation
chatRouter.post("/conversations", checkAuth, chatHandler.createConversation);

// CREATE a Group Plan
chatRouter.post("/groups", checkAuth, upload.single("avatar"), chatHandler.createGroup);

// UPDATE Group Metadata
chatRouter.patch("/conversations/:conversationId", checkAuth, upload.single("avatar"), chatHandler.updateConversation);

// LEAVE a Group
chatRouter.post("/conversations/:conversationId/leave", checkAuth, chatHandler.leaveGroup);

// DELETE a Conversation (DM or Group)
chatRouter.delete("/conversations/:conversationId", checkAuth, chatHandler.deleteConversation);

// POST a new message (REST version, used as fallback or initial send)
chatRouter.post("/messages", checkAuth, chatHandler.sendMessage);

// MARK messages as read
chatRouter.patch("/conversations/:conversationId/read", checkAuth, chatHandler.markConversationAsRead);

// DELETE a single message
chatRouter.delete("/messages/:messageId", checkAuth, chatHandler.deleteMessage);

// DELETE/CLEAR all messages in a conversation
chatRouter.delete("/conversations/:conversationId/clear", checkAuth, chatHandler.clearConversation);

// UPDATE Itinerary (Add/Remove Pin)
chatRouter.post("/conversations/:conversationId/itinerary", checkAuth, chatHandler.updateChatItinerary);

module.exports = chatRouter;
