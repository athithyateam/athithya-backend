const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
    guest: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    experience: { type: mongoose.Schema.Types.ObjectId, ref: 'experience', required: true },
    experienceTitle: { type: String },
    numberOfPeople: { type: Number, required: true, min: 1 },
    baseAmount: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    bookingDate: { type: Date, required: true },

    startDate: { type: Date },
    endDate: { type: Date },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined', 'cancelled', 'in_progress', 'completed', 'cancel_requested'],
        default: 'pending'
    },
    // OTP Journey verification fields
    startOTP: { type: String },
    startOTPExpiresAt: { type: Date },
    journeyStartedAt: { type: Date },
    
    completionOTP: { type: String },
    completionOTPExpiresAt: { type: Date },
    journeyCompletedAt: { type: Date },

    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refund_pending', 'refunded'],
        default: 'pending'
    },
    paymentId: { type: String }, // Razorpay Payment ID
    orderId: { type: String },   // Razorpay Order ID
    refundId: { type: String },  // Razorpay Refund ID
    paymentDetails: { type: Object }, // Raw Razorpay payment details for admin
    cancellationReason: { type: String, maxlength: 500 },
    guestMessage: { type: String, maxlength: 500 },
    hostResponse: { type: String, maxlength: 500 },
    respondedAt: { type: Date },
    invitedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    joinedUsers: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        booking: { type: mongoose.Schema.Types.ObjectId, ref: 'booking' }
    }],
    parentBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'booking' },
    groupBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'groupBooking' },
    isInviteBooking: { type: Boolean, default: false },
    walletAmountUsed: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 }
}, { timestamps: true });

bookingSchema.index({ guest: 1, createdAt: -1 });
bookingSchema.index({ host: 1, status: 1, createdAt: -1 });
bookingSchema.index({ experience: 1, status: 1 });
bookingSchema.index({ groupBookingId: 1 });

const Booking = mongoose.models.booking || mongoose.model("booking", bookingSchema);

module.exports = Booking;
