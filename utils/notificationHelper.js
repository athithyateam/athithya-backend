const { Notification, User } = require("../db/mongoose");
const { sendHtmlEmail } = require("../services/emailService");

/**
 * Creates an in-app notification, emits it via Socket.io in real-time,
 * and sends an email notification to the recipient.
 *
 * @param {Object} io - Socket.io instance
 * @param {Object} options
 * @param {string|ObjectId} options.recipientId - Recipient user ID
 * @param {string|ObjectId} [options.senderId] - Sender user ID
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message body
 * @param {string} [options.type] - Notification type
 * @param {string} [options.link] - Action URL link
 * @param {Object} [options.metadata] - Extra metadata
 * @param {string} [options.emailSubject] - Custom email subject
 * @param {string} [options.emailHtml] - Custom email HTML
 */
async function sendPlatformNotification(io, {
    recipientId,
    senderId,
    title,
    message,
    type = "info",
    link = "/",
    metadata = {},
    emailSubject,
    emailHtml
}) {
    try {
        if (!recipientId) return null;

        // 1. Create DB notification
        const notif = await Notification.create({
            recipient: recipientId,
            sender: senderId || recipientId,
            title,
            message,
            type,
            link,
            metadata
        });

        // Populate sender if available
        if (senderId) {
            await notif.populate("sender", "firstname lastname avatar");
        }

        // 2. Emit real-time socket event
        if (io) {
            const recipientRoom = recipientId.toString();
            io.to(recipientRoom).emit("new_notification", notif);
        }

        // 3. Send email to recipient
        const recipientUser = await User.findById(recipientId).select("email firstname lastname");
        if (recipientUser && recipientUser.email) {
            const subject = emailSubject || `${title} - Athithya`;
            const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
            const actionLink = link.startsWith("http") ? link : `${frontendUrl}${link}`;
            
            const html = emailHtml || `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; background-color: #ffffff;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 24px;">
                        <h2 style="color: #1a1a1a; margin-top: 0; font-size: 18px;">${title}</h2>
                        <p style="color: #555; font-size: 15px; line-height: 1.6;">Hello ${recipientUser.firstname || "there"},</p>
                        <p style="color: #444; font-size: 15px; line-height: 1.6;">${message}</p>
                        <div style="margin: 28px 0; text-align: center;">
                            <a href="${actionLink}" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                                View on Athithya
                            </a>
                        </div>
                        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">
                            You received this notification because of activity on your Athithya account.
                        </p>
                    </div>
                </div>
            `;

            sendHtmlEmail(recipientUser.email, subject, html).catch(err => {
                console.error(`Failed to send notification email to ${recipientUser.email}:`, err);
            });
        }

        return notif;
    } catch (err) {
        console.error("Error in sendPlatformNotification:", err);
        return null;
    }
}

module.exports = { sendPlatformNotification };
