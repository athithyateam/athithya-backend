const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
        type: String,
        enum: ['info', 'success', 'warning', 'error', 'friend_request', 'friend_accepted', 'booking_request', 'booking_accepted', 'booking_declined', 'booking_cancelled', 'invite_sent', 'invite_accepted', 'invite_rejected', 'orphaned_invite_friend_alert', 'orphaned_invite_host_request', 'orphaned_invite_accepted', 'orphaned_invite_declined'],
        default: 'info'
    },
    link: { type: String },
    read: { type: Boolean, default: false },
    status: { type: String, default: 'pending' },
    metadata: {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'post' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'booking' },
        scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'schedule' }
    }
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model("notification", notificationSchema);

module.exports = Notification;
