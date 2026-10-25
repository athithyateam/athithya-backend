const { chatService } = require("../../services/chatService");

/**
 * Returns privacy-preserving chat activity metrics and session summaries for the Admin Panel.
 * No private message body or sensitive text is ever exposed.
 */
exports.getChatActivity = async (req, res) => {
    try {
        const { metrics, sessions } = await chatService.getAdminChatActivity();
        res.status(200).json({
            success: true,
            metrics,
            sessions
        });
    } catch (error) {
        console.error("Error in getChatActivity:", error);
        res.status(500).json({ success: false, message: "Failed to load chat activity" });
    }
};
