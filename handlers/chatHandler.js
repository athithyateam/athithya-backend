const { Conversation, Message, User } = require("../db/mongoose");
const { upload } = require("../services/storageService");
const { checkChatEligibility } = require("../utils/hostBookingChatHelper");
const { notifyRecipientOfNewMessage } = require("../utils/messageEmailHelper");

// GET chat eligibility status for a conversation
const getChatEligibility = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        if (conversation.isGroup) {
            return res.status(200).json({ success: true, canChat: true });
        }

        const targetUser = conversation.participants.find(p => String(p._id || p) !== String(userId));
        const targetUserId = String(targetUser?._id || targetUser || "");
        const result = await checkChatEligibility(userId, targetUserId);

        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error("Chat eligibility error:", error);
        res.status(500).json({ success: false, canChat: true, message: "Error checking eligibility" });
    }
};

// POST upload attachments (JSON payload, files pre-uploaded directly to S3)
const sendMessageAttachments = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { recipientId, text, attachments } = req.body;
        const senderId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        if (!conversation.participants.some(p => p.toString() === senderId.toString())) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not a participant in this conversation" });
        }

        // Check eligibility for 1-on-1 DM
        if (!conversation.isGroup) {
            const targetUserId = recipientId || conversation.participants.find(p => String(p._id || p) !== String(senderId));
            const eligibility = await checkChatEligibility(senderId, targetUserId);
            if (!eligibility.canChat) {
                return res.status(403).json({
                    success: false,
                    canChat: false,
                    hostId: eligibility.hostId,
                    message: eligibility.reason || "Journey is over. Chat is disabled."
                });
            }
        }

        let attachmentUrls = [];
        if (attachments) {
            const parsedAttachments = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
            attachmentUrls = Array.isArray(parsedAttachments) ? parsedAttachments : [parsedAttachments];
        }

        const message = await Message.create({
            conversationId,
            sender: senderId,
            recipient: recipientId,
            text,
            attachments: attachmentUrls
        });

        // Update conversation last message
        await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: {
                text: text || "Sent an attachment",
                sender: senderId,
                createdAt: new Date()
            },
            $inc: { [`unreadCounts.${recipientId}`]: 1 }
        });

        await message.populate("sender", "firstname lastname avatar");

        // Send email notification to recipient
        const targetRecipientId = String(recipientId?._id || recipientId);
        notifyRecipientOfNewMessage(message.sender, targetRecipientId);

        // Broadcast real-time
        const io = req.app.get("io");
        if (io) {
            const targetSenderId = String(senderId?._id || senderId);
            io.to(targetRecipientId).emit("new_message", message);
            io.to(targetSenderId).emit("message_sent", message);
        }

        res.status(201).json({ success: true, message });
    } catch (error) {
        console.error("Upload attachments error:", error);
        res.status(500).json({ success: false, message: "Error uploading attachments" });
    }
};

// GET all conversations for the current user
const getConversations = async (req, res) => {
    try {
        const userId = req.user.userId;
        const conversations = await Conversation.find({
            participants: userId
        })
        .populate("participants", "firstname lastname avatar role")
        .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, conversations });
    } catch (error) {
        console.error("Get conversations error:", error);
        res.status(500).json({ success: false, message: "Error fetching conversations" });
    }
};

// GET messages for a specific conversation
const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const senderId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        if (!conversation.participants.some(p => p.toString() === senderId.toString())) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not a participant in this conversation" });
        }

        const messages = await Message.find({ conversationId })
            .sort({ createdAt: 1 })
            .populate("sender", "firstname lastname avatar");

        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).json({ success: false, message: "Error fetching messages" });
    }
};

// CREATE or GET a 1-on-1 conversation
const createConversation = async (req, res) => {
    try {
        const { recipientId } = req.body;
        const senderId = req.user.userId;

        if (senderId === recipientId) {
            return res.status(400).json({ success: false, message: "Cannot start a chat with yourself" });
        }

        // Enforce eligibility rules (Host restrictions, guest experience booking requirement)
        const eligibility = await checkChatEligibility(senderId, recipientId);
        if (!eligibility.canChat) {
            return res.status(403).json({
                success: false,
                canChat: false,
                message: eligibility.reason || "You are not eligible to start a conversation with this user.",
                ...eligibility
            });
        }

        // Check if conversation already exists
        let conversation = await Conversation.findOne({
            participants: { $all: [senderId, recipientId], $size: 2 }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                participants: [senderId, recipientId],
                unreadCounts: {
                    [senderId]: 0,
                    [recipientId]: 0
                }
            });
        }

        // Populate participants details so the frontend has access to first/last names and avatar URLs
        conversation = await Conversation.findById(conversation._id).populate("participants", "firstname lastname avatar role");

        res.status(200).json({ success: true, conversation });
    } catch (error) {
        console.error("Create conversation error:", error);
        res.status(500).json({ success: false, message: "Error starting conversation" });
    }
};

// CREATE a Group Plan
const createGroup = async (req, res) => {
    try {
        const { name, description, participantIds } = req.body;
        const adminId = req.user.userId;

        let parsedParticipants = [];
        try {
            parsedParticipants = typeof participantIds === 'string' ? JSON.parse(participantIds) : participantIds;
        } catch (e) {
            parsedParticipants = participantIds;
        }

        if (!name || !parsedParticipants || !Array.isArray(parsedParticipants)) {
            return res.status(400).json({ success: false, message: "Name and participants are required" });
        }

        // Ensure admin is in participants and all are unique strings
        const participants = [...new Set([
            ...parsedParticipants.map(id => id.toString()), 
            adminId.toString()
        ])];

        let avatarData = undefined;
        if (req.file) {
            const result = await upload(req.file, "groups");
            avatarData = { url: result.secure_url, public_id: result.public_id };
        }

        // Initialize unread counts as a Map
        const unreadMap = new Map();
        participants.forEach(p => unreadMap.set(p.toString(), 0));

        const group = await Conversation.create({
            isGroup: true,
            participants,
            groupMetadata: {
                name,
                description,
                avatar: avatarData,
                admin: adminId
            },
            unreadCounts: unreadMap,
            lastMessage: {
                text: "Group plan created",
                sender: adminId,
                createdAt: new Date()
            }
        });

        // Add an initial system message with the actual creator's name
        const creator = await User.findById(adminId);
        await Message.create({
            conversationId: group._id,
            sender: adminId,
            text: `${creator?.firstname || 'Someone'} created this plan for everyone.`,
            messageType: 'system'
        });

        await group.populate("participants", "firstname lastname avatar role");

        res.status(201).json({ success: true, conversation: group });
    } catch (error) {
        console.error("Create group error:", error);
        res.status(500).json({ success: false, message: "Error creating group plan" });
    }
};

// UPDATE Group Metadata
const updateConversation = async (req, res) => {
    try {
        const { name, description } = req.body;
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.isGroup) {
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        // Only admin can update
        if (String(conversation.groupMetadata.admin) !== String(userId)) {
            return res.status(403).json({ success: false, message: "Only admin can update group details" });
        }

        const updates = {};
        if (name) updates['groupMetadata.name'] = name;
        if (description) updates['groupMetadata.description'] = description;

        if (req.file) {
            const result = await upload(req.file, "groups");
            updates['groupMetadata.avatar'] = { url: result.secure_url, public_id: result.public_id };
        }

        const updatedGroup = await Conversation.findByIdAndUpdate(
            conversationId,
            { $set: updates },
            { new: true }
        ).populate("participants", "firstname lastname avatar role");

        res.status(200).json({ success: true, conversation: updatedGroup });
    } catch (error) {
        console.error("Update group error:", error);
        res.status(500).json({ success: false, message: "Error updating group" });
    }
};

// LEAVE a Group
const leaveGroup = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.isGroup) {
            return res.status(404).json({ success: false, message: "Group not found" });
        }

        const isParticipant = conversation.participants.some(p => String(p) === String(userId));
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: "You are not a member of this group" });
        }

        // Remove user from participants
        const updatedParticipants = conversation.participants.filter(p => String(p) !== String(userId));
        
        if (updatedParticipants.length === 0) {
            // Delete group if no one left
            await Conversation.findByIdAndDelete(conversationId);
            await Message.deleteMany({ conversationId });
            return res.status(200).json({ success: true, message: "Group deleted as last member left" });
        }

        const updateData = { participants: updatedParticipants };
        
        // If admin left, assign new admin
        if (String(conversation.groupMetadata.admin) === String(userId)) {
            updateData['groupMetadata.admin'] = updatedParticipants[0];
        }

        const updatedGroup = await Conversation.findByIdAndUpdate(
            conversationId,
            { $set: updateData },
            { new: true }
        ).populate("participants", "firstname lastname avatar role");

        res.status(200).json({ success: true, conversation: updatedGroup });
    } catch (error) {
        console.error("Leave group error:", error);
        res.status(500).json({ success: false, message: "Error leaving group" });
    }
};

// DELETE a Conversation (DM or Group)
const deleteConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        // Verify user is participant
        const isParticipant = conversation.participants.some(p => String(p) === String(userId));
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: "Unauthorized to delete this conversation" });
        }

        // Only admin can delete group plans
        if (conversation.isGroup && String(conversation.groupMetadata.admin) !== String(userId)) {
            return res.status(403).json({ success: false, message: "Only admin can delete the group plan" });
        }

        await Conversation.findByIdAndDelete(conversationId);
        await Message.deleteMany({ conversationId });

        res.status(200).json({ success: true, message: "Conversation deleted permanently" });
    } catch (error) {
        console.error("Delete conversation error:", error);
        res.status(500).json({ success: false, message: "Error deleting conversation" });
    }
};

// POST a new message (REST version, used as fallback or initial send)
const sendMessage = async (req, res) => {
    try {
        const { conversationId, text, recipientId, messageType, locationData } = req.body;
        const senderId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        if (!conversation.participants.some(p => p.toString() === senderId.toString())) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not a participant in this conversation" });
        }

        // Check eligibility for 1-on-1 DM
        if (!conversation.isGroup) {
            const targetUserId = recipientId || conversation.participants.find(p => String(p) !== String(senderId));
            const eligibility = await checkChatEligibility(senderId, targetUserId);
            if (!eligibility.canChat) {
                return res.status(403).json({
                    success: false,
                    canChat: false,
                    hostId: eligibility.hostId,
                    message: eligibility.reason || "To continue chat with this host, you must book an experience."
                });
            }
        }

        const messageData = {
            conversationId,
            sender: senderId,
            text,
            messageType: messageType || 'text'
        };

        if (locationData) {
            messageData.locationData = locationData;
        }

        if (!conversation.isGroup) {
            messageData.recipient = recipientId || conversation.participants.find(p => String(p) !== String(senderId));
        }

        const message = await Message.create(messageData);

        // Update conversation last message and unread counts
        const unreadUpdates = {};
        if (conversation.isGroup) {
            conversation.participants.forEach(p => {
                if (String(p) !== String(senderId)) {
                    unreadUpdates[`unreadCounts.${p}`] = (conversation.unreadCounts.get(String(p)) || 0) + 1;
                }
            });
        } else {
            const targetId = recipientId || conversation.participants.find(p => String(p) !== String(senderId));
            unreadUpdates[`unreadCounts.${targetId}`] = (conversation.unreadCounts.get(String(targetId)) || 0) + 1;
        }

        await Conversation.findByIdAndUpdate(conversationId, {
            $set: {
                lastMessage: {
                    text: text || (messageType === 'location' ? "Shared a location" : "Sent a message"),
                    sender: senderId,
                    createdAt: new Date()
                }
            },
            $inc: unreadUpdates
        });

        await message.populate("sender", "firstname lastname avatar");

        // Send email notification to recipient(s)
        if (conversation.isGroup) {
            conversation.participants.forEach(p => {
                if (String(p) !== String(senderId)) {
                    notifyRecipientOfNewMessage(message.sender, p);
                }
            });
        } else {
            const rawTarget = recipientId || conversation.participants.find(p => String(p._id || p) !== String(senderId));
            const targetIdStr = String(rawTarget?._id || rawTarget);
            notifyRecipientOfNewMessage(message.sender, targetIdStr);
        }

        // Broadcast real-time
        const io = req.app.get("io");
        if (io) {
            if (conversation.isGroup) {
                conversation.participants.forEach(p => {
                    if (String(p) !== String(senderId)) {
                        io.to(String(p)).emit("new_message", message);
                    }
                });
            } else {
                const rawTarget = recipientId || conversation.participants.find(p => String(p._id || p) !== String(senderId));
                const targetIdStr = String(rawTarget?._id || rawTarget);
                io.to(targetIdStr).emit("new_message", message);
            }
            io.to(String(senderId?._id || senderId)).emit("message_sent", message);
        }

        res.status(201).json({ success: true, message });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(500).json({ success: false, message: "Error sending message" });
    }
};

// MARK messages as read
const markConversationAsRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        if (!conversation.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({ success: false, message: "Unauthorized access" });
        }

        await Message.updateMany(
            { conversationId, recipient: userId, read: false },
            { $set: { read: true } }
        );

        await Conversation.findByIdAndUpdate(conversationId, {
            $set: { [`unreadCounts.${userId}`]: 0 }
        });

        res.status(200).json({ success: true, message: "Conversation marked as read" });
    } catch (error) {
        console.error("Read message error:", error);
        res.status(500).json({ success: false, message: "Error marking messages as read" });
    }
};

// DELETE a single message
const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user.userId;

        const message = await Message.findById(messageId);
        if (!message) {
            console.log(`Message not found: ${messageId}`);
            return res.status(404).json({ success: false, message: "Message not found" });
        }

        console.log(`Delete attempt: MsgSender=${message.sender}, ReqUser=${userId}`);

        // Only sender can delete for now, or add logic for recipient to delete for themselves
        const comparisonUserId = (userId || "").toString();
        if (message.sender.toString() !== comparisonUserId) {
            console.log(`Unauthorized delete attempt: ${message.sender} !== ${comparisonUserId}`);
            return res.status(403).json({ success: false, message: "Unauthorized to delete this message" });
        }

        await Message.findByIdAndDelete(messageId);

        res.status(200).json({ success: true, message: "Message deleted" });
    } catch (error) {
        console.error("Delete message error:", error);
        res.status(500).json({ success: false, message: "Error deleting message" });
    }
};

// DELETE/CLEAR all messages in a conversation
const clearConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        // Verify user is participant
        const conversation = await Conversation.findOne({
            _id: conversationId,
            participants: userId
        });

        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        // Delete all messages
        await Message.deleteMany({ conversationId });

        // Reset lastMessage and unread counts for both
        await Conversation.findByIdAndUpdate(conversationId, {
            $set: { 
                lastMessage: null,
                unreadCounts: {
                    [conversation.participants[0]]: 0,
                    [conversation.participants[1]]: 0
                }
            }
        });

        res.status(200).json({ success: true, message: "Chat cleared successfully" });
    } catch (error) {
        console.error("Clear chat error:", error);
        res.status(500).json({ success: false, message: "Error clearing chat" });
    }
};

// UPDATE Itinerary (Add/Remove Pin)
const updateChatItinerary = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { lat, lng, cityName, postId, action } = req.body; // action: 'add' or 'remove'
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });

        if (!conversation.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({ success: false, message: "Unauthorized access" });
        }

        if (action === 'add') {
            conversation.itinerary.push({ lat, lng, cityName, postId, addedBy: userId });
        } else if (action === 'remove') {
            // Remove by matching lat/lng or ID
            conversation.itinerary = conversation.itinerary.filter(p => 
                p.lat !== lat || p.lng !== lng
            );
        }

        await conversation.save();
        await conversation.populate("itinerary.postId", "title photos price rating");

        // Broadcast updated itinerary
        const io = req.app.get("io");
        if (io) {
            conversation.participants.forEach(p => {
                io.to(String(p)).emit("itinerary_updated", {
                    conversationId,
                    itinerary: conversation.itinerary
                });
            });
        }

        res.status(200).json({ success: true, itinerary: conversation.itinerary });
    } catch (error) {
        console.error("Update itinerary error:", error);
        res.status(500).json({ success: false, message: "Error updating itinerary" });
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
    clearConversation,
    updateChatItinerary
};
