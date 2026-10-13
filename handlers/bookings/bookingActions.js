const { Booking, Notification } = require("../../db/mongoose");
const { sendHtmlEmail } = require("../../utils/emailService");

exports.acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { hostResponse } = req.body;

        const booking = await Booking.findById(bookingId).populate('guest', 'firstname lastname email').populate('post', 'title');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Cannot accept ${booking.status} booking` });
        }

        booking.status = 'accepted';
        booking.hostResponse = hostResponse || "";
        booking.respondedAt = new Date();
        await booking.save();

        const io = req.app.get("io");
        const notif = await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Booking Accepted",
            message: `Your booking request for "${booking.postTitle}" has been accepted!`,
            type: 'booking_accepted',
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        }).save();
        if (io) {
            io.to(booking.guest._id.toString()).emit("new_notification", notif);
        }

        if (booking.guest?.email) {
            const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
            sendHtmlEmail(
                booking.guest.email,
                `Booking Accepted: ${booking.postTitle || "Experience"} - Athithya`,
                `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; background-color: #ffffff;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 24px; text-align: center;">
                        <h2 style="color: #1a1a1a; margin-top: 0; font-size: 20px;">Booking Confirmed!</h2>
                        <p style="color: #555; font-size: 15px; line-height: 1.6;">Hello ${booking.guest.firstname || "there"},</p>
                        <p style="color: #555; font-size: 15px; line-height: 1.6;">Your host has accepted your booking request for <strong>${booking.postTitle || "your experience"}</strong>!</p>
                        <div style="margin: 32px 0;">
                            <a href="${frontendUrl}/bookings/${booking._id}" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                                View Booking Details
                            </a>
                        </div>
                    </div>
                </div>
                `
            ).catch(err => console.error("Failed to send booking acceptance email:", err));
        }

        const result = booking.toObject();
        if (result.guest) {
            delete result.guest.email;
        }

        res.status(200).json({ success: true, message: "Booking accepted successfully", data: result });

    } catch (error) {
        console.error("Error accepting booking:", error);
        res.status(500).json({ success: false, message: "Failed to accept booking" });
    }
};

exports.declineBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { hostResponse } = req.body;

        const booking = await Booking.findById(bookingId).populate('guest', 'firstname lastname email').populate('post', 'title');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Cannot decline ${booking.status} booking` });
        }

        booking.status = 'declined';
        booking.hostResponse = hostResponse || "";
        booking.respondedAt = new Date();
        await booking.save();

        const io = req.app.get("io");
        const notif = await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Booking Declined",
            message: `Your booking request for "${booking.postTitle}" has been declined`,
            type: 'booking_declined',
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        }).save();
        if (io) {
            io.to(booking.guest._id.toString()).emit("new_notification", notif);
        }

        if (booking.guest?.email) {
            const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
            sendHtmlEmail(
                booking.guest.email,
                `Booking Update: ${booking.postTitle || "Experience"} - Athithya`,
                `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; background-color: #ffffff;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 26px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 24px; text-align: center;">
                        <h2 style="color: #1a1a1a; margin-top: 0; font-size: 20px;">Booking Request Declined</h2>
                        <p style="color: #555; font-size: 15px; line-height: 1.6;">Hello ${booking.guest.firstname || "there"},</p>
                        <p style="color: #555; font-size: 15px; line-height: 1.6;">Your booking request for <strong>${booking.postTitle || "this experience"}</strong> could not be accommodated at this time.</p>
                        <div style="margin: 32px 0;">
                            <a href="${frontendUrl}/explore" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                                Explore Other Experiences
                            </a>
                        </div>
                    </div>
                </div>
                `
            ).catch(err => console.error("Failed to send booking decline email:", err));
        }

        const result = booking.toObject();
        if (result.guest) {
            delete result.guest.email;
        }

        res.status(200).json({ success: true, message: "Booking declined successfully", data: result });

    } catch (error) {
        console.error("Error declining booking:", error);
        res.status(500).json({ success: false, message: "Failed to decline booking" });
    }
};

exports.requestCancellation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { reason } = req.body;

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.guest.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        booking.status = 'cancel_requested';
        booking.cancellationReason = reason || "No reason provided";
        await booking.save();

        await new Notification({
            recipient: booking.host,
            sender: req.user.userId,
            title: "Cancellation Requested",
            message: `Guest has requested to cancel their booking for "${booking.postTitle}"`,
            type: 'booking_cancelled',
            link: `/profile`
        }).save();

        res.json({ success: true, message: "Cancellation request sent", data: booking });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.approveCancellation = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        booking.status = 'cancelled';
        booking.paymentStatus = 'refund_pending';
        await booking.save();

        await new Notification({
            recipient: booking.guest,
            sender: req.user.userId,
            title: "Cancellation Approved",
            message: `Your cancellation request for "${booking.postTitle}" has been approved. Refund is processing.`,
            type: 'booking_cancelled',
            link: `/profile`
        }).save();

        res.json({ success: true, message: "Cancellation approved", data: booking });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const { generateOTP, sendOTPEmail } = require("../../utils/emailService");

exports.sendStartOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId).populate('guest', 'firstname lastname email');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'accepted') {
            return res.status(400).json({ success: false, message: "Booking must be accepted to start the journey" });
        }

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        booking.startOTP = otp;
        booking.startOTPExpiresAt = expiresAt;
        await booking.save();

        // Print to console for easy testing bypass
        console.log(`\n========================================`);
        console.log(`[JOURNEY CHECK-IN OTP] Booking: ${bookingId}, OTP: ${otp}, Guest: ${booking.guest?.email}`);
        console.log(`========================================\n`);

        // Send Email to Guest
        await sendOTPEmail(
            booking.guest?.email,
            otp,
            "Athithya - Your Check-in OTP",
            `Check-in OTP for "${booking.postTitle}"`
        );

        res.status(200).json({ success: true, message: "Check-in OTP sent successfully to guest's email" });
    } catch (error) {
        console.error("Error in sendStartOTP:", error);
        res.status(500).json({ success: false, message: "Failed to send check-in OTP" });
    }
};

exports.verifyStartOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { otp } = req.body;

        if (!otp) return res.status(400).json({ success: false, message: "OTP code is required" });

        const booking = await Booking.findById(bookingId)
            .populate('guest', 'firstname lastname email')
            .populate('host', 'firstname lastname email');
            
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host._id.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'accepted') {
            return res.status(400).json({ success: false, message: "Booking must be accepted to verify check-in" });
        }

        if (!booking.startOTP || booking.startOTP !== otp.trim()) {
            return res.status(400).json({ success: false, message: "Invalid OTP code" });
        }

        if (new Date() > new Date(booking.startOTPExpiresAt)) {
            return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        // OTP is correct! Update status and set start timestamp
        booking.status = 'in_progress';
        booking.journeyStartedAt = new Date();
        // Clear OTP fields
        booking.startOTP = undefined;
        booking.startOTPExpiresAt = undefined;
        await booking.save();

        // Notify Admin via email
        const adminEmail = "teamsathithya@gmail.com";
        const adminSubject = `Journey Started - Booking #${bookingId}`;
        const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA JOURNEY</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Journey Started Successfully</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        <strong>${booking.guest?.firstname} ${booking.guest?.lastname}</strong> has checked in and started their journey for <strong>"${booking.postTitle}"</strong>.
                    </p>
                    <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Guest Name:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.guest?.firstname} ${booking.guest?.lastname}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Host Name:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.host?.firstname} ${booking.host?.lastname}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Experience:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.postTitle}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Check-in Time:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.journeyStartedAt.toLocaleString()}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
        const { sendHtmlEmail } = require("../../utils/emailService");
        sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin journey start email:", err));

        // Create notification for Guest
        await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Check-in Confirmed",
            message: `Your check-in for "${booking.postTitle}" has been verified! Have a great trip!`,
            type: 'booking_accepted',
            link: `/bookings/${booking._id}`
        }).save();

        // Emit real-time update
        const io = req.app.get("io");
        if (io) {
            io.emit("journey_status_updated", { bookingId: booking._id, status: 'in_progress' });
        }

        res.status(200).json({ success: true, message: "Check-in verified successfully. Journey has started!", data: booking });
    } catch (error) {
        console.error("Error in verifyStartOTP:", error);
        res.status(500).json({ success: false, message: "Failed to verify check-in OTP" });
    }
};

exports.sendCompletionOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId).populate('guest', 'firstname lastname email');
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'in_progress') {
            return res.status(400).json({ success: false, message: "Journey must be active (in progress) to complete it" });
        }

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        booking.completionOTP = otp;
        booking.completionOTPExpiresAt = expiresAt;
        await booking.save();

        // Print to console for easy testing bypass
        console.log(`\n========================================`);
        console.log(`[JOURNEY COMPLETION OTP] Booking: ${bookingId}, OTP: ${otp}, Guest: ${booking.guest?.email}`);
        console.log(`========================================\n`);

        // Send Email to Guest
        await sendOTPEmail(
            booking.guest?.email,
            otp,
            "Athithya - Your Checkout OTP",
            `Journey Completion OTP for "${booking.postTitle}"`
        );

        res.status(200).json({ success: true, message: "Checkout OTP sent successfully to guest's email" });
    } catch (error) {
        console.error("Error in sendCompletionOTP:", error);
        res.status(500).json({ success: false, message: "Failed to send checkout OTP" });
    }
};

exports.verifyCompletionOTP = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { otp } = req.body;

        if (!otp) return res.status(400).json({ success: false, message: "OTP code is required" });

        const booking = await Booking.findById(bookingId)
            .populate('guest', 'firstname lastname email')
            .populate('host', 'firstname lastname email');

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

        if (booking.host._id.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (booking.status !== 'in_progress') {
            return res.status(400).json({ success: false, message: "Journey must be active to verify checkout" });
        }

        if (!booking.completionOTP || booking.completionOTP !== otp.trim()) {
            return res.status(400).json({ success: false, message: "Invalid OTP code" });
        }

        if (new Date() > new Date(booking.completionOTPExpiresAt)) {
            return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        // OTP is correct! Update status and set completion timestamp
        booking.status = 'completed';
        booking.journeyCompletedAt = new Date();
        // Clear OTP fields
        booking.completionOTP = undefined;
        booking.completionOTPExpiresAt = undefined;
        await booking.save();

        // Broadcast real-time chat update to Guest and Host (chat remains open)
        try {
            const io = req.app?.get("io");
            if (io && booking.guest && booking.host) {
                const guestIdStr = (booking.guest._id || booking.guest).toString();
                const hostIdStr = (booking.host._id || booking.host).toString();
                io.to(guestIdStr).emit("chat_eligibility_updated", {
                    canChat: true,
                    isGuest: true,
                    hostId: hostIdStr
                });
                io.to(hostIdStr).emit("chat_eligibility_updated", {
                    canChat: true,
                    isGuest: false
                });
            }
        } catch (socketErr) {
            console.error("Failed to broadcast chat_eligibility_updated on OTP verification:", socketErr);
        }

        // Notify Admin via email
        const adminEmail = "teamsathithya@gmail.com";
        const adminSubject = `Journey Completed - Booking #${bookingId}`;
        const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA JOURNEY</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Journey Completed Successfully</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        <strong>${booking.guest?.firstname} ${booking.guest?.lastname}</strong> has successfully completed their experience with host <strong>${booking.host?.firstname} ${booking.host?.lastname}</strong>.
                    </p>
                    <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Guest Name:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.guest?.firstname} ${booking.guest?.lastname}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Host Name:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.host?.firstname} ${booking.host?.lastname}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Experience:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.postTitle}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Completion Time:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${booking.journeyCompletedAt.toLocaleString()}</td>
                        </tr>
                    </table>
                    <p style="color: #555; font-size: 14px; margin-top: 25px;">
                        This booking is now ready for payout processing.
                    </p>
                </div>
            </div>
        `;
        const { sendHtmlEmail } = require("../../utils/emailService");
        sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin journey complete email:", err));

        // Create notification for Guest to share review
        await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Journey Completed! Share your experience",
            message: `Thank you for choosing Athithya! Please share your experience and review "${booking.postTitle}".`,
            type: 'booking_accepted',
            link: `/post/${booking.post}?type=${booking.postType || 'experience'}`
        }).save();

        // Send email to Guest prompting for a review
        if (booking.guest?.email) {
            const guestSubject = `Thank you for choosing Athithya - Share your experience`;
            const guestHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: #333; margin-top: 0;">Thank you for choosing Athithya!</h2>
                        <p style="color: #555; font-size: 16px; line-height: 1.6;">
                            Hi ${booking.guest?.firstname || "Traveler"},<br/><br/>
                            We hope you had an incredible journey experiencing <strong>"${booking.postTitle}"</strong> with your host <strong>${booking.host?.firstname || "Host"}</strong>!<br/><br/>
                            Please share your experience with other travelers by leaving a review on the experience page. Your feedback is highly appreciated!
                        </p>
                        <div style="text-align: center; margin-top: 30px;">
                            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/post/${booking.post}?type=${booking.postType || 'experience'}" style="background-color: #C59A2F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px;">Leave a Review</a>
                        </div>
                    </div>
                </div>
            `;
            sendHtmlEmail(booking.guest.email, guestSubject, guestHtml).catch(err => console.error("Failed to send guest journey completed email:", err));
        }

        // Emit real-time update
        const io = req.app.get("io");
        if (io) {
            io.emit("journey_status_updated", { bookingId: booking._id, status: 'completed' });
        }

        res.status(200).json({ success: true, message: "Checkout verified successfully. Journey completed!", data: booking });
    } catch (error) {
        console.error("Error in verifyCompletionOTP:", error);
        res.status(500).json({ success: false, message: "Failed to verify checkout OTP" });
    }
};

const { User } = require("../../db/mongoose");

exports.acceptOrphanedBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId)
            .populate('guest', 'firstname lastname email')
            .populate('post', 'title');

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        booking.status = 'accepted';
        await booking.save();

        const experienceTitle = booking.postTitle || booking.post?.title || "experience";

        // 1. Notify the friend via website notification
        const io = req.app.get("io");
        const notif = await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Booking Confirmed!",
            message: `Congratulations! Your booking for "${experienceTitle}" has been successfully confirmed!`,
            type: 'orphaned_invite_accepted',
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        }).save();
        if (io) {
            io.to(booking.guest._id.toString()).emit("new_notification", notif);
        }

        // 2. Notify the friend via Email
        const emailSubject = `Booking Confirmed - Athithya`;
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Congratulations!</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        Hi ${booking.guest?.firstname || "Traveler"},<br/><br/>
                        Your booking for the experience <strong>"${experienceTitle}"</strong> has been successfully confirmed by the host!
                    </p>
                </div>
            </div>
        `;
        if (booking.guest?.email) {
            sendHtmlEmail(booking.guest.email, emailSubject, emailHtml).catch(err => console.error("Failed to send acceptance email:", err));
        }

        const result = booking.toObject();
        if (result.guest) {
            delete result.guest.email;
        }

        res.status(200).json({ success: true, message: "Booking accepted successfully", data: result });
    } catch (error) {
        console.error("Error accepting orphaned booking:", error);
        res.status(500).json({ success: false, message: "Failed to accept booking" });
    }
};

exports.rejectOrphanedBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId)
            .populate('guest')
            .populate('post', 'title');

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        if (booking.host.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        booking.status = 'cancelled';
        booking.paymentStatus = 'refunded';
        await booking.save();

        // Calculate refund amount: total amount paid minus platform fee
        const refundAmount = Math.max(0, booking.totalAmount - booking.platformFee);

        // Credit to wallet
        const guestUser = await User.findById(booking.guest._id);
        if (guestUser) {
            guestUser.walletBalance = (guestUser.walletBalance || 0) + refundAmount;
            await guestUser.save();
        }

        const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "Traveler";
        const experienceTitle = booking.postTitle || booking.post?.title || "experience";

        // 1. Notify the friend via website notification
        const io = req.app.get("io");
        const notif = await new Notification({
            recipient: booking.guest._id,
            sender: req.user.userId,
            title: "Booking Declined",
            message: `Hi ${guestName}, Unfortunately, the host declined the booking you were invited to. We have credited ${refundAmount.toLocaleString()} to your wallet, which you can use for your next experience. (₹${booking.platformFee} platform fee is non-refundable).`,
            type: 'orphaned_invite_declined',
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        }).save();
        if (io) {
            io.to(booking.guest._id.toString()).emit("new_notification", notif);
        }

        // 2. Notify the friend via Email
        const emailSubject = `Booking Update - Athithya`;
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Booking Update</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        Hi ${guestName},<br/><br/>
                        Unfortunately, the host declined the booking for the experience <strong>"${experienceTitle}"</strong> that you were invited to.<br/><br/>
                        We have credited <strong>${refundAmount.toLocaleString()}</strong> to your wallet for future bookings. Please note that the platform fee of ₹${booking.platformFee} is non-refundable.
                    </p>
                </div>
            </div>
        `;
        if (booking.guest?.email) {
            sendHtmlEmail(booking.guest.email, emailSubject, emailHtml).catch(err => console.error("Failed to send rejection email:", err));
        }

        res.status(200).json({ success: true, message: "Booking declined successfully and wallet credited", refundAmount });
    } catch (error) {
        console.error("Error declining orphaned booking:", error);
        res.status(500).json({ success: false, message: "Failed to decline booking" });
    }
};


