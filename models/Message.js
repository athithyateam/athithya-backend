const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'conversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'user' }, // Optional for groups
    messageType: { 
        type: String, 
        enum: ['text', 'location', 'system', 'request_payment'], 
        default: 'text' 
    },
    text: { type: String },
    locationData: {
        lat: Number,
        lng: Number,
        cityName: String,
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'post' } // If sharing a specific experience
    },
    read: { type: Boolean, default: false },
    attachments: [{
        url: String,
        public_id: String,
        resource_type: { type: String, default: 'image' }
    }]
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ recipient: 1, read: 1 });

const Message = mongoose.model("message", messageSchema);

module.exports = Message;
