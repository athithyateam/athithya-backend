const { chatService } = require("../services/chatService");

// GET chat eligibility status for a conversation
const getChatEligibility = async (req, res) => {
    try {
        const result = await chatService.getChatEligibility(req.params.conversationId, req.user.userId);
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error("Chat eligibility error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error checking eligibility" });
    }
};

// POST upload attachments (JSON payload, files pre-uploaded directly to S3)
const sendMessageAttachments = async (req, res) => {
    try {
        const { recipientId, text, attachments } = req.body;
        const message = await chatService.sendMessage(req.user.userId, {
            conversationId: req.params.conversationId,
            recipientId,
            text,
            attachments
        });
        res.status(201).json({ success: true, message });
    } catch (error) {
        console.error("Upload attachments error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error uploading attachments",
            ...(error.eligibility || {})
        });
    }
};

// GET all conversations for the current user
const getConversations = async (req, res) => {
    try {
        const conversations = await chatService.getUserConversations(req.user.userId);
        res.status(200).json({ success: true, conversations });
    } catch (error) {
        console.error("Get conversations error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error fetching conversations" });
    }
};

// GET messages for a specific conversation
const getMessages = async (req, res) => {
    try {
        const messages = await chatService.getMessages(req.params.conversationId, req.user.userId);
        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error fetching messages" });
    }
};

// CREATE or GET a 1-on-1 conversation
const createConversation = async (req, res) => {
    try {
        const conversation = await chatService.getOrCreateConversation(req.user.userId, req.body.recipientId);
        res.status(200).json({ success: true, conversation });
    } catch (error) {
        console.error("Create conversation error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error starting conversation",
            ...(error.eligibility || {})
        });
    }
};

// CREATE a Group Plan
const createGroup = async (req, res) => {
    try {
        const conversation = await chatService.createGroup(req.user.userId, req.body, req.file);
        res.status(201).json({ success: true, conversation });
    } catch (error) {
        console.error("Create group error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error creating group plan" });
    }
};

// UPDATE Group Metadata
const updateConversation = async (req, res) => {
    try {
        const conversation = await chatService.updateGroup(req.params.conversationId, req.user.userId, req.body, req.file);
        res.status(200).json({ success: true, conversation });
    } catch (error) {
        console.error("Update group error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error updating group" });
    }
};

// LEAVE a Group
const leaveGroup = async (req, res) => {
    try {
        const result = await chatService.leaveGroup(req.params.conversationId, req.user.userId);
        if (result.deleted) {
            return res.status(200).json({ success: true, message: result.message });
        }
        res.status(200).json({ success: true, conversation: result.conversation });
    } catch (error) {
        console.error("Leave group error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error leaving group" });
    }
};

// DELETE a Conversation (DM or Group)
const deleteConversation = async (req, res) => {
    try {
        const result = await chatService.deleteConversation(req.params.conversationId, req.user.userId);
        res.status(200).json(result);
    } catch (error) {
        console.error("Delete conversation error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error deleting conversation" });
    }
};

// POST a new message (REST version, used as fallback or initial send)
const sendMessage = async (req, res) => {
    try {
        const { conversationId, text, recipientId, messageType, locationData, attachments } = req.body;
        const message = await chatService.sendMessage(req.user.userId, {
            conversationId,
            text,
            recipientId,
            messageType,
            locationData,
            attachments
        });
        res.status(201).json({ success: true, message });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error sending message",
            ...(error.eligibility || {})
        });
    }
};

// MARK messages as read
const markConversationAsRead = async (req, res) => {
    try {
        await chatService.markConversationAsRead(req.params.conversationId, req.user.userId);
        res.status(200).json({ success: true, message: "Conversation marked as read" });
    } catch (error) {
        console.error("Read message error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error marking messages as read" });
    }
};

// DELETE a single message
const deleteMessage = async (req, res) => {
    try {
        await chatService.deleteMessage(req.params.messageId, req.user.userId);
        res.status(200).json({ success: true, message: "Message deleted" });
    } catch (error) {
        console.error("Delete message error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error deleting message" });
    }
};

// DELETE/CLEAR all messages in a conversation
const clearConversation = async (req, res) => {
    try {
        const result = await chatService.clearConversation(req.params.conversationId, req.user.userId);
        res.status(200).json(result);
    } catch (error) {
        console.error("Clear chat error:", error);
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "Error clearing chat" });
    }
};

module.exports = {
    getChatEligibility,
    sendMessageAttachments,
    getConversations,
    getMessages,
    createConversation,
    createGroup,
    updateConversation,
    leaveGroup,
    deleteConversation,
    sendMessage,
    markConversationAsRead,
    deleteMessage,
    clearConversation
};
