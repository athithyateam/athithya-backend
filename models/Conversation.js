const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    isGroup: { type: Boolean, default: false },
    groupMetadata: {
        name: { type: String, trim: true },
        avatar: {
            url: String,
            public_id: String
        },
        description: { type: String, maxlength: 500 },
        admin: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }
    },
    lastMessage: {
        text: String,
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        createdAt: { type: Date, default: Date.now }
    },
    unreadCounts: {
        type: Map,
        of: Number,
        default: {}
    },
    itinerary: [{
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        cityName: String,
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'post' },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        createdAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model("conversation", conversationSchema);

module.exports = Conversation;
