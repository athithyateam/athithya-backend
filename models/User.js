const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ['guest', 'host', 'admin'],
        default: 'guest',
        required: true
    },
    isVerified: { type: Boolean, default: false },
    avatar: {
        url: { type: String },
        public_id: { type: String },
        googleDriveFileId: { type: String }
    },
    description: { type: String, maxlength: 2000 },
    location: {
        latitude: { type: Number },
        longitude: { type: Number },
        address: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        country: { type: String, trim: true },
        lastUpdated: { type: Date }
    },
    interests: [{ type: String }],
    walletBalance: { type: Number, default: 0 }
}, { timestamps: true });

userSchema.index({ role: 1 });
userSchema.index({ role: 1, 'location.city': 1 });

const User = mongoose.model("user", userSchema);

module.exports = User;
