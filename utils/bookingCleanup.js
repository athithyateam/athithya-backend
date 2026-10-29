const { GroupBooking, Booking, User } = require("../db/mongoose");
const { notificationService } = require("../services/notificationService");

const checkExpiredGroupBookings = async () => {
    try {
        const ONE_HOUR = 60 * 60 * 1000;
        const now = new Date();

        // Find group bookings in planning status
        const groupBookings = await GroupBooking.find({
            status: 'planning',
            isBooked: false,
            initiatorPaid: false
        }).populate('initiator', 'firstname lastname email');

        for (const schedule of groupBookings) {
            // Find paid friends
            const paidFriends = (schedule.invitedPeople || []).filter(p => p.hasPaid);

            if (paidFriends.length === 0) {
                continue; // No paid friends, let it expire silently or wait
            }

            // Check if any paid friend's invitation has expired (older than 1 hour since invitation was sent)
            const isExpired = paidFriends.some(p => (now.getTime() - new Date(p.invitedAt).getTime()) > ONE_HOUR);

            if (!isExpired) {
                continue; // 1 hour window is still active
            }

            console.log(`[CLEANUP] GroupBooking ${schedule._id} has expired. Initiator failed to pay in time.`);

            // 1. Update group booking status to cancelled
            schedule.status = 'cancelled';
            await schedule.save();

            // 2. Process each paid friend's booking
            for (const friend of paidFriends) {
                try {
                    // Find the friend's booking associated with this group booking
                    const friendBooking = await Booking.findOne({
                        guest: friend.user,
                        groupBookingId: schedule._id,
                        paymentStatus: 'paid'
                    }).populate('guest', 'firstname lastname email');

                    if (!friendBooking) {
                        continue;
                    }

                    const friendName = friendBooking.guest ? `${friendBooking.guest.firstname} ${friendBooking.guest.lastname}` : "Traveler";
                    const experienceTitle = friendBooking.postTitle || friendBooking.post?.title || "experience";

                    // Calculate price detail
                    const paidPriceStr = `₹${friendBooking.totalAmount.toLocaleString()}`;
                    const feeStr = `₹${friendBooking.platformFee.toLocaleString()}`;

                    // --- Send notification and email to the FRIEND ---
                    const friendSubject = `Group Invitation Booking Update - Athithya`;
                    const friendHtml = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                            <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            </div>
                            <div style="padding: 20px;">
                                <h2 style="color: #333; margin-top: 0;">Invitation Booking Status</h2>
                                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                    Hi ${friendBooking.guest?.firstname || "Traveler"},<br/><br/>
                                    The initiator who invited you to the experience <strong>"${experienceTitle}"</strong> did not complete their payment within the 1-hour window.<br/><br/>
                                    We have shared your request with the host to see if they want to accept your booking at the discounted price you paid. We will notify you as soon as they respond!
                                </p>
                            </div>
                        </div>
                    `;

                    await notificationService.sendNotification({
                        recipient: friend.user,
                        sender: schedule.initiator?._id || null,
                        title: "Group Booking Expired",
                        message: `The initiator who invited you to the experience "${experienceTitle}" has not completed their payment. We have sent a request to the host to see if they would like to accept your booking at your discounted price.`,
                        type: 'orphaned_invite_friend_alert',
                        link: `/bookings/${friendBooking._id}`,
                        metadata: { postId: friendBooking.post, bookingId: friendBooking._id },
                        emailSubject: friendSubject,
                        emailHtml: friendHtml
                    });

                    // --- Send notification and email to the HOST ---
                    const hostObj = await User.findById(friendBooking.host);
                    if (hostObj) {
                        const hostSubject = `Guest Booking Needs Your Response - Athithya`;
                        const hostHtml = `
                            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA HOST</h1>
                                </div>
                                <div style="padding: 20px;">
                                    <h2 style="color: #333; margin-top: 0;">Guest Booking Needs Your Response</h2>
                                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                        Dear Host,<br/><br/>
                                        <strong>${friendName}</strong> has paid <strong>${paidPriceStr}</strong> (including <strong>${feeStr}</strong> platform fee) for your experience <strong>"${experienceTitle}"</strong> through our invitation feature.<br/><br/>
                                        However, the group initiator backed out and did not complete their payment. Would you like to entertain this booking at the price paid by the invited guest (${paidPriceStr})?<br/><br/>
                                        Please log in to your Athithya Dashboard notifications to Accept or Reject this request.
                                    </p>
                                </div>
                            </div>
                        `;

                        await notificationService.sendNotification({
                            recipient: hostObj._id,
                            sender: friend.user,
                            title: "Booking Action Required",
                            message: `Dear host, ${friendName} has paid ${paidPriceStr} (including ${feeStr} platform fee) for your experience "${experienceTitle}" through our invitation feature. The initiator has backed out. Would you like to accept this booking for ${paidPriceStr}?`,
                            type: 'orphaned_invite_host_request',
                            link: `/bookings/${friendBooking._id}`,
                            metadata: { postId: friendBooking.post, bookingId: friendBooking._id },
                            emailSubject: hostSubject,
                            emailHtml: hostHtml
                        });
                    }
                } catch (friendErr) {
                    console.error(`Failed to process expired schedule friend details:`, friendErr);
                }
            }
        }
    } catch (err) {
        console.error("Error in checkExpiredGroupBookings cleanup task:", err);
    }
};

module.exports = {
    checkExpiredGroupBookings
};
