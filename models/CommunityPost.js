const mongoose = require("mongoose");

const communityPostSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    title: {
        type: String,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        maxlength: 5000
    },
    media: [{
        url: { type: String, required: true },
        public_id: { type: String, required: true },
        resource_type: { 
            type: String, 
            enum: ['image', 'video'], 
            default: 'image' 
        }
    }],
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    }],
}, { timestamps: true });

communityPostSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("communityPost", communityPostSchema);
