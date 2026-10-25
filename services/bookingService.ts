import {
    bookingCreationService,
    BookingCreationService,
    CreateBookingInput,
    VerifyPaymentInput,
    calculateBookingPricing,
    parseBookingDates,
    dispatchNotification,
    renderBrandedEmail
} from "./bookings/bookingCreationService";
import {
    bookingActionService,
    BookingActionService,
    PaginationQuery
} from "./bookings/bookingActionService";

export {
    CreateBookingInput,
    VerifyPaymentInput,
    PaginationQuery,
    calculateBookingPricing,
    parseBookingDates,
    dispatchNotification,
    renderBrandedEmail
};

export class BookingService {
    private static instance: BookingService | null = null;
    private static instanceKey = Symbol("BookingServiceKey");

    private creationService: BookingCreationService;
    private actionService: BookingActionService;

    constructor(
        instanceKey: symbol,
        creationService: BookingCreationService = bookingCreationService,
        actionService: BookingActionService = bookingActionService
    ) {
        if (instanceKey !== BookingService.instanceKey) {
            throw new Error("Please use BookingService.getInstance()");
        }
        this.creationService = creationService;
        this.actionService = actionService;

        // Bind all methods for seamless destructuring
        this.createBooking = this.createBooking.bind(this);
        this.verifyPayment = this.verifyPayment.bind(this);
        this.processBookingConfirmation = this.processBookingConfirmation.bind(this);
        this.getHostRequests = this.getHostRequests.bind(this);
        this.getGuestBookings = this.getGuestBookings.bind(this);
        this.getBookingDetails = this.getBookingDetails.bind(this);
        this.acceptBooking = this.acceptBooking.bind(this);
        this.declineBooking = this.declineBooking.bind(this);
        this.requestCancellation = this.requestCancellation.bind(this);
        this.approveCancellation = this.approveCancellation.bind(this);
        this.sendStartOTP = this.sendStartOTP.bind(this);
        this.verifyStartOTP = this.verifyStartOTP.bind(this);
        this.sendCompletionOTP = this.sendCompletionOTP.bind(this);
        this.verifyCompletionOTP = this.verifyCompletionOTP.bind(this);
        this.acceptOrphanedBooking = this.acceptOrphanedBooking.bind(this);
        this.rejectOrphanedBooking = this.rejectOrphanedBooking.bind(this);
    }

    public static getInstance(
        creationService?: BookingCreationService,
        actionService?: BookingActionService
    ): BookingService {
        if (!this.instance) {
            this.instance = new BookingService(this.instanceKey, creationService, actionService);
        }
        return this.instance;
    }

    // --- Booking Creation & Payment Lifecycle ---
    public async createBooking(data: CreateBookingInput, userId: string, userRole: string): Promise<any> {
        return this.creationService.createBooking(data, userId, userRole);
    }

    public async verifyPayment(data: VerifyPaymentInput, userId: string): Promise<any> {
        return this.creationService.verifyPayment(data, userId);
    }

    public async processBookingConfirmation(booking: any): Promise<any> {
        return this.creationService.processBookingConfirmation(booking);
    }

    // --- Booking Queries ---
    public async getHostRequests(hostId: string, options?: PaginationQuery): Promise<any> {
        return this.actionService.getHostRequests(hostId, options);
    }

    public async getGuestBookings(guestId: string, options?: PaginationQuery): Promise<any> {
        return this.actionService.getGuestBookings(guestId, options);
    }

    public async getBookingDetails(bookingId: string, userId: string): Promise<any> {
        return this.actionService.getBookingDetails(bookingId, userId);
    }

    // --- Host & Status Actions ---
    public async acceptBooking(bookingId: string, hostId: string, hostResponse?: string): Promise<any> {
        return this.actionService.acceptBooking(bookingId, hostId, hostResponse);
    }

    public async declineBooking(bookingId: string, hostId: string, hostResponse?: string): Promise<any> {
        return this.actionService.declineBooking(bookingId, hostId, hostResponse);
    }

    public async requestCancellation(bookingId: string, guestId: string, reason?: string): Promise<any> {
        return this.actionService.requestCancellation(bookingId, guestId, reason);
    }

    public async approveCancellation(bookingId: string, hostId: string): Promise<any> {
        return this.actionService.approveCancellation(bookingId, hostId);
    }

    // --- Journey OTP Operations ---
    public async sendStartOTP(bookingId: string, hostId: string): Promise<any> {
        return this.actionService.sendStartOTP(bookingId, hostId);
    }

    public async verifyStartOTP(bookingId: string, hostId: string, otp: string): Promise<any> {
        return this.actionService.verifyStartOTP(bookingId, hostId, otp);
    }

    public async sendCompletionOTP(bookingId: string, hostId: string): Promise<any> {
        return this.actionService.sendCompletionOTP(bookingId, hostId);
    }

    public async verifyCompletionOTP(bookingId: string, hostId: string, otp: string): Promise<any> {
        return this.actionService.verifyCompletionOTP(bookingId, hostId, otp);
    }

    // --- Orphaned Invite Bookings ---
    public async acceptOrphanedBooking(bookingId: string, hostId: string): Promise<any> {
        return this.actionService.acceptOrphanedBooking(bookingId, hostId);
    }

    public async rejectOrphanedBooking(bookingId: string, hostId: string): Promise<any> {
        return this.actionService.rejectOrphanedBooking(bookingId, hostId);
    }
}

export const bookingService = BookingService.getInstance();
export default BookingService;

// Convenience function exports
export const createBooking = bookingService.createBooking;
export const verifyPayment = bookingService.verifyPayment;
export const processBookingConfirmation = bookingService.processBookingConfirmation;
export const getHostRequests = bookingService.getHostRequests;
export const getGuestBookings = bookingService.getGuestBookings;
export const getBookingDetails = bookingService.getBookingDetails;
export const acceptBooking = bookingService.acceptBooking;
export const declineBooking = bookingService.declineBooking;
export const requestCancellation = bookingService.requestCancellation;
export const approveCancellation = bookingService.approveCancellation;
export const sendStartOTP = bookingService.sendStartOTP;
export const verifyStartOTP = bookingService.verifyStartOTP;
export const sendCompletionOTP = bookingService.sendCompletionOTP;
export const verifyCompletionOTP = bookingService.verifyCompletionOTP;
export const acceptOrphanedBooking = bookingService.acceptOrphanedBooking;
export const rejectOrphanedBooking = bookingService.rejectOrphanedBooking;

// CommonJS compatibility
module.exports = bookingService;
module.exports.default = BookingService;
module.exports.BookingService = BookingService;
module.exports.bookingService = bookingService;
module.exports.bookingCreationService = bookingCreationService;
module.exports.bookingActionService = bookingActionService;
module.exports.calculateBookingPricing = calculateBookingPricing;
module.exports.parseBookingDates = parseBookingDates;
module.exports.dispatchNotification = dispatchNotification;
module.exports.renderBrandedEmail = renderBrandedEmail;
