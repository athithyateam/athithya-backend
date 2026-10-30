const mongoose = require("mongoose");

const groupBookingSchema = new mongoose.Schema({
    initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    experience: { type: mongoose.Schema.Types.ObjectId, ref: 'experience', required: true },
    experienceTitle: { type: String },
    invitedPeople: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        hasPaid: { type: Boolean, default: false },
        invitedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date }
    }],
    bookingDate: { type: Date, required: true },
    numberOfPeople: { type: Number, default: 1 },
    status: { type: String, enum: ['planning', 'confirmed', 'cancelled'], default: 'planning' },
    isBooked: { type: Boolean, default: false },
    initiatorPaid: { type: Boolean, default: false },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'booking' }
}, { timestamps: true });

groupBookingSchema.index({ initiator: 1, createdAt: -1 });
groupBookingSchema.index({ experience: 1 });
groupBookingSchema.index({ 'invitedPeople.user': 1 });
groupBookingSchema.index({ status: 1, isBooked: 1, initiatorPaid: 1 });

const GroupBooking = mongoose.models.groupBooking || mongoose.model("groupBooking", groupBookingSchema);

module.exports = GroupBooking;
