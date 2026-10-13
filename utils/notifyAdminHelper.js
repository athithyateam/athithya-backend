const { User, Notification } = require("../db/mongoose");
const { sendHtmlEmail } = require("./emailService");

/**
 * Helper to notify all admins via both in-app notification bell (DB + Socket.io)
 * and HTML email for any pending host action.
 *
 * @param {Object} reqOrApp - Express req or app object (to extract Socket.io instance)
 * @param {Object} payload
 * @param {string} payload.senderId - User ID of the host/user taking action
 * @param {string} payload.title - Notification title (e.g. "Experience Hide Request")
 * @param {string} payload.message - Notification message body
 * @param {string} [payload.link] - Clickable link for admin panel
 * @param {string} [payload.type] - Notification type ('info', 'warning', 'success')
 * @param {string} payload.emailSubject - Subject line for admin email
 * @param {string} payload.emailHtml - HTML content for admin email
 * @param {Object} [payload.metadata] - Optional metadata object
 */
async function notifyAdmins(reqOrApp, { senderId, title, message, link = "/admin", type = "info", emailSubject, emailHtml, metadata = {} }) {
    try {
        const admins = await User.find({ role: "admin" });

        const appInstance = reqOrApp?.app || reqOrApp;
        const io = appInstance?.get ? appInstance.get("io") : appInstance?.io;
        const fallbackAdminEmail = process.env.ADMIN_EMAIL || "athithya76@gmail.com";
        const emailedAddresses = new Set();

        if (admins && admins.length > 0) {
            for (const admin of admins) {
                // 1. In-app bell notification
                try {
                    const notif = await Notification.create({
                        recipient: admin._id,
                        sender: senderId || admin._id,
                        title: title,
                        message: message,
                        link: link,
                        type: type,
                        metadata: metadata
                    });

                    if (io) {
                        io.to(admin._id.toString()).emit("new_notification", notif);
                    }
                } catch (notifErr) {
                    console.error(`Failed to create bell notification for admin ${admin._id}:`, notifErr);
                }

                // 2. Email notification
                if (admin.email && !emailedAddresses.has(admin.email.toLowerCase())) {
                    sendHtmlEmail(admin.email, emailSubject, emailHtml).catch(err =>
                        console.error(`Failed to send email to admin ${admin.email}:`, err)
                    );
                    emailedAddresses.add(admin.email.toLowerCase());
                }
            }
        }

        // Send to fallback admin email if not already emailed
        if (fallbackAdminEmail && !emailedAddresses.has(fallbackAdminEmail.toLowerCase())) {
            sendHtmlEmail(fallbackAdminEmail, emailSubject, emailHtml).catch(err =>
                console.error(`Failed to send fallback admin email to ${fallbackAdminEmail}:`, err)
            );
        }
    } catch (err) {
        console.error("Error in notifyAdmins helper:", err);
    }
}

module.exports = { notifyAdmins };
