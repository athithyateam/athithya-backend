const mongoose = require("mongoose");

const scheduleSchema = new mongoose.Schema({
    initiator: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true }, // The user who started the invitation/plan
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'post', required: true },
    postType: { type: String, required: true },
    postTitle: { type: String, required: true },
    invitedPeople: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        hasPaid: { type: Boolean, default: false }, // CRITICAL: Only true if this specific invited friend has completed their payment
        invitedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date }
    }],
    bookingDate: { type: Date, required: true }, // The target date selected for the experience
    numberOfPeople: { type: Number, default: 1 }, // Initiator's selected group size baseline
    status: { type: String, enum: ['planning', 'confirmed', 'cancelled'], default: 'planning' },
    isBooked: { type: Boolean, default: false }, // Becomes true when the initiator pays
    initiatorPaid: { type: Boolean, default: false }, // NEW: Explicitly track initiator payment
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'booking' } // Link to the primary booking record
}, { timestamps: true });

scheduleSchema.index({ initiator: 1, createdAt: -1 });
scheduleSchema.index({ 'invitedPeople.user': 1 });
scheduleSchema.index({ status: 1, isBooked: 1, initiatorPaid: 1 });

const Schedule = mongoose.model("schedule", scheduleSchema);

module.exports = Schedule;
