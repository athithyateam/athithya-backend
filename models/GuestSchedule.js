const mongoose = require("mongoose");

const guestScheduleSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'post', required: true },
    postType: { type: String, default: 'experience' },
    scheduledDate: { type: String, required: true }, // Format: YYYY-MM-DD
    scheduledTime: { type: String, required: true }, // Format: HH:mm
    scheduledDateTime: { type: Date, required: true }, // Combined UTC Date object for index & comparison
    status: { type: String, enum: ['scheduled', 'notified'], default: 'scheduled' }
}, { timestamps: true });

guestScheduleSchema.index({ user: 1, post: 1 });
guestScheduleSchema.index({ user: 1, createdAt: -1 });
guestScheduleSchema.index({ status: 1, scheduledDateTime: 1 });

const GuestSchedule = mongoose.model("guestSchedule", guestScheduleSchema);

module.exports = GuestSchedule;
