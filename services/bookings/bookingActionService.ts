import { Booking, User } from "../../db/mongoose";
import { sendHtmlEmail, renderBrandedEmail } from "../emailService";
import { otpService } from "../otpService";
import { notificationService } from "../notificationService";

export interface PaginationQuery {
    status?: string;
    page?: number | string;
    limit?: number | string;
}

export class BookingActionService {
    private static instance: BookingActionService | null = null;
    private static instanceKey = Symbol("BookingActionServiceKey");

    constructor(instanceKey: symbol) {
        if (instanceKey !== BookingActionService.instanceKey) {
            throw new Error("Please use BookingActionService.getInstance()");
        }
    }

    public static getInstance(): BookingActionService {
        if (!this.instance) this.instance = new BookingActionService(this.instanceKey);
        return this.instance;
    }

    public async getHostRequests(hostId: string, options: PaginationQuery = {}): Promise<any> {
        const { status, page = 1, limit = 10 } = options;
        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 10;

        const query: any = {
            host: hostId,
            isInviteBooking: { $ne: true },
            $or: [{ parentBookingId: { $exists: false } }, { parentBookingId: null }]
        };
        if (status) query.status = status;

        const total = await Booking.countDocuments(query);
        const rawBookedData = await Booking.find(query)
            .populate("guest", "firstname lastname avatar")
            .populate("post", "title postType photos location duration price")
            .populate({ path: "joinedUsers.booking", select: "totalAmount status isInviteBooking" })
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum);

        const bookings = rawBookedData.map((b: any) => {
            const booking = b.toObject();
            let groupTotalRevenue = Number(booking.totalAmount) || 0;
            if (Array.isArray(booking.joinedUsers)) {
                booking.joinedUsers.forEach((joined: any) => {
                    if (joined.booking && typeof joined.booking === "object") {
                        if (["accepted", "pending", "completed"].includes(joined.booking.status)) {
                            groupTotalRevenue += Number(joined.booking.totalAmount || 0);
                        }
                    }
                });
            }
            return { ...booking, totalAmount: groupTotalRevenue };
        });

        const countQuery = (s: string) => ({
            host: hostId,
            status: s,
            isInviteBooking: { $ne: true },
            $or: [{ parentBookingId: { $exists: false } }, { parentBookingId: null }]
        });
        const [pendingCount, acceptedCount, declinedCount] = await Promise.all([
            Booking.countDocuments(countQuery("pending")),
            Booking.countDocuments(countQuery("accepted")),
            Booking.countDocuments(countQuery("declined"))
        ]);

        return {
            bookings,
            pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
            summary: {
                pending: pendingCount,
                accepted: acceptedCount,
                declined: declinedCount,
                total: pendingCount + acceptedCount + declinedCount
            }
        };
    }

    public async getGuestBookings(guestId: string, options: PaginationQuery = {}): Promise<any> {
        const { status, page = 1, limit = 10 } = options;
        const pageNum = parseInt(String(page), 10) || 1;
        const limitNum = parseInt(String(limit), 10) || 10;

        const query: any = { guest: guestId };
        if (status) query.status = status;

        const total = await Booking.countDocuments(query);
        const bookings = await Booking.find(query)
            .populate("host", "firstname lastname email avatar")
            .populate("post", "title postType photos location duration price")
            .populate("invitedUsers", "firstname lastname avatar")
            .populate({ path: "joinedUsers.user", select: "firstname lastname avatar" })
            .populate({ path: "joinedUsers.booking", select: "startDate endDate totalAmount" })
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum);

        return {
            bookings,
            pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) }
        };
    }

    public async getBookingDetails(bookingId: string, userId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId)
            .populate("guest", "firstname lastname email avatar")
            .populate("host", "firstname lastname email avatar")
            .populate("post", "title postType photos location price");

        if (!booking) {
            const err: any = new Error("Booking not found");
            err.statusCode = 404;
            throw err;
        }

        const guestIdStr = String(booking.guest?._id || booking.guest).trim();
        const hostIdStr = String(booking.host?._id || booking.host).trim();
        const requesterStr = String(userId).trim();

        if (guestIdStr !== requesterStr && hostIdStr !== requesterStr) {
            const err: any = new Error("You are not authorized to view this booking");
            err.statusCode = 403;
            throw err;
        }

        const result = booking.toObject();
        if (requesterStr === hostIdStr && result.guest) {
            delete result.guest.email;
        }
        return result;
    }

    public async acceptBooking(bookingId: string, hostId: string, hostResponse: string = ""): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email").populate("post", "title");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "pending") { const err: any = new Error(`Cannot accept ${booking.status} booking`); err.statusCode = 400; throw err; }

        booking.status = "accepted";
        booking.hostResponse = hostResponse || "";
        booking.respondedAt = new Date();
        await booking.save();

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Booking Accepted",
            message: `Your booking request for "${booking.postTitle}" has been accepted!`,
            type: "booking_accepted",
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        });

        if (booking.guest?.email) {
            const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
            const html = renderBrandedEmail("Booking Confirmed!", `
                <p>Hello ${booking.guest.firstname || "there"},</p>
                <p>Your host has accepted your booking request for <strong>${booking.postTitle || "your experience"}</strong>!</p>
                <div style="margin: 32px 0; text-align: center;">
                    <a href="${frontendUrl}/bookings/${booking._id}" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">View Booking Details</a>
                </div>
            `, "Booking Accepted");
            sendHtmlEmail(booking.guest.email, `Booking Accepted: ${booking.postTitle || "Experience"} - Athithya`, html).catch(() => {});
        }

        const result = booking.toObject();
        if (result.guest) delete result.guest.email;
        return result;
    }

    public async declineBooking(bookingId: string, hostId: string, hostResponse: string = ""): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email").populate("post", "title");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "pending") { const err: any = new Error(`Cannot decline ${booking.status} booking`); err.statusCode = 400; throw err; }

        booking.status = "declined";
        booking.hostResponse = hostResponse || "";
        booking.respondedAt = new Date();
        await booking.save();

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Booking Declined",
            message: `Your booking request for "${booking.postTitle}" has been declined`,
            type: "booking_declined",
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        });

        if (booking.guest?.email) {
            const frontendUrl = (process.env.FRONTEND_URL || "https://athithya.in").replace(/\/$/, "");
            const html = renderBrandedEmail("Booking Request Declined", `
                <p>Hello ${booking.guest.firstname || "there"},</p>
                <p>Your booking request for <strong>${booking.postTitle || "this experience"}</strong> could not be accommodated at this time.</p>
                <div style="margin: 32px 0; text-align: center;">
                    <a href="${frontendUrl}/explore" style="background-color: #C59A2F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">Explore Other Experiences</a>
                </div>
            `, "Booking Update");
            sendHtmlEmail(booking.guest.email, `Booking Update: ${booking.postTitle || "Experience"} - Athithya`, html).catch(() => {});
        }

        const result = booking.toObject();
        if (result.guest) delete result.guest.email;
        return result;
    }

    public async requestCancellation(bookingId: string, guestId: string, reason: string = "No reason provided"): Promise<any> {
        const booking: any = await Booking.findById(bookingId);
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.guest.toString() !== guestId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }

        booking.status = "cancel_requested";
        booking.cancellationReason = reason || "No reason provided";
        await booking.save();

        await notificationService.sendNotification({
            recipient: booking.host,
            sender: guestId,
            title: "Cancellation Requested",
            message: `Guest has requested to cancel their booking for "${booking.postTitle}"`,
            type: "booking_cancelled",
            link: "/profile"
        });

        return booking;
    }

    public async approveCancellation(bookingId: string, hostId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId);
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }

        booking.status = "cancelled";
        booking.paymentStatus = "refund_pending";
        await booking.save();

        await notificationService.sendNotification({
            recipient: booking.guest,
            sender: hostId,
            title: "Cancellation Approved",
            message: `Your cancellation request for "${booking.postTitle}" has been approved. Refund is processing.`,
            type: "booking_cancelled",
            link: "/profile"
        });

        return booking;
    }

    public async sendStartOTP(bookingId: string, hostId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "accepted") { const err: any = new Error("Booking must be accepted to start the journey"); err.statusCode = 400; throw err; }

        const { otp, expiresAt } = await otpService.sendBookingJourneyOTP({
            email: booking.guest?.email,
            postTitle: booking.postTitle,
            type: "check-in"
        });
        booking.startOTP = otp;
        booking.startOTPExpiresAt = expiresAt;
        await booking.save();

        return { success: true, message: "Check-in OTP sent successfully to guest's email" };
    }

    public async verifyStartOTP(bookingId: string, hostId: string, otp: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email").populate("host", "firstname lastname email");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host._id.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "accepted") { const err: any = new Error("Booking must be accepted to verify check-in"); err.statusCode = 400; throw err; }

        otpService.verifyTimedOTP(booking.startOTP, booking.startOTPExpiresAt, otp);

        booking.status = "in_progress";
        booking.journeyStartedAt = new Date();
        booking.startOTP = undefined;
        booking.startOTPExpiresAt = undefined;
        await booking.save();

        const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
        const adminHtml = renderBrandedEmail("Journey Started Successfully", `<p><strong>${booking.guest?.firstname} ${booking.guest?.lastname}</strong> has checked in for <strong>"${booking.postTitle}"</strong> with host <strong>${booking.host?.firstname}</strong>.</p>`, "Journey Alert");
        sendHtmlEmail(adminEmail, `Journey Started - Booking #${bookingId}`, adminHtml).catch(() => {});

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Check-in Confirmed",
            message: `Your check-in for "${booking.postTitle}" has been verified! Have a great trip!`,
            type: "booking_accepted",
            link: `/bookings/${booking._id}`
        });

        notificationService.emitToAll("journey_status_updated", { bookingId: booking._id, status: "in_progress" });
        return booking;
    }

    public async sendCompletionOTP(bookingId: string, hostId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "in_progress") { const err: any = new Error("Journey must be active (in progress) to complete it"); err.statusCode = 400; throw err; }

        const { otp, expiresAt } = await otpService.sendBookingJourneyOTP({
            email: booking.guest?.email,
            postTitle: booking.postTitle,
            type: "checkout"
        });
        booking.completionOTP = otp;
        booking.completionOTPExpiresAt = expiresAt;
        await booking.save();

        return { success: true, message: "Checkout OTP sent successfully to guest's email" };
    }

    public async verifyCompletionOTP(bookingId: string, hostId: string, otp: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email").populate("host", "firstname lastname email");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host._id.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }
        if (booking.status !== "in_progress") { const err: any = new Error("Journey must be active to verify checkout"); err.statusCode = 400; throw err; }

        otpService.verifyTimedOTP(booking.completionOTP, booking.completionOTPExpiresAt, otp);

        booking.status = "completed";
        booking.journeyCompletedAt = new Date();
        booking.completionOTP = undefined;
        booking.completionOTPExpiresAt = undefined;
        await booking.save();

        try {
            if (booking.guest && booking.host) {
                const gStr = (booking.guest._id || booking.guest).toString();
                const hStr = (booking.host._id || booking.host).toString();
                notificationService.emitToUser(gStr, "chat_eligibility_updated", { canChat: true, isGuest: true, hostId: hStr });
                notificationService.emitToUser(hStr, "chat_eligibility_updated", { canChat: true, isGuest: false });
            }
        } catch (sErr) {}

        const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
        const adminHtml = renderBrandedEmail("Journey Completed Successfully", `<p><strong>${booking.guest?.firstname}</strong> completed experience <strong>"${booking.postTitle}"</strong> with host <strong>${booking.host?.firstname}</strong>.</p>`, "Journey Alert");
        sendHtmlEmail(adminEmail, `Journey Completed - Booking #${bookingId}`, adminHtml).catch(() => {});

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Journey Completed! Share your experience",
            message: `Thank you for choosing Athithya! Please share your experience and review "${booking.postTitle}".`,
            type: "booking_accepted",
            link: `/post/${booking.post}?type=${booking.postType || "experience"}`
        });

        if (booking.guest?.email) {
            const reviewUrl = `${process.env.FRONTEND_URL || "https://athithya.in"}/post/${booking.post}?type=${booking.postType || "experience"}`;
            const guestHtml = renderBrandedEmail("Thank you for choosing Athithya!", `
                <p>Hi ${booking.guest?.firstname || "Traveler"},</p>
                <p>We hope you had an incredible journey experiencing <strong>"${booking.postTitle}"</strong>!</p>
                <div style="text-align: center; margin-top: 25px;"><a href="${reviewUrl}" style="background-color: #C59A2F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">Leave a Review</a></div>
            `, "Feedback Request");
            sendHtmlEmail(booking.guest.email, "Thank you for choosing Athithya - Share your experience", guestHtml).catch(() => {});
        }

        notificationService.emitToAll("journey_status_updated", { bookingId: booking._id, status: "completed" });
        return booking;
    }

    public async acceptOrphanedBooking(bookingId: string, hostId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest", "firstname lastname email").populate("post", "title");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }

        booking.status = "accepted";
        await booking.save();
        const experienceTitle = booking.postTitle || booking.post?.title || "experience";

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Booking Confirmed!",
            message: `Congratulations! Your booking for "${experienceTitle}" has been successfully confirmed!`,
            type: "orphaned_invite_accepted",
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        });

        if (booking.guest?.email) {
            const html = renderBrandedEmail("Congratulations!", `<p>Hi ${booking.guest.firstname || "Traveler"},</p><p>Your booking for <strong>"${experienceTitle}"</strong> has been confirmed by the host!</p>`, "Booking Confirmed");
            sendHtmlEmail(booking.guest.email, "Booking Confirmed - Athithya", html).catch(() => {});
        }

        const result = booking.toObject();
        if (result.guest) delete result.guest.email;
        return result;
    }

    public async rejectOrphanedBooking(bookingId: string, hostId: string): Promise<any> {
        const booking: any = await Booking.findById(bookingId).populate("guest").populate("post", "title");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.host.toString() !== hostId.toString()) { const err: any = new Error("Unauthorized"); err.statusCode = 403; throw err; }

        booking.status = "cancelled";
        booking.paymentStatus = "refunded";
        await booking.save();

        const refundAmount = Math.max(0, booking.totalAmount - booking.platformFee);
        const guestUser = await User.findById(booking.guest._id);
        if (guestUser) {
            guestUser.walletBalance = (guestUser.walletBalance || 0) + refundAmount;
            await guestUser.save();
        }

        const guestName = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "Traveler";
        const experienceTitle = booking.postTitle || booking.post?.title || "experience";

        await notificationService.sendNotification({
            recipient: booking.guest._id,
            sender: hostId,
            title: "Booking Declined",
            message: `Hi ${guestName}, Unfortunately, the host declined the booking you were invited to. We credited ₹${refundAmount.toLocaleString()} to your wallet.`,
            type: "orphaned_invite_declined",
            link: `/bookings/${booking._id}`,
            metadata: { postId: booking.post?._id, bookingId: booking._id }
        });

        if (booking.guest?.email) {
            const html = renderBrandedEmail("Booking Update", `<p>Hi ${guestName},</p><p>The host declined the booking for <strong>"${experienceTitle}"</strong>. We credited <strong>₹${refundAmount.toLocaleString()}</strong> to your wallet.</p>`, "Booking Declined");
            sendHtmlEmail(booking.guest.email, "Booking Update - Athithya", html).catch(() => {});
        }

        return { refundAmount };
    }
}

export const bookingActionService = BookingActionService.getInstance();
