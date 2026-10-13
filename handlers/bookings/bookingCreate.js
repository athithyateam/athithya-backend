const mongoose = require("mongoose");
const { Booking, Post, User, Notification, Schedule } = require("../../db/mongoose");
const { createRazorpayOrder, verifyRazorpaySignature, fetchPaymentDetails } = require("../../utils/razorpay");
const { sendHtmlEmail } = require("../../utils/emailService");
const { triggerHostBookingWelcome } = require("../../utils/hostBookingChatHelper");

exports.createBooking = async (req, res) => {
    try {
        const {
            postId,
            numberOfPeople,
            startDate,
            endDate,
            selectedTime,
            guestMessage,
            invitedUserIds,
            parentBookingId,
            scheduleId
        } = req.body;

        let validInvitedUserObjects = [];
        const validInvitedUserList = Array.isArray(invitedUserIds) ? invitedUserIds : [];
        if (validInvitedUserList.length > 0) {
            validInvitedUserObjects = await User.find({ _id: { $in: validInvitedUserList }, role: { $ne: 'host' } });
        }
        const validInvitedUserIds = validInvitedUserObjects.map(u => u._id);

        const peopleCount = Number(numberOfPeople);
        if (!postId || isNaN(peopleCount) || peopleCount < 1) {
            return res.status(400).json({ success: false, message: "Post ID and a valid number of people (minimum 1) are required" });
        }

        if (peopleCount > 3) {
            return res.status(400).json({ success: false, message: "Maximum 3 travelers allowed per booking" });
        }

        const post = await Post.findById(postId).populate('user');
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }

        if (post.status !== 'active' && post.status !== 'pending') {
            return res.status(400).json({ success: false, message: "This trip is not available for booking" });
        }

        const hostId = post.user?._id || post.user;
        if (!hostId) {
            return res.status(400).json({ success: false, message: "This experience has no valid host assigned" });
        }

        if (String(hostId) === String(req.user?.userId)) {
            return res.status(400).json({ success: false, message: "You cannot book your own trip" });
        }

        if (req.user?.role === 'host') {
            return res.status(400).json({ success: false, message: "Hosts cannot engage with another host's experience. Only guests can." });
        }

        // 5. CALCULATE BASE PRICE & FEES
        const rawBase = Number(post.price?.perPerson ? (post.price.perPerson * Number(numberOfPeople)) : (post.price?.amount || post.price?.total || 0));
        const baseAmount = isNaN(rawBase) ? 0 : Math.max(0, rawBase);
        console.log(`[BOOKING] Base: ${baseAmount}, Travelers: ${numberOfPeople}`);

        let platformFee = 0;
        if (post.price?.perPerson) {
            const perPersonPrice = Number(post.price.perPerson) || 0;
            const feeRate = perPersonPrice < 2000 ? 0.05 : perPersonPrice <= 5000 ? 0.035 : 0.02;
            const rawFeePerPerson = perPersonPrice * feeRate;
            const platformFeePerPerson = rawFeePerPerson < 1 ? Number(rawFeePerPerson.toFixed(2)) : Math.round(rawFeePerPerson);
            platformFee = platformFeePerPerson * Number(numberOfPeople);
        } else {
            const unitPrice = Number(post.price?.amount || post.price?.total || 0);
            const feeRate = unitPrice < 2000 ? 0.05 : unitPrice <= 5000 ? 0.035 : 0.02;
            const rawFee = unitPrice * feeRate;
            platformFee = rawFee < 1 ? Number(rawFee.toFixed(2)) : Math.round(rawFee);
        }

        let discountAmount = 0;
        let discountPercentage = 0;
        let isInviteBooking = false;
        let effectivePeopleForDiscount = numberOfPeople;

        // DETERMINE GROUP SIZE FOR DISCOUNTS
        if (parentBookingId || scheduleId) {
            let groupSource = null;
            try {
                if (scheduleId && mongoose.Types.ObjectId.isValid(scheduleId)) {
                    groupSource = await Schedule.findById(scheduleId);
                } else if (parentBookingId && mongoose.Types.ObjectId.isValid(parentBookingId)) {
                    groupSource = await Booking.findById(parentBookingId);
                }
            } catch (e) {}

            if (groupSource) {
                // Determine if current user is the initiator or an invited guest
                const initiatorId = groupSource.initiator || groupSource.guest;
                const currentUserId = req.user?.userId;
                const isUserInitiator = initiatorId && String(initiatorId) === String(currentUserId);
                
                if (initiatorId && !isUserInitiator) {
                    isInviteBooking = true;
                    
                    // EXPLICIT EXPIRATION CHECK: If invited guest, check their timer
                    const invitedList = groupSource.invitedPeople || [];
                    const myInvite = invitedList.find(inv => String(inv.user?._id || inv.user) === String(currentUserId));
                    
                    if (myInvite && myInvite.status === 'pending') {
                        const ONE_HOUR = 60 * 60 * 1000;
                        const isExpired = (new Date().getTime() - new Date(myInvite.invitedAt).getTime()) > ONE_HOUR;
                        if (isExpired) {
                            return res.status(403).json({ success: false, message: "Your invitation has expired. Please ask the initiator to re-invite you." });
                        }
                    }
                }

                // Initiator's selection (how many people they are paying for)
                const hostCount = Number(groupSource.numberOfPeople) || 1;
                
                if (isUserInitiator) {
                    // Enforce security: Initiator cannot pay until all invited friends have completed payment
                    const invitedPeople = groupSource.invitedPeople || [];
                    if (invitedPeople.length > 0) {
                        const unpaidFriends = invitedPeople.filter(p => !p.hasPaid);
                        if (unpaidFriends.length > 0) {
                            return res.status(400).json({
                                success: false,
                                message: `Cannot complete booking. Waiting for ${unpaidFriends.length} invited friend(s) to pay first.`
                            });
                        }
                    }

                    // For the INITIATOR: Only count friends who have ALREADY paid.
                    // This creates a "pay-it-forward" discount mechanism where the initiator saves 
                    // more only as friends complete their bookings.
                    let paidFriendsCount = 0;
                    if (groupSource.invitedPeople) {
                        paidFriendsCount = (groupSource.invitedPeople || []).filter(p => p && p.hasPaid).length;
                    } else if (groupSource.joinedUsers) {
                        paidFriendsCount = (groupSource.joinedUsers || []).length;
                    }
                    effectivePeopleForDiscount = hostCount + paidFriendsCount;
                } else {
                    // For the INVITED FRIEND: Show them the discount based on the TOTAL planned group.
                    // This matches the frontend breakdown and encourages them to book.
                    let totalInvitedCount = 0;
                    if (groupSource.invitedPeople) {
                        totalInvitedCount = (groupSource.invitedPeople || []).length;
                    } else if (groupSource.invitedUsers) {
                        totalInvitedCount = (groupSource.invitedUsers || []).length;
                    }
                    effectivePeopleForDiscount = hostCount + totalInvitedCount;
                }
            }
        }

        // APPLY DISCOUNTS
        if (post.discounts && post.discounts.length > 0) {
            const sortedDiscounts = [...post.discounts].sort((a, b) => b.threshold - a.threshold);
            const applicable = sortedDiscounts.find(d => effectivePeopleForDiscount >= d.threshold);
            if (applicable) {
                discountPercentage = applicable.percentage;
                discountAmount = Math.round((baseAmount * discountPercentage) / 100);
            }
        }

        const totalAmountRaw = (baseAmount - discountAmount) + platformFee;
        let totalAmount = Math.max(0, totalAmountRaw);
        
        // Razorpay minimum floor: Must be at least 1 INR if not 0
        if (totalAmount > 0 && totalAmount < 1) {
            totalAmount = 1;
        }

        const user = await User.findById(req.user.userId);
        const useWallet = req.body.useWallet === true || req.body.useWallet === 'true';
        let walletAmountUsed = 0;
        if (useWallet && user) {
            // Wallet can only cover the host portion — platform fee must always be paid directly
            const maxWalletUsable = Math.max(0, totalAmount - platformFee);
            walletAmountUsed = Math.min(user.walletBalance || 0, maxWalletUsable);
        }
        const payableAmount = Math.max(platformFee, totalAmount - walletAmountUsed);

        console.log(`[BOOKING] Final Amount: ${totalAmount}, Wallet: ${walletAmountUsed}, Payable: ${payableAmount}`);

        // 7. CREATE RAZORPAY ORDER
        let razorpayOrder = null;
        if (payableAmount > 0) {
            try {
                razorpayOrder = await createRazorpayOrder(payableAmount);
            } catch (rzpErr) {
                console.error("Razorpay order creation failed:", rzpErr);
                return res.status(500).json({ success: false, message: "Payment gateway order failed", error: rzpErr.message });
            }
        }

        // 8. ASSEMBLE & SAVE BOOKING
        const rawPostType = (post.postType || 'experience').toLowerCase();
        const validPostTypes = ['experience', 'service', 'plan', 'trek'];
        const normalizedPostType = validPostTypes.includes(rawPostType) ? rawPostType : 'experience';

        // Helper to parse date and time string into explicit UTC Date object (wall-clock time)
        const parseDateTime = (dStr, tStr) => {
            if (!dStr) return null;
            const cleanD = String(dStr).split('T')[0];
            const parts = cleanD.split('-').map(Number);
            let hours = 0;
            let minutes = 0;

            if (tStr && typeof tStr === 'string' && tStr.trim() !== '') {
                const tUpper = tStr.trim().toUpperCase();
                const match12 = tUpper.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
                if (match12) {
                    let h = parseInt(match12[1], 10);
                    const m = parseInt(match12[2], 10);
                    const period = match12[3];
                    if (period === 'PM' && h < 12) h += 12;
                    if (period === 'AM' && h === 12) h = 0;
                    hours = h;
                    minutes = m;
                }
            } else if (dStr.includes('T')) {
                const parsedIso = new Date(dStr);
                if (!isNaN(parsedIso.getTime())) return parsedIso;
            }

            if (parts.length === 3 && !parts.some(isNaN)) {
                const pH = String(hours).padStart(2, '0');
                const pM = String(minutes).padStart(2, '0');
                return new Date(`${cleanD}T${pH}:${pM}:00.000Z`);
            }
            return new Date(dStr);
        };

        // Compute exact start & end datetime incorporating time & duration
        let computedStartDate = parseDateTime(startDate, selectedTime);

        let computedEndDate = null;
        if (endDate && endDate !== "") {
            computedEndDate = parseDateTime(endDate, null);
        } else if (computedStartDate && !isNaN(computedStartDate.getTime())) {
            computedEndDate = new Date(computedStartDate.getTime());
            const durMinutes = Number(post.duration?.minutes || 0);
            const durHours = Number(post.duration?.hours || (post.price?.period === 'hour' ? (post.duration?.hours || post.duration?.days || 1) : 0));
            const durDays = Number(post.duration?.days || (post.price?.period === 'day' ? (post.duration?.days || 1) : 0));

            if (durMinutes > 0) computedEndDate.setMinutes(computedEndDate.getMinutes() + durMinutes);
            else if (durHours > 0) computedEndDate.setHours(computedEndDate.getHours() + durHours);
            else if (durDays > 0) computedEndDate.setDate(computedEndDate.getDate() + durDays);
        }

        const booking = new Booking({
            guest: req.user.userId,
            host: hostId,
            post: postId,
            postType: normalizedPostType,
            postTitle: post.title || 'Athithya Experience',
            numberOfPeople,
            baseAmount,
            discountAmount,
            discountPercentage,
            platformFee,
            totalAmount,
            walletAmountUsed,
            paidAmount: payableAmount,
            bookingDate: new Date(),
            startDate: computedStartDate,
            endDate: computedEndDate,
            guestMessage: guestMessage || "",
            status: payableAmount > 0 ? 'pending' : 'accepted',
            paymentStatus: payableAmount > 0 ? 'pending' : 'paid',
            orderId: razorpayOrder ? razorpayOrder.id : null,
            invitedUsers: validInvitedUserIds,
            parentBookingId: (parentBookingId && mongoose.Types.ObjectId.isValid(parentBookingId)) ? parentBookingId : null,
            scheduleId: (scheduleId && mongoose.Types.ObjectId.isValid(scheduleId)) ? scheduleId : null,
            isInviteBooking
        });

        await booking.save();
        console.log(`[BOOKING] Saved successful: ${booking._id}`);

        if (payableAmount <= 0) {
            // Trigger automated Host Welcome DM to Guest
            triggerHostBookingWelcome(req, booking).catch(err => console.error("Host welcome DM trigger error:", err));

            // Deduct wallet balance immediately
            if (user && walletAmountUsed > 0) {
                user.walletBalance = Math.max(0, (user.walletBalance || 0) - walletAmountUsed);
                await user.save();
            }

            // Post booking count increment
            try {
                if (booking.post) {
                    const postObj = await Post.findById(booking.post);
                    if (postObj) {
                        postObj.bookingCount = (postObj.bookingCount || 0) + 1;
                        await postObj.save();
                    }
                }
            } catch (postErr) {
                console.error("Failed to increment bookingCount on fully wallet paid booking:", postErr);
            }

            // Sync to parent booking
            if (booking.parentBookingId) {
                try {
                    await Booking.findByIdAndUpdate(booking.parentBookingId, {
                        $push: { joinedUsers: { user: req.user.userId, booking: booking._id } }
                    });
                } catch (parentErr) {
                    console.error("Failed to sync joined friend to parent booking:", parentErr);
                }
            }

            // Link to schedule (Group or Solo)
            try {
                if (booking.scheduleId) {
                    const schedule = await Schedule.findById(booking.scheduleId);
                    const isInitiator = String(schedule.initiator || "").trim() === String(req.user.userId).trim();
                    const updateData = {};
                    let options = { new: true };
                    
                    if (isInitiator) {
                        updateData.isBooked = true;
                        updateData.initiatorPaid = true;
                        updateData.status = 'confirmed';
                    } else {
                        updateData["invitedPeople.$[elem].status"] = 'accepted';
                        updateData["invitedPeople.$[elem].hasPaid"] = true;
                        updateData["invitedPeople.$[elem].respondedAt"] = new Date();
                        options.arrayFilters = [{ "elem.user": new mongoose.Types.ObjectId(req.user.userId) }];
                    }

                    if (!schedule.bookingId || isInitiator) {
                        updateData.bookingId = booking._id;
                    }

                    const freshSchedule = await Schedule.findByIdAndUpdate(
                        booking.scheduleId, 
                        { $set: updateData }, 
                        options
                    ).populate('initiator', 'firstname lastname avatar');

                    const initiatorId = freshSchedule?.initiator?._id || freshSchedule?.initiator;
                    const senderIdStr = String(req.user.userId).trim();
                    const initiatorIdStr = String(initiatorId || "").trim();
                    const isUserInitiatorLocal = senderIdStr === initiatorIdStr;

                    const io = req.app.get("io");

                    // Notify initiator only if SOMEONE ELSE (a friend) joined the group
                    if (initiatorId && !isUserInitiatorLocal) {
                        const guestUser = await User.findById(req.user.userId);
                        const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                        const notifInitiator = await new Notification({
                            recipient: initiatorId,
                            sender: req.user.userId,
                            title: "Friend Joined!",
                            message: `${guestName} has successfully booked and joined your group for "${booking.postTitle}"!`,
                            type: 'invite_accepted',
                            link: `/post/${booking.post?._id || booking.post}?scheduleId=${freshSchedule._id}`,
                            metadata: { scheduleId: freshSchedule._id }
                        }).save();
                        if (io) {
                            io.to(initiatorId.toString()).emit("new_notification", notifInitiator);
                        }
                    }

                    // Notify Host about the new booking update
                    const hostId = booking.post?.user || booking.host;
                    const guestUser = await User.findById(req.user.userId);
                    const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                    const notifHost = await new Notification({
                        recipient: hostId,
                        sender: req.user.userId,
                        title: "Booking Update",
                        message: `${guestName} has joined a group booking for "${booking.postTitle}"`,
                        type: 'invite_accepted',
                        link: `/bookings/${booking._id}`,
                        metadata: { bookingId: booking._id }
                    }).save();
                    if (io) {
                        io.to(hostId.toString()).emit("new_notification", notifHost);
                    }
                }
            } catch (scheduleErr) {
                console.error("Failed to link schedule or send schedule notifications on fully wallet paid booking:", scheduleErr);
            }

            // Send emails
            try {
                const guestName = `${user.firstname || ""} ${user.lastname || ""}`.trim() || "Traveler";
                const hostObj = await User.findById(booking.host);
                const hostName = hostObj ? `${hostObj.firstname || ""} ${hostObj.lastname || ""}`.trim() : "Host";
                const guestEmail = user.email;
                const hostEmail = hostObj?.email;
                const experienceTitle = booking.postTitle || "Athithya Experience";
                
                const startDateStr = booking.startDate ? new Date(booking.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Flexible";
                const endDateStr = booking.endDate ? new Date(booking.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Flexible";

                // 1. ADMIN EMAIL
                const adminEmail = "teamsathithya@gmail.com";
                const adminSubject = `New Experience Booked (Wallet) - Athithya`;
                const adminHtml = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                        <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                        </div>
                        <div style="padding: 20px;">
                            <h2 style="color: #333; margin-top: 0;">New Experience Booked (Fully Covered by Wallet)</h2>
                            <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                <strong>${guestName}</strong> has booked <strong>${hostName}'s</strong> experience in Athithya.
                            </p>
                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Booking Details</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Experience:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${experienceTitle}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Guest:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${guestName} (${guestEmail || "N/A"})</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Host:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${hostName} (${hostEmail || "N/A"})</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Dates:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${startDateStr} to ${endDateStr}</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Travelers:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${booking.numberOfPeople}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Wallet Amount Used:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">₹${booking.walletAmountUsed}</td>
                                </tr>
                            </table>
                        </div>
                    </div>
                `;
                sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin booking email:", err));
            } catch (mailErr) {
                console.error("Critical error building/sending booking confirmation emails on fully wallet paid booking:", mailErr);
            }
        }

        res.status(201).json({
            success: true,
            message: payableAmount > 0 ? "Order created. Payment required." : "Booking successful",
            data: {
                bookingId: booking._id,
                orderId: booking.orderId,
                amount: payableAmount,
                currency: "INR"
            }
        });

    } catch (error) {
        console.error("CRITICAL Booking creation error:", error);
        res.status(500).json({ 
            success: false, 
            message: `Internal Server Error: ${error.message}`, 
            error_details: error.name === 'ValidationError' ? error.errors : null
        });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !bookingId) {
            return res.status(400).json({ success: false, message: "Missing payment verification details" });
        }

        const isVerified = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);

        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Payment verification failed" });
        }

        const booking = await Booking.findById(bookingId)
            .populate('post')
            .populate('guest')
            .populate('host');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        // Validate booking links and user ownership to prevent payment verification bypasses
        if (booking.orderId !== razorpay_order_id) {
            return res.status(400).json({ success: false, message: "Payment signature order ID mismatch" });
        }

        if (booking.guest._id.toString() !== req.user.userId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized payment verification" });
        }

        booking.status = 'accepted';
        booking.paymentStatus = 'paid';
        booking.paymentId = razorpay_payment_id;

        try {
            const extraDetails = await fetchPaymentDetails(razorpay_payment_id);
            booking.paymentDetails = extraDetails;
        } catch (fetchErr) {
            console.error("Failed to fetch extra payment details:", fetchErr);
        }

        await booking.save();

        if (booking.walletAmountUsed > 0) {
            try {
                const guestUser = await User.findById(booking.guest._id || booking.guest);
                if (guestUser) {
                    guestUser.walletBalance = Math.max(0, (guestUser.walletBalance || 0) - booking.walletAmountUsed);
                    await guestUser.save();
                    console.log(`[PAYMENT_VERIFY] Deducted ₹${booking.walletAmountUsed} from guest wallet`);
                }
            } catch (walletErr) {
                console.error("Failed to deduct wallet balance in verifyPayment:", walletErr);
            }
        }

        if (booking.post) {
            try {
                const post = await Post.findById(booking.post._id);
                if (post) {
                    post.bookingCount = (post.bookingCount || 0) + 1;
                    await post.save();
                    console.log(`[PAYMENT_VERIFY] Incremented bookingCount for post ${booking.post._id}`);
                }
            } catch (postErr) {
                console.error("Failed to increment bookingCount on payment verification:", postErr);
            }
        }

        if (booking.host) {
            try {
                const hostUser = await User.findById(booking.host._id || booking.host);
                if (hostUser) {
                    if (!hostUser.verifyBadge) {
                        hostUser.verifyBadge = {
                            enabled: false,
                            requiredBookings: 1,
                            successfulBookingsCount: 0
                        };
                    }
                    hostUser.verifyBadge.successfulBookingsCount = (hostUser.verifyBadge.successfulBookingsCount || 0) + 1;
                    const required = hostUser.verifyBadge.requiredBookings !== undefined ? hostUser.verifyBadge.requiredBookings : 1;
                    if (hostUser.verifyBadge.successfulBookingsCount >= required) {
                        hostUser.verifyBadge.enabled = true;
                    }
                    await hostUser.save();
                    console.log(`[PAYMENT_VERIFY] Incremented successfulBookingsCount for host ${hostUser._id}`);
                }
            } catch (hostErr) {
                console.error("Failed to update host verifyBadge on payment verification:", hostErr);
            }
        }

        // Trigger automated Host Welcome DM to Guest
        triggerHostBookingWelcome(req, booking).catch(err => console.error("Host welcome DM trigger error on verifyPayment:", err));

        // Send Booking Emails
        try {
            const guestName = `${booking.guest?.firstname || ""} ${booking.guest?.lastname || ""}`.trim() || "Traveler";
            const hostName = `${booking.host?.firstname || ""} ${booking.host?.lastname || ""}`.trim() || "Host";
            const guestEmail = booking.guest?.email;
            const hostEmail = booking.host?.email;
            const experienceTitle = booking.postTitle || booking.post?.title || "Athithya Experience";
            
            const startDateStr = booking.startDate ? new Date(booking.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Flexible";
            const endDateStr = booking.endDate ? new Date(booking.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : "Flexible";

            const locationStr = booking.post?.location 
                ? `${booking.post.location.city || ""}, ${booking.post.location.state || ""}, ${booking.post.location.country || ""}`
                : "Online/Flexible";

            // 1. ADMIN EMAIL
            const adminEmail = "teamsathithya@gmail.com";
            const adminSubject = `New Experience Booked - Athithya`;
            const adminHtml = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: #333; margin-top: 0;">New Experience Booked</h2>
                        <p style="color: #555; font-size: 16px; line-height: 1.6;">
                            <strong>${guestName}</strong> has booked <strong>${hostName}'s</strong> experience in Athithya.
                        </p>
                        <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Booking Details</h3>
                        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Experience:</td>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${experienceTitle}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Guest:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${guestName} (${guestEmail || "N/A"})</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Host:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${hostName} (${hostEmail || "N/A"})</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Dates:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${startDateStr} to ${endDateStr}</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Travelers:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${booking.numberOfPeople}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Location:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${locationStr}</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Invite Booking:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${booking.isInviteBooking ? "Yes" : "No"}</td>
                            </tr>
                        </table>

                        <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Financial Summary</h3>
                        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Base Amount:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">₹${booking.baseAmount.toLocaleString()}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Platform Fee:</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">₹${booking.platformFee.toLocaleString()}</td>
                            </tr>
                            <tr style="background-color: #f9f9f9;">
                                <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Discount Applied:</td>
                                <td style="padding: 8px; border: 1px solid #ddd; color: #d9534f;">-₹${booking.discountAmount.toLocaleString()} (${booking.discountPercentage}%)</td>
                            </tr>
                            <tr style="background-color: #f5f5f5;">
                                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; font-size: 16px;">Total Paid:</td>
                                <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; font-size: 16px; color: #C59A2F;">₹${booking.totalAmount.toLocaleString()}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
            sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin booking email:", err));

            // 2. GUEST EMAIL
            if (guestEmail) {
                const guestSubject = `Your Booking Confirmation - Athithya`;
                const guestHtml = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                        <div style="background-color: #1a1a1a; padding: 25px 20px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            <p style="color: #fff; margin: 5px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Booking Confirmed</p>
                        </div>
                        <div style="padding: 20px;">
                            <h2 style="color: #333; margin-top: 0;">Hi ${booking.guest?.firstname || "there"},</h2>
                            <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                Thank you for booking with us! Your reservation for <strong>${experienceTitle}</strong> is successfully confirmed. Here is your receipt and booking breakdown:
                            </p>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Reservation Details</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                                <tr>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #666; width: 40%;">Experience:</td>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #333;">${experienceTitle}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Host:</td>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${hostName}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Dates:</td>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${startDateStr} to ${endDateStr}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Travelers:</td>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${booking.numberOfPeople} person(s)</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #666;">Location:</td>
                                    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${locationStr}</td>
                                </tr>
                            </table>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Receipt Breakdown</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                                <tr>
                                    <td style="padding: 8px; color: #666;">Base Rate:</td>
                                    <td style="padding: 8px; text-align: right; color: #333;">₹${booking.baseAmount.toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; color: #666;">Platform & Service Fees:</td>
                                    <td style="padding: 8px; text-align: right; color: #333;">₹${booking.platformFee.toLocaleString()}</td>
                                </tr>
                                ${booking.discountAmount > 0 ? `
                                <tr>
                                    <td style="padding: 8px; color: #d9534f;">Group Discount Applied:</td>
                                    <td style="padding: 8px; text-align: right; color: #d9534f;">-₹${booking.discountAmount.toLocaleString()} (${booking.discountPercentage}%)</td>
                                </tr>
                                ` : ''}
                                <tr style="border-top: 2px solid #C59A2F; font-weight: bold;">
                                    <td style="padding: 12px 8px; font-size: 16px; color: #1a1a1a;">Total Paid:</td>
                                    <td style="padding: 12px 8px; font-size: 16px; text-align: right; color: #C59A2F;">₹${booking.totalAmount.toLocaleString()}</td>
                                </tr>
                            </table>

                            <div style="margin-top: 30px; padding: 15px; background-color: #f9f9f9; border-radius: 8px; font-size: 12px; color: #666; border: 1px solid #eee;">
                                <strong>Payment Reference:</strong> ${booking.paymentId || "N/A"}<br/>
                                <strong>Razorpay Order ID:</strong> ${booking.orderId || "N/A"}<br/>
                                Please keep this email as verification of your booking. Have an amazing trip!
                            </div>
                        </div>
                    </div>
                `;
                sendHtmlEmail(guestEmail, guestSubject, guestHtml).catch(err => console.error("Failed to send guest booking confirmation email:", err));
            }

            // 3. HOST EMAIL
            if (hostEmail) {
                const hostSubject = `New Booking for Your Experience! - Athithya`;
                const hostHtml = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                        <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                            <p style="color: #fff; margin: 5px 0 0 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Host Alert</p>
                        </div>
                        <div style="padding: 20px;">
                            <h2 style="color: #333; margin-top: 0;">Hi ${booking.host?.firstname || "Host"},</h2>
                            <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                Great news! A traveler has successfully booked your experience <strong>"${experienceTitle}"</strong> in Athithya.
                            </p>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Guest Details</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Name:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${guestName}</td>
                                </tr>
                                ${booking.guestMessage ? `
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Message:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-style: italic;">"${booking.guestMessage}"</td>
                                </tr>
                                ` : ''}
                            </table>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Booking Details</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Experience:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${experienceTitle}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Target Dates:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${startDateStr} to ${endDateStr}</td>
                                </tr>
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Travelers Count:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${booking.numberOfPeople} traveler(s)</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Location:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">${locationStr}</td>
                                </tr>
                            </table>

                            <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Host Rates Summary</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                                <tr style="background-color: #f9f9f9;">
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Gross Rate:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd;">₹${booking.baseAmount.toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Discount Deducted:</td>
                                    <td style="padding: 8px; border: 1px solid #ddd; color: #d9534f;">-₹${booking.discountAmount.toLocaleString()} (${booking.discountPercentage}%)</td>
                                </tr>
                                <tr style="background-color: #f5f5f5;">
                                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; font-size: 15px;">Your Net Payout:</td>
                                    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; font-size: 15px; color: #C59A2F;">₹${(booking.baseAmount - booking.discountAmount).toLocaleString()}</td>
                                </tr>
                            </table>

                            <p style="color: #555; font-size: 14px; margin-top: 25px;">
                                Please log in to your dashboard to check booking details or chat with the guest.
                            </p>
                        </div>
                    </div>
                `;
                sendHtmlEmail(hostEmail, hostSubject, hostHtml).catch(err => console.error("Failed to send host booking email:", err));
            }
        } catch (mailErr) {
            console.error("Critical error building/sending booking confirmation emails:", mailErr);
        }

        if (booking.parentBookingId) {
            try {
                await Booking.findByIdAndUpdate(booking.parentBookingId, {
                    $push: { joinedUsers: { user: req.user.userId, booking: booking._id } }
                });
            } catch (parentErr) {
                console.error("Failed to sync joined friend to parent booking:", parentErr);
            }
        }

        // 3. LINK TO SCHEDULE (Group or Solo)
        try {
            if (booking.scheduleId) {
                    const schedule = await Schedule.findById(booking.scheduleId);
                    const isInitiator = String(schedule.initiator || "").trim() === String(req.user.userId).trim();
                    const updateData = {};
                    let options = { new: true };
                    
                    if (isInitiator) {
                        updateData.isBooked = true;
                        updateData.initiatorPaid = true;
                        updateData.status = 'confirmed';
                    } else {
                        updateData["invitedPeople.$[elem].status"] = 'accepted';
                        updateData["invitedPeople.$[elem].hasPaid"] = true;
                        updateData["invitedPeople.$[elem].respondedAt"] = new Date();
                        options.arrayFilters = [{ "elem.user": new mongoose.Types.ObjectId(req.user.userId) }];
                    }

                    if (!schedule.bookingId || isInitiator) {
                        updateData.bookingId = booking._id;
                    }

                    const freshSchedule = await Schedule.findByIdAndUpdate(
                        booking.scheduleId, 
                        { $set: updateData }, 
                        options
                    ).populate('initiator', 'firstname lastname avatar');

                    const initiatorId = freshSchedule?.initiator?._id || freshSchedule?.initiator;
                    const senderIdStr = String(req.user.userId).trim();
                    const initiatorIdStr = String(initiatorId || "").trim();
                    const isUserInitiatorLocal = senderIdStr === initiatorIdStr;

                    const io = req.app.get("io");

                    // Notify initiator only if SOMEONE ELSE (a friend) joined the group
                    if (initiatorId && !isUserInitiatorLocal) {
                        const guestUser = await User.findById(req.user.userId);
                        const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                        const notifInitiator = await new Notification({
                            recipient: initiatorId,
                            sender: req.user.userId,
                            title: "Friend Joined!",
                            message: `${guestName} has successfully booked and joined your group for "${booking.postTitle}"!`,
                            type: 'invite_accepted',
                            link: `/post/${booking.post?._id || booking.post}?scheduleId=${freshSchedule._id}`,
                            metadata: { scheduleId: freshSchedule._id }
                        }).save();
                        if (io) {
                            io.to(initiatorId.toString()).emit("new_notification", notifInitiator);
                        }
                    }

                // Notify Host about the new booking update
                const hostId = booking.post?.user || booking.host;
                const guestUser = await User.findById(req.user.userId);
                const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                const notifHost = await new Notification({
                    recipient: hostId,
                    sender: req.user.userId,
                    title: "Booking Update",
                    message: `${guestName} has joined a group booking for "${booking.postTitle}"`,
                    type: 'booking_accepted',
                    link: `/bookings/${booking._id}`,
                    metadata: { postId: booking.post?._id || booking.post, bookingId: booking._id }
                }).save();
                if (io) {
                    io.to(hostId.toString()).emit("new_notification", notifHost);
                }

                res.status(200).json({ 
                    success: true, 
                    message: "Payment verified and booking confirmed", 
                    data: booking,
                    schedule: freshSchedule,
                    scheduleId: booking.scheduleId 
                });
                return;
            } else {
                // SOLO BOOKING: Create a confirmed schedule
                const newSchedule = new Schedule({
                    initiator: req.user.userId,
                    post: booking.post?._id || booking.post,
                    postType: booking.postType || 'experience',
                    postTitle: booking.postTitle,
                    bookingDate: booking.startDate || new Date(),
                    numberOfPeople: booking.numberOfPeople,
                    status: 'confirmed',
                    isBooked: true,
                    initiatorPaid: true,
                    bookingId: booking._id
                });
                await newSchedule.save();
                booking.scheduleId = newSchedule._id;
                await booking.save();
                
                // Notify Host about the new solo booking
                const hostId = booking.post?.user || booking.host;
                const guestUser = await User.findById(req.user.userId);
                const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                const ioSolo = req.app.get("io");
                const notifSoloHost = await new Notification({
                    recipient: hostId,
                    sender: req.user.userId,
                    title: "Booking Confirmed",
                    message: `${guestName} has confirmed a booking for "${booking.postTitle}"`,
                    type: 'booking_accepted',
                    link: `/bookings/${booking._id}`,
                    metadata: { postId: booking.post?._id || booking.post, bookingId: booking._id }
                }).save();
                if (ioSolo) {
                    ioSolo.to(hostId.toString()).emit("new_notification", notifSoloHost);
                }

                res.status(200).json({ 
                    success: true, 
                    message: "Payment verified and booking confirmed", 
                    data: booking,
                    schedule: newSchedule,
                    scheduleId: booking.scheduleId 
                });
                return;
            }
        } catch (schedErr) {
            console.error("Failed to sync booking to schedule:", schedErr);
            // Fallback: Notify host even if schedule sync fails
            try {
                const hostId = booking.post?.user || booking.host;
                const ioFallback = req.app.get("io");
                const notifFallback = await new Notification({
                    recipient: hostId,
                    sender: req.user.userId,
                    title: "Booking Verified",
                    message: `A booking for "${booking.postTitle}" has been verified.`,
                    type: 'booking_accepted',
                    link: `/bookings/${booking._id}`
                }).save();
                if (ioFallback) {
                    ioFallback.to(hostId.toString()).emit("new_notification", notifFallback);
                }
            } catch (nErr) {}
            
            res.status(200).json({ success: true, message: "Payment verified", data: booking, scheduleId: booking.scheduleId });
        }

    } catch (error) {
        console.error("Verification error:", error);
        res.status(500).json({ success: false, message: "Verification failed", error: error.message });
    }
};
