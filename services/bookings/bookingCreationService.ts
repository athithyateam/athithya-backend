import mongoose from "mongoose";
import { BadRequestError, NotFoundError, ForbiddenError } from "../../errors";
const { Booking, Experience, User, GroupBooking, HostDetails } = require("../../db/mongoose");
import { createRazorpayOrder, verifyRazorpaySignature, fetchPaymentDetails } from "../../utils/razorpay";
import { sendHtmlEmail, renderBrandedEmail } from "../emailService";
import { notificationService } from "../notificationService";
import { getPlatformFeeRate } from "../experiences/experiencePayloadParser";
import { chatService } from "../chatService";

export interface CreateBookingInput {
    experienceId?: string;
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
    experience: any,
    numberOfPeople: number,
    effectivePeople: number,
    useWallet: boolean,
    userWalletBalance: number = 0
): PricingResult {
    const rawBase = Number(experience.price?.perPerson ? (experience.price.perPerson * numberOfPeople) : (experience.price?.amount || experience.price?.total || 0));
    const baseAmount = isNaN(rawBase) ? 0 : Math.max(0, rawBase);

    const unitPrice = Number(experience.price?.perPerson || experience.price?.amount || experience.price?.total || 0);
    const feeRate = getPlatformFeeRate(unitPrice);
    const rawFee = unitPrice * feeRate;
    const feePerPerson = rawFee < 1 ? Number(rawFee.toFixed(2)) : Math.round(rawFee);
    const platformFee = experience.price?.perPerson ? (feePerPerson * numberOfPeople) : feePerPerson;

    let discountAmount = 0;
    let discountPercentage = 0;
    if (experience.discounts?.length) {
        const sorted = [...experience.discounts].sort((a: any, b: any) => b.threshold - a.threshold);
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

    private bookingModel: any;
    private experienceModel: any;
    private userModel: any;
    private groupBookingModel: any;
    private hostDetailsModel: any;

    constructor(
        instanceKey: symbol,
        bookingModel: any = Booking,
        experienceModel: any = Experience,
        userModel: any = User,
        groupBookingModel: any = GroupBooking,
        hostDetailsModel: any = HostDetails
    ) {
        if (instanceKey !== BookingCreationService.instanceKey) {
            throw new Error("Please use BookingCreationService.getInstance()");
        }
        this.bookingModel = bookingModel;
        this.experienceModel = experienceModel;
        this.userModel = userModel;
        this.groupBookingModel = groupBookingModel;
        this.hostDetailsModel = hostDetailsModel;
    }

    public static getInstance(
        bookingModel?: any,
        experienceModel?: any,
        userModel?: any,
        groupBookingModel?: any,
        hostDetailsModel?: any
    ): BookingCreationService {
        if (!this.instance) {
            this.instance = new BookingCreationService(
                this.instanceKey,
                bookingModel || Booking,
                experienceModel || Experience,
                userModel || User,
                groupBookingModel || GroupBooking,
                hostDetailsModel || HostDetails
            );
        }
        return this.instance;
    }

    private async resolveGroupContext(userId: string, count: number, parentBookingId?: string, groupBookingId?: string) {
        let isInviteBooking = false;
        let effectivePeople = count;

        if (!parentBookingId && !groupBookingId) return { isInviteBooking, effectivePeople };

        let group: any = null;
        if (groupBookingId && mongoose.Types.ObjectId.isValid(groupBookingId)) group = await this.groupBookingModel.findById(groupBookingId);
        else if (parentBookingId && mongoose.Types.ObjectId.isValid(parentBookingId)) group = await this.bookingModel.findById(parentBookingId);
        if (!group) return { isInviteBooking, effectivePeople };

        const initiatorId = group.initiator || group.guest;
        const isInitiator = initiatorId && String(initiatorId) === String(userId);

        if (initiatorId && !isInitiator) {
            isInviteBooking = true;
            const myInvite = (group.invitedPeople || []).find((inv: any) => String(inv.user?._id || inv.user) === String(userId));
            if (myInvite?.status === "pending" && (Date.now() - new Date(myInvite.invitedAt).getTime()) > 3600000) {
                throw new ForbiddenError("Your invitation has expired. Please ask the initiator to re-invite you.");
            }
        }

        const hostCount = Number(group.numberOfPeople) || 1;
        if (isInitiator) {
            const unpaid = (group.invitedPeople || []).filter((p: any) => !p.hasPaid);
            if (unpaid.length > 0) {
                throw new BadRequestError(`Cannot complete booking. Waiting for ${unpaid.length} invited friend(s) to pay first.`);
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
        const { numberOfPeople, startDate, endDate, selectedTime, guestMessage, invitedUserIds, parentBookingId, groupBookingId, scheduleId } = data;
        const experienceId = data.experienceId;
        const targetGroupBookingId = groupBookingId || scheduleId;
        const peopleCount = Number(numberOfPeople);

        if (!experienceId || isNaN(peopleCount) || peopleCount < 1) {
            throw new BadRequestError("Experience ID and a valid number of people (minimum 1) are required");
        }
        if (peopleCount > 3) {
            throw new BadRequestError("Maximum 3 travelers allowed per booking");
        }

        const experience = await this.experienceModel.findById(experienceId).populate("user");
        if (!experience) { throw new NotFoundError("Experience not found"); }
        if (experience.status !== "active" && experience.status !== "pending") {
            throw new BadRequestError("This experience is not available for booking");
        }

        const hostId = experience.user?._id || experience.user;
        if (!hostId) { throw new BadRequestError("This experience has no valid host assigned"); }
        if (String(hostId) === String(userId)) { throw new BadRequestError("You cannot book your own experience"); }
        if (userRole === "host") { throw new BadRequestError("Hosts cannot engage with another host's experience. Only guests can."); }

        let validInvited: any[] = [];
        if (Array.isArray(invitedUserIds) && invitedUserIds.length > 0) {
            const users = await this.userModel.find({ _id: { $in: invitedUserIds }, role: { $ne: "host" } });
            validInvited = users.map((u: any) => u._id);
        }

        const { isInviteBooking, effectivePeople } = await this.resolveGroupContext(userId, peopleCount, parentBookingId, targetGroupBookingId);
        const user = await this.userModel.findById(userId);
        const useWallet = data.useWallet === true || data.useWallet === "true";
        const pricing = calculateBookingPricing(experience, peopleCount, effectivePeople, useWallet, user?.walletBalance || 0);

        let razorpayOrder: any = null;
        if (pricing.payableAmount > 0) {
            razorpayOrder = await createRazorpayOrder(pricing.payableAmount);
        }

        const dates = parseBookingDates(startDate, selectedTime, endDate, experience.duration);

        const booking = new this.bookingModel({
            guest: userId,
            host: hostId,
            experience: experienceId,
            experienceTitle: experience.title || "Athithya Experience",
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
            throw new BadRequestError("Missing payment verification details");
        }

        if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
            throw new BadRequestError("Payment verification failed");
        }

        const booking = await this.bookingModel.findById(bookingId).populate("experience").populate("guest").populate("host");
        if (!booking) { throw new NotFoundError("Booking not found"); }
        if (booking.orderId !== razorpay_order_id) { throw new BadRequestError("Payment signature order ID mismatch"); }
        if (booking.guest._id.toString() !== userId.toString()) { throw new ForbiddenError("Unauthorized payment verification"); }

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
                const guestUser = await this.userModel.findById(guestId);
                if (guestUser) {
                    guestUser.walletBalance = Math.max(0, (guestUser.walletBalance || 0) - booking.walletAmountUsed);
                    await guestUser.save();
                }
            } catch (wErr) { console.error("Wallet deduction error:", wErr); }
        }

        const expId = booking.experience;
        if (expId) {
            const expDocId = expId._id || expId;
            this.experienceModel.findByIdAndUpdate(expDocId, { $inc: { bookingCount: 1 } }).catch(() => {});
        }

        if (hostId) {
            try {
                const hostDoc = await this.hostDetailsModel.findOneAndUpdate(
                    { user: hostId },
                    { $inc: { "verifyBadge.successfulBookingsCount": 1 } },
                    { new: true, upsert: false }
                );
                if (hostDoc) {
                    const reqCount = hostDoc.verifyBadge?.requiredBookings !== undefined ? hostDoc.verifyBadge.requiredBookings : 1;
                    const successCount = hostDoc.verifyBadge?.successfulBookingsCount || 0;
                    if (successCount >= reqCount && !hostDoc.verifyBadge?.enabled) {
                        await this.hostDetailsModel.updateOne({ user: hostId }, { $set: { "verifyBadge.enabled": true } });
                    }
                }
            } catch (hErr) { console.error("Host badge update error:", hErr); }
        }

        try { chatService.sendHostBookingWelcome(booking).catch(() => {}); } catch (dmErr) {}

        try {
            const guestUser = await this.userModel.findById(guestId, "firstname lastname email");
            const hostUser = await this.userModel.findById(hostId, "firstname lastname email");
            const guestName = `${guestUser?.firstname || ""} ${guestUser?.lastname || ""}`.trim() || "Traveler";
            const hostName = `${hostUser?.firstname || ""} ${hostUser?.lastname || ""}`.trim() || "Host";
            const title = booking.experienceTitle || "Athithya Experience";

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
            this.bookingModel.findByIdAndUpdate(booking.parentBookingId, { $push: { joinedUsers: { user: guestId, booking: booking._id } } }).catch(() => {});
        }

        let groupBookingObj: any = null;
        try {
            const groupBookingTargetId = booking.groupBookingId;
            if (groupBookingTargetId) {
                const groupBooking = await this.groupBookingModel.findById(groupBookingTargetId);
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

                groupBookingObj = await this.groupBookingModel.findByIdAndUpdate(groupBookingTargetId, { $set: updateData }, options).populate("initiator", "firstname lastname avatar");

                const initiatorId = groupBookingObj?.initiator?._id || groupBookingObj?.initiator;
                if (initiatorId && String(initiatorId).trim() !== String(guestId).trim()) {
                    const guestUser = await this.userModel.findById(guestId, "firstname lastname");
                    const name = guestUser ? `${guestUser.firstname} ${guestUser.lastname}` : "A traveler";
                    await notificationService.sendNotification({
                        recipient: initiatorId,
                        sender: guestId,
                        title: "Friend Joined!",
                        message: `${name} has successfully booked and joined your group for "${booking.experienceTitle || "the experience"}"!`,
                        type: "invite_accepted",
                        link: `/experiences/${booking.experience?._id || booking.experience}?groupBookingId=${groupBookingObj._id}`,
                        metadata: { groupBookingId: groupBookingObj._id }
                    });
                }
                const expTargetId = booking.experience?._id || booking.experience;
                const expTitle = booking.experienceTitle;

                await notificationService.sendNotification({
                    recipient: hostId,
                    sender: guestId,
                    title: "Booking Update",
                    message: `A traveler has joined a group booking for "${expTitle}"`,
                    type: "booking_accepted",
                    link: `/bookings/${booking._id}`,
                    metadata: { experienceId: expTargetId, bookingId: booking._id }
                });
            } else {
                const expTargetId = booking.experience?._id || booking.experience;
                const expTitle = booking.experienceTitle;

                groupBookingObj = new this.groupBookingModel({
                    initiator: guestId,
                    experience: expTargetId,
                    experienceTitle: expTitle,
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
                    message: `A traveler has confirmed a booking for "${expTitle}"`,
                    type: "booking_accepted",
                    link: `/bookings/${booking._id}`,
                    metadata: { experienceId: expTargetId, bookingId: booking._id }
                });
            }
        } catch (groupErr) { console.error("Failed to sync group booking:", groupErr); }

        return { groupBooking: groupBookingObj };
    }
}

export const bookingCreationService = BookingCreationService.getInstance();
export default BookingCreationService;

// CommonJS compatibility
module.exports = bookingCreationService;
module.exports.default = BookingCreationService;
module.exports.BookingCreationService = BookingCreationService;
module.exports.bookingCreationService = bookingCreationService;
module.exports.calculateBookingPricing = calculateBookingPricing;
module.exports.parseBookingDates = parseBookingDates;
module.exports.dispatchNotification = dispatchNotification;
module.exports.renderBrandedEmail = renderBrandedEmail;
