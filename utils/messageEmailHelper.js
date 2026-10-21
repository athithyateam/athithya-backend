const { User } = require("../db/mongoose");
const { sendHtmlEmail } = require("../services/emailService");

// In-memory debounce cache to avoid sending dozens of emails if users are chatting rapidly
// Map<recipientId_senderId, timestamp>
const lastEmailedMap = new Map();
const EMAIL_DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes between email alerts per sender-recipient pair

/**
 * Sends an email notification to the recipient of a new direct message,
 * with a "View Message" button redirecting to login/chat, without revealing message text.
 *
 * @param {Object} sender - Sender user object or populated document with firstname, lastname
 * @param {string|ObjectId} recipientId - Recipient user ID
 */
async function notifyRecipientOfNewMessage(sender, recipientId) {
    try {
        if (!recipientId || !sender) return;

        const cleanSenderId = String(sender._id || sender.id || sender);
        const cleanRecipientId = String(recipientId._id || recipientId.id || recipientId);

        if (cleanSenderId === cleanRecipientId) return;

        const debounceKey = `${cleanRecipientId}_${cleanSenderId}`;
        const lastSent = lastEmailedMap.get(debounceKey);
        const now = Date.now();

        if (lastSent && (now - lastSent) < EMAIL_DEBOUNCE_MS) {
            return; // Already notified recently
        }
        lastEmailedMap.set(debounceKey, now);

        const recipient = await User.findById(cleanRecipientId).select("email firstname lastname");
        if (!recipient || !recipient.email) return;

        const senderFirstName = sender.firstname || "A user";
        const senderLastName = sender.lastname ? ` ${sender.lastname}` : "";
        const senderDisplayName = `${senderFirstName}${senderLastName}`.trim();

        const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
        const loginUrl = `${frontendUrl}/login?redirect=/chat`;

        const subject = `You have a new message from ${senderFirstName} on Athithya`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; background-color: #ffffff;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 24px; text-align: center;">
                    <h2 style="color: #1a1a1a; margin-top: 0; font-size: 20px;">You Have a New Message</h2>
                    <p style="color: #555; font-size: 15px; line-height: 1.6;">Hello ${recipient.firstname || "there"},</p>
                    <p style="color: #555; font-size: 15px; line-height: 1.6;">
                        You received a new message from <strong>${senderDisplayName}</strong> on Athithya.
                    </p>
                    <div style="margin: 32px 0;">
                        <a href="${loginUrl}" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(197, 154, 47, 0.3);">
                            View Message
                        </a>
                    </div>
                    <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">
                        For privacy, message contents are not displayed in this email. Please log in to your Athithya account to view and reply.
                    </p>
                </div>
            </div>
        `;

        sendHtmlEmail(recipient.email, subject, html).catch(err => {
            console.error(`Failed to send message notification email to ${recipient.email}:`, err);
        });
    } catch (err) {
        console.error("Error in notifyRecipientOfNewMessage:", err);
    }
}

module.exports = { notifyRecipientOfNewMessage };
