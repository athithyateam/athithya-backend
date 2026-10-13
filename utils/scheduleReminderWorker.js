const { GuestSchedule, Notification } = require("../db/mongoose");
const { sendHtmlEmail } = require("./emailService");

/**
 * Periodically check for due guest experience schedules, send in-app bell
 * notifications and emails, and auto-delete completed schedule records.
 *
 * @param {Object} app - Express app instance (to access Socket.io)
 */
function startScheduleReminderWorker(app) {
    // Run worker every 30 seconds
    setInterval(async () => {
        try {
            const now = new Date();
            const dueSchedules = await GuestSchedule.find({
                status: 'scheduled',
                scheduledDateTime: { $lte: now }
            })
            .populate('user', 'firstname lastname email')
            .populate('post', 'title photos images');

            if (!dueSchedules || dueSchedules.length === 0) return;

            for (const sch of dueSchedules) {
                if (!sch.user || !sch.post) {
                    await GuestSchedule.findByIdAndDelete(sch._id);
                    continue;
                }

                const dateStr = sch.scheduledDate;
                const timeStr = sch.scheduledTime;
                const postTitle = sch.post.title || "Experience";
                const guestName = sch.user.firstname || "guest";

                // 1. Send In-App Bell Notification
                const notifMessage = `Dear guest ${guestName}, your scheduled experience "${postTitle}" for ${dateStr} at ${timeStr} has arrived! Click here to open and book your trip.`;

                try {
                    const notif = await Notification.create({
                        recipient: sch.user._id,
                        sender: sch.user._id,
                        title: "Scheduled Experience Reminder",
                        message: notifMessage,
                        type: 'info',
                        link: `/post/${sch.post._id}`,
                        metadata: { postId: sch.post._id }
                    });

                    const io = app?.get ? app.get("io") : null;
                    if (io) {
                        io.to(sch.user._id.toString()).emit("new_notification", notif);
                    }
                } catch (notifErr) {
                    console.error("Failed to create reminder bell notification:", notifErr);
                }

                // 2. Send Reminder Email
                if (sch.user.email) {
                    const emailSubject = `Reminder: Scheduled Experience - ${postTitle}`;
                    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
                    const postUrl = `${baseUrl}/post/${sch.post._id}`;

                    const emailHtml = `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
                            <div style="background-color: #1a1a1a; padding: 25px; border-radius: 12px 12px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 3px; font-weight: 800;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 30px 25px;">
                                <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Scheduled Experience Reminder</h2>
                                <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                                    Dear guest <strong>${guestName}</strong>, your scheduled experience <strong>"${postTitle}"</strong> for <strong>${dateStr}</strong> at <strong>${timeStr}</strong> has arrived!
                                </p>
                                <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
                                    Click below to open the experience page and book your trip:
                                </p>
                                <div style="text-align: center; margin: 30px 0;">
                                    <a href="${postUrl}" style="background-color: #C59A2F; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: 800; text-transform: uppercase; font-size: 13px; letter-spacing: 1.5px; display: inline-block;">View & Book Experience</a>
                                </div>
                                <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                                    Best regards,<br>
                                    <strong style="color: #111827;">The Athithya Team</strong>
                                </p>
                            </div>
                        </div>
                    `;

                    sendHtmlEmail(sch.user.email, emailSubject, emailHtml).catch(err => {
                        console.error(`Failed to send schedule reminder email to ${sch.user.email}:`, err);
                    });
                }

                // 3. Auto-Cleanup: Delete the schedule record as reminder has been delivered
                await GuestSchedule.findByIdAndDelete(sch._id);
            }
        } catch (err) {
            console.error("Error in scheduleReminderWorker:", err);
        }
    }, 30000); // 30 seconds interval
}

module.exports = { startScheduleReminderWorker };
