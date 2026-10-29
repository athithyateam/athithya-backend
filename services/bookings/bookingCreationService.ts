import mongoose from "mongoose";
import { Booking, Post, User, GroupBooking, HostDetails } from "../../db/mongoose";
import { createRazorpayOrder, verifyRazorpaySignature, fetchPaymentDetails } from "../../utils/razorpay";
import { sendHtmlEmail, renderBrandedEmail } from "../emailService";
import { notificationService } from "../notificationService";
import { getPlatformFeeRate } from "../posts/postPayloadParser";
import { chatService } from "../chatService";

export interface CreateBookingInput {
    postId: string;
    numberOfPeople: number;
    startDate?: string;
    endDate?: string;
    selectedTime?: string;
    guestMessage?: string;
    invitedUserIds?: string[];
    parentBookingId?: string;
    groupBookingId?: string;
    scheduleId?: string;
    useWallet?: boolean | string;
}

export interface VerifyPaymentInput {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    bookingId: string;
}

export interface PricingResult {
    baseAmount: number;
    platformFee: number;
    discountPercentage: number;
    discountAmount: number;
    totalAmount: number;
    walletAmountUsed: number;
    payableAmount: number;
}

/**
 * Dispatches notification via centralized NotificationService.
 * Backwards-compatible signature supports either dispatchNotification(payload) or legacy dispatchNotification(io, payload).
 */
export async function dispatchNotification(
    recipientOrIo: any,
    payload?: any
): Promise<any> {
    const options = payload || recipientOrIo;
    return notificationService.sendNotification(options);
}

export { renderBrandedEmail } from "../emailService";

export function calculateBookingPricing(
    post: any,
    numberOfPeople: number,
    effectivePeople: number,
    useWallet: boolean,
    userWalletBalance: number = 0
): PricingResult {
    const rawBase = Number(post.price?.perPerson ? (post.price.perPerson * numberOfPeople) : (post.price?.amount || post.price?.total || 0));
    const baseAmount = isNaN(rawBase) ? 0 : Math.max(0, rawBase);

    const unitPrice = Number(post.price?.perPerson || post.price?.amount || post.price?.total || 0);
    const feeRate = getPlatformFeeRate(unitPrice);
    const rawFee = unitPrice * feeRate;
    const feePerPerson = rawFee < 1 ? Number(rawFee.toFixed(2)) : Math.round(rawFee);
    const platformFee = post.price?.perPerson ? (feePerPerson * numberOfPeople) : feePerPerson;

    let discountAmount = 0;
    let discountPercentage = 0;
    if (post.discounts?.length) {
        const sorted = [...post.discounts].sort((a: any, b: any) => b.threshold - a.threshold);
        const applicable = sorted.find((d: any) => effectivePeople >= d.threshold);
        if (applicable) {
            discountPercentage = applicable.percentage;
            discountAmount = Math.round((baseAmount * discountPercentage) / 100);
        }
    }

    let totalAmount = Math.max(0, (baseAmount - discountAmount) + platformFee);
    if (totalAmount > 0 && totalAmount < 1) totalAmount = 1;

    let walletAmountUsed = 0;
    if (useWallet && userWalletBalance > 0) {
        walletAmountUsed = Math.min(userWalletBalance, Math.max(0, totalAmount - platformFee));
    }
    const payableAmount = Math.max(platformFee, totalAmount - walletAmountUsed);

    return { baseAmount, platformFee, discountPercentage, discountAmount, totalAmount, walletAmountUsed, payableAmount };
}

export function parseBookingDates(startDateStr?: string, timeStr?: string, endDateStr?: string, duration?: any): { startDate: Date | null; endDate: Date | null } {
    const parseDate = (dStr?: string, tStr?: string): Date | null => {
        if (!dStr) return null;
        const clean = String(dStr).split("T")[0];
        let h = 0, m = 0;
        if (tStr?.trim()) {
            const match = tStr.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
            if (match) {
                h = parseInt(match[1], 10);
                m = parseInt(match[2], 10);
                if (match[3] === "PM" && h < 12) h += 12;
                if (match[3] === "AM" && h === 12) h = 0;
            }
        } else if (dStr.includes("T")) {
            const iso = new Date(dStr);
            if (!isNaN(iso.getTime())) return iso;
        }
        return new Date(`${clean}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
    };

    const startDate = parseDate(startDateStr, timeStr);
    let endDate: Date | null = null;
    if (endDateStr) {
        endDate = parseDate(endDateStr);
    } else if (startDate && !isNaN(startDate.getTime())) {
        endDate = new Date(startDate.getTime());
        if (duration?.minutes) endDate.setMinutes(endDate.getMinutes() + Number(duration.minutes));
        else if (duration?.hours) endDate.setHours(endDate.getHours() + Number(duration.hours));
        else if (duration?.days) endDate.setDate(endDate.getDate() + Number(duration.days));
    }
    return { startDate, endDate };
}

export class BookingCreationService {
    private static instance: BookingCreationService | null = null;
    private static instanceKey = Symbol("BookingCreationServiceKey");

    constructor(instanceKey: symbol) {
        if (instanceKey !== BookingCreationService.instanceKey) {
            throw new Error("Please use BookingCreationService.getInstance()");
        }
    }

    public static getInstance(): BookingCreationService {
        if (!this.instance) this.instance = new BookingCreationService(this.instanceKey);
        return this.instance;
    }

    private async resolveGroupContext(userId: string, count: number, parentBookingId?: string, groupBookingId?: string) {
        let isInviteBooking = false;
        let effectivePeople = count;

        if (!parentBookingId && !groupBookingId) return { isInviteBooking, effectivePeople };

        let group: any = null;
        if (groupBookingId && mongoose.Types.ObjectId.isValid(groupBookingId)) group = await GroupBooking.findById(groupBookingId);
        else if (parentBookingId && mongoose.Types.ObjectId.isValid(parentBookingId)) group = await Booking.findById(parentBookingId);
        if (!group) return { isInviteBooking, effectivePeople };

        const initiatorId = group.initiator || group.guest;
        const isInitiator = initiatorId && String(initiatorId) === String(userId);

        if (initiatorId && !isInitiator) {
            isInviteBooking = true;
            const myInvite = (group.invitedPeople || []).find((inv: any) => String(inv.user?._id || inv.user) === String(userId));
            if (myInvite?.status === "pending" && (Date.now() - new Date(myInvite.invitedAt).getTime()) > 3600000) {
                const err: any = new Error("Your invitation has expired. Please ask the initiator to re-invite you.");
                err.statusCode = 403;
                throw err;
            }
        }

        const hostCount = Number(group.numberOfPeople) || 1;
        if (isInitiator) {
            const unpaid = (group.invitedPeople || []).filter((p: any) => !p.hasPaid);
            if (unpaid.length > 0) {
                const err: any = new Error(`Cannot complete booking. Waiting for ${unpaid.length} invited friend(s) to pay first.`);
                err.statusCode = 400;
                throw err;
            }
            const paidCount = (group.invitedPeople || []).filter((p: any) => p?.hasPaid).length || (group.joinedUsers || []).length;
            effectivePeople = hostCount + paidCount;
        } else {
            const totalInvited = (group.invitedPeople || group.invitedUsers || []).length;
            effectivePeople = hostCount + totalInvited;
        }

        return { isInviteBooking, effectivePeople };
    }

    public async createBooking(data: CreateBookingInput, userId: string, userRole: string): Promise<any> {
        const { postId, numberOfPeople, startDate, endDate, selectedTime, guestMessage, invitedUserIds, parentBookingId, groupBookingId, scheduleId } = data;
        const targetGroupBookingId = groupBookingId || scheduleId;
        const peopleCount = Number(numberOfPeople);

        if (!postId || isNaN(peopleCount) || peopleCount < 1) {
            const err: any = new Error("Post ID and a valid number of people (minimum 1) are required");
            err.statusCode = 400;
            throw err;
        }
        if (peopleCount > 3) {
            const err: any = new Error("Maximum 3 travelers allowed per booking");
            err.statusCode = 400;
            throw err;
        }

        const post = await Post.findById(postId).populate("user");
        if (!post) { const err: any = new Error("Post not found"); err.statusCode = 404; throw err; }
        if (post.status !== "active" && post.status !== "pending") {
            const err: any = new Error("This trip is not available for booking");
            err.statusCode = 400;
            throw err;
        }

        const hostId = post.user?._id || post.user;
        if (!hostId) { const err: any = new Error("This experience has no valid host assigned"); err.statusCode = 400; throw err; }
        if (String(hostId) === String(userId)) { const err: any = new Error("You cannot book your own trip"); err.statusCode = 400; throw err; }
        if (userRole === "host") { const err: any = new Error("Hosts cannot engage with another host's experience. Only guests can."); err.statusCode = 400; throw err; }

        let validInvited: any[] = [];
        if (Array.isArray(invitedUserIds) && invitedUserIds.length > 0) {
            const users = await User.find({ _id: { $in: invitedUserIds }, role: { $ne: "host" } });
            validInvited = users.map(u => u._id);
        }

        const { isInviteBooking, effectivePeople } = await this.resolveGroupContext(userId, peopleCount, parentBookingId, targetGroupBookingId);
        const user = await User.findById(userId);
        const useWallet = data.useWallet === true || data.useWallet === "true";
        const pricing = calculateBookingPricing(post, peopleCount, effectivePeople, useWallet, user?.walletBalance || 0);

        let razorpayOrder: any = null;
        if (pricing.payableAmount > 0) {
            razorpayOrder = await createRazorpayOrder(pricing.payableAmount);
        }

        const validTypes = ["experience", "service", "plan", "trek"];
        const normalizedPostType = validTypes.includes(String(post.postType).toLowerCase()) ? String(post.postType).toLowerCase() : "experience";
        const dates = parseBookingDates(startDate, selectedTime, endDate, post.duration);

        const booking = new Booking({
            guest: userId,
            host: hostId,
            post: postId,
            postType: normalizedPostType,
            postTitle: post.title || "Athithya Experience",
            numberOfPeople: peopleCount,
            baseAmount: pricing.baseAmount,
            discountAmount: pricing.discountAmount,
            discountPercentage: pricing.discountPercentage,
            platformFee: pricing.platformFee,
            totalAmount: pricing.totalAmount,
            walletAmountUsed: pricing.walletAmountUsed,
            paidAmount: pricing.payableAmount,
            bookingDate: new Date(),
            startDate: dates.startDate,
            endDate: dates.endDate,
            guestMessage: guestMessage || "",
            status: pricing.payableAmount > 0 ? "pending" : "accepted",
            paymentStatus: pricing.payableAmount > 0 ? "pending" : "paid",
            orderId: razorpayOrder ? razorpayOrder.id : null,
            invitedUsers: validInvited,
            parentBookingId: (parentBookingId && mongoose.Types.ObjectId.isValid(parentBookingId)) ? parentBookingId : null,
            groupBookingId: (targetGroupBookingId && mongoose.Types.ObjectId.isValid(targetGroupBookingId)) ? targetGroupBookingId : null,
            isInviteBooking
        });

        await booking.save();
        if (pricing.payableAmount <= 0) await this.processBookingConfirmation(booking);

        return { bookingId: booking._id, orderId: booking.orderId, amount: pricing.payableAmount, currency: "INR" };
    }

    public async verifyPayment(data: VerifyPaymentInput, userId: string): Promise<any> {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = data;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !bookingId) {
            const err: any = new Error("Missing payment verification details");
            err.statusCode = 400;
            throw err;
        }

        if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
            const err: any = new Error("Payment verification failed");
            err.statusCode = 400;
            throw err;
        }

        const booking = await Booking.findById(bookingId).populate("post").populate("guest").populate("host");
        if (!booking) { const err: any = new Error("Booking not found"); err.statusCode = 404; throw err; }
        if (booking.orderId !== razorpay_order_id) { const err: any = new Error("Payment signature order ID mismatch"); err.statusCode = 400; throw err; }
        if (booking.guest._id.toString() !== userId.toString()) { const err: any = new Error("Unauthorized payment verification"); err.statusCode = 403; throw err; }

        booking.status = "accepted";
        booking.paymentStatus = "paid";
        booking.paymentId = razorpay_payment_id;

        try { booking.paymentDetails = await fetchPaymentDetails(razorpay_payment_id); } catch (e) {}
        await booking.save();

        const groupResult = await this.processBookingConfirmation(booking);
        return { booking, groupBooking: groupResult?.groupBooking || null, groupBookingId: booking.groupBookingId };
    }

    public async processBookingConfirmation(booking: any): Promise<{ groupBooking: any }> {
        const guestId = booking.guest?._id || booking.guest;
        const hostId = booking.host?._id || booking.host;

        if (booking.walletAmountUsed > 0) {
            try {
                const guestUser = await User.findById(guestId);
                if (guestUser) {
                    guestUser.walletBalance = Math.max(0, (guestUser.walletBalance || 0) - booking.walletAmountUsed);
                    await guestUser.save();
                }
            } catch (wErr) { console.error("Wallet deduction error:", wErr); }
        }

        if (booking.post) {
            const postId = booking.post._id || booking.post;
            Post.findByIdAndUpdate(postId, { $inc: { bookingCount: 1 } }).catch(() => {});
        }

        if (hostId) {
            try {
                const hostDoc = await HostDetails.findOneAndUpdate(
                    { user: hostId },
                    { $inc: { "verifyBadge.successfulBookingsCount": 1 } },
                    { new: true, upsert: false }
                );
                if (hostDoc) {
                    const reqCount = hostDoc.verifyBadge?.requiredBookings !== undefined ? hostDoc.verifyBadge.requiredBookings : 1;
                    const successCount = hostDoc.verifyBadge?.successfulBookingsCount || 0;
                    if (successCount >= reqCount && !hostDoc.verifyBadge?.enabled) {
                        await HostDetails.updateOne({ user: hostId }, { $set: { "verifyBadge.enabled": true } });
                    }
                }
            } catch (hErr) { console.error("Host badge update error:", hErr); }
        }

        try { chatService.sendHostBookingWelcome(booking).catch(() => {}); } catch (dmErr) {}

        try {
            const guestUser = await User.findById(guestId, "firstname lastname email");
            const hostUser = await User.findById(hostId, "firstname lastname email");
            const guestName = `${guestUser?.firstname || ""} ${guestUser?.lastname || ""}`.trim() || "Traveler";
            const hostName = `${hostUser?.firstname || ""} ${hostUser?.lastname || ""}`.trim() || "Host";
            const title = booking.postTitle || "Athithya Experience";

            const adminEmail = process.env.ADMIN_EMAIL || "teamsathithya@gmail.com";
            const adminHtml = renderBrandedEmail("New Experience Booked", `<p><strong>${guestName}</strong> booked <strong>${hostName}'s</strong> experience.</p><p><strong>Experience:</strong> ${title}<br/><strong>Total Paid:</strong> ₹${booking.totalAmount}</p>`, "Admin Alert");
            sendHtmlEmail(adminEmail, "New Experience Booked - Athithya", adminHtml).catch(() => {});

            if (guestUser?.email) {
                const guestHtml = renderBrandedEmail("Booking Confirmed!", `<p>Hi ${guestUser.firstname || "there"},</p><p>Your reservation for <strong>${title}</strong> is confirmed!</p><p><strong>Host:</strong> ${hostName}<br/><strong>Total Paid:</strong> ₹${booking.totalAmount}</p>`, "Booking Receipt");
                sendHtmlEmail(guestUser.email, "Your Booking Confirmation - Athithya", guestHtml).catch(() => {});
            }

            if (hostUser?.email) {
                const hostHtml = renderBrandedEmail("New Booking for Your Experience!", `<p>Hi ${hostUser.firstname || "Host"},</p><p>A traveler booked <strong>${title}</strong>.</p><p><strong>Guest:</strong> ${guestName}<br/><strong>Net Payout:</strong> ₹${booking.baseAmount - booking.discountAmount}</p>`, "Host Alert");
                sendHtmlEmail(hostUser.email, "New Booking for Your Experience! - Athithya", hostHtml).catch(() => {});
            }
        } catch (mailErr) { console.error("Booking email dispatch error:", mailErr); }

        if (booking.parentBookingId) {
            Booking.findByIdAndUpdate(booking.parentBookingId, { $push: { joinedUsers: { user: guestId, booking: booking._id } } }).catch(() => {});
        }

        let groupBookingObj: any = null;
        try {
            const groupBookingTargetId = booking.groupBookingId;
            if (groupBookingTargetId) {
                const groupBooking = await GroupBooking.findById(groupBookingTargetId);
                const isInitiator = String(groupBooking?.initiator || "").trim() === String(guestId).trim();
                const updateData: any = {};
                const options: any = { new: true };

                if (isInitiator) {
                    updateData.isBooked = true;
                    updateData.initiatorPaid = true;
                    updateData.status = "confirmed";
                } else {
                    updateData["invitedPeople.$[elem].status"] = "accepted";
                    updateData["invitedPeople.$[elem].hasPaid"] = true;
                    updateData["invitedPeople.$[elem].respondedAt"] = new Date();
                    options.arrayFilters = [{ "elem.user": new mongoose.Types.ObjectId(guestId) }];
                }
                if (!groupBooking?.bookingId || isInitiator) updateData.bookingId = booking._id;

                groupBookingObj = await GroupBooking.findByIdAndUpdate(groupBookingTargetId, { $set: updateData }, options).populate("initiator", "firstname lastname avatar");

                const initiatorId = groupBookingObj?.initiator?._id || groupBookingObj?.initiator;
                if (initiatorId && String(initiatorId).trim() !== String(guestId).trim()) {
                    const guestUser = await User.findById(guestId, "firstname lastname");
                    const name = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                    await notificationService.sendNotification({
                        recipient: initiatorId,
                        sender: guestId,
                        title: "Friend Joined!",
                        message: `${name} has successfully booked and joined your group for "${booking.postTitle}"!`,
                        type: "invite_accepted",
                        link: `/post/${booking.post?._id || booking.post}?groupBookingId=${groupBookingObj._id}`,
                        metadata: { groupBookingId: groupBookingObj._id }
                    });
                }

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: guestId,
                    title: "Booking Update",
                    message: `A traveler has joined a group booking for "${booking.postTitle}"`,
                    type: "booking_accepted",
                    link: `/bookings/${booking._id}`,
                    metadata: { postId: booking.post?._id || booking.post, bookingId: booking._id }
                });
            } else {
                groupBookingObj = new GroupBooking({
                    initiator: guestId,
                    post: booking.post?._id || booking.post,
                    postType: booking.postType || "experience",
                    postTitle: booking.postTitle,
                    bookingDate: booking.startDate || new Date(),
                    numberOfPeople: booking.numberOfPeople,
                    status: "confirmed",
                    isBooked: true,
                    initiatorPaid: true,
                    bookingId: booking._id
                });
                await groupBookingObj.save();
                booking.groupBookingId = groupBookingObj._id;
                await booking.save();

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: guestId,
                    title: "Booking Confirmed",
                    message: `A traveler has confirmed a booking for "${booking.postTitle}"`,
                    type: "booking_accepted",
                    link: `/bookings/${booking._id}`,
                    metadata: { postId: booking.post?._id || booking.post, bookingId: booking._id }
                });
            }
        } catch (groupErr) { console.error("Failed to sync group booking:", groupErr); }

        return { groupBooking: groupBookingObj };
    }
}

export const bookingCreationService = BookingCreationService.getInstance();
