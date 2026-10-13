const { User, Conversation, Message } = require("../db/mongoose");
const { sendHtmlEmail } = require("./emailService");
const bcrypt = require("bcryptjs");

/**
 * Handle new user onboarding:
 * 1. Find or create the "Athithya Official" admin account in DB with profile avatar.
 * 2. Send an auto-generated welcome chat message from Athithya Official to the new user.
 * 3. Send a branded welcome email to the new user.
 *
 * @param {Object} req - Express request object (to access Socket.io app instance)
 * @param {Object} user - The newly registered User document
 */
async function triggerNewUserWelcome(req, user) {
    try {
        if (!user || !user._id) return;

        // 1. Locate or create "Athithya Official" admin user
        let adminUser = await User.findOne({
            $or: [
                { firstname: "Athithya", lastname: "Official" },
                { role: "admin", firstname: /athithya/i }
            ]
        });

        if (!adminUser) {
            adminUser = await User.findOne({ role: "admin" });
        }

        if (!adminUser) {
            const hashedPass = await bcrypt.hash(Math.random().toString(36), 10);
            adminUser = await User.create({
                firstname: "Athithya",
                lastname: "Official",
                email: "teamsathithya@gmail.com",
                password: hashedPass,
                role: "admin",
                isVerified: true,
                avatar: { url: "/athithya-logo.png" }
            });
        } else {
            let updated = false;
            if (adminUser.firstname === "Admin" || !adminUser.firstname) {
                adminUser.firstname = "Athithya";
                adminUser.lastname = "Official";
                updated = true;
            }
            if (!adminUser.avatar || !adminUser.avatar.url) {
                adminUser.avatar = { url: "/athithya-logo.png" };
                updated = true;
            }
            if (updated) {
                await adminUser.save();
            }
        }

        // 2. Prepare welcome message text based on role
        const isHost = user.role === 'host';
        const roleText = isHost ? 'host' : 'guest';
        const firstName = user.firstname || (isHost ? 'Host' : 'Guest');
        const welcomeChatText = `Dear ${roleText} ${firstName}, Welcome to Athithya! Thank you for creating an account as a ${roleText} in Athithya! If you have any queries, feel free to share them with us.`;

        // 3. Create or find 1-on-1 Conversation between Admin and New User
        let conversation = await Conversation.findOne({
            participants: { $all: [adminUser._id, user._id], $size: 2 }
        });

        if (!conversation) {
            const unreadMap = new Map();
            unreadMap.set(adminUser._id.toString(), 0);
            unreadMap.set(user._id.toString(), 1);

            conversation = await Conversation.create({
                participants: [adminUser._id, user._id],
                unreadCounts: unreadMap
            });
        }

        // 4. Create Message from Admin to User
        const message = await Message.create({
            conversationId: conversation._id,
            sender: adminUser._id,
            recipient: user._id,
            text: welcomeChatText,
            messageType: 'text'
        });

        // 5. Update Conversation metadata
        const targetUserId = user._id.toString();
        await Conversation.findByIdAndUpdate(conversation._id, {
            $set: {
                lastMessage: {
                    text: welcomeChatText,
                    sender: adminUser._id,
                    createdAt: new Date()
                },
                [`unreadCounts.${targetUserId}`]: 1
            }
        });

        // 6. Real-time Socket.io broadcast to new user
        const io = req?.app?.get ? req.app.get("io") : req?.io;
        if (io) {
            const populatedMsg = await Message.findById(message._id).populate("sender", "firstname lastname avatar");
            io.to(targetUserId).emit("new_message", populatedMsg);
        }

        // 7. Send Welcome Email to User
        const emailSubject = `Welcome to Athithya!`;
        const emailHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
                <div style="background-color: #1a1a1a; padding: 25px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 3px; font-weight: 800;">ATHITHYA</h1>
                </div>
                <div style="padding: 30px 25px;">
                    <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Welcome to Athithya, ${firstName}!</h2>
                    <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                        Dear ${roleText} <strong>${firstName}</strong>, Thank you for creating an account as a <strong>${roleText}</strong> in Athithya! If you have any queries, feel free to share them with us.
                    </p>
                    <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                        Best regards,<br>
                        <strong style="color: #111827;">The Athithya Team</strong>
                    </p>
                </div>
                <div style="background-color: #f9fafb; padding: 15px; border-radius: 0 0 12px 12px; text-align: center; border-top: 1px solid #f3f4f6;">
                    <p style="color: #9ca3af; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} Athithya. All rights reserved.</p>
                </div>
            </div>
        `;

        sendHtmlEmail(user.email, emailSubject, emailHtml).catch(err => {
            console.error("Failed to send welcome email:", err);
        });
    } catch (err) {
        console.error("Error in triggerNewUserWelcome onboarding helper:", err);
    }
}

module.exports = { triggerNewUserWelcome };
