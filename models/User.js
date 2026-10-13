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
    hostStatus: {
        type: String,
        enum: ['pending_verification', 'pending_approval', 'approved', 'rejected'],
        default: 'pending_verification'
    },
    hostDetails: {
        yearsOfExperience: { type: Number, default: 0, min: 0, max: 30 },
        phone: { type: String },
        phoneVerified: { type: Boolean, default: false },
        tempVerifiedPhone: { type: String },
        physicalAddress: { type: String },
        pincode: { type: String },
        city: { type: String },
        district: { type: String },
        state: { type: String },
        aadhaarCard: [{
            url: { type: String },
            public_id: { type: String }
        }]
    },
    pendingHostDetails: {
        firstname: { type: String },
        lastname: { type: String },
        description: { type: String },
        avatar: {
            url: { type: String },
            public_id: { type: String }
        },
        yearsOfExperience: { type: Number, default: 0, min: 0, max: 30 },
        phone: { type: String },
        physicalAddress: { type: String },
        pincode: { type: String },
        city: { type: String },
        district: { type: String },
        state: { type: String },
        aadhaarCard: [{
            url: { type: String },
            public_id: { type: String }
        }]
    },
    isVerified: { type: Boolean, default: false },
    avatar: {
        url: { type: String },
        public_id: { type: String },
        googleDriveFileId: { type: String }
    },
    description: { type: String, maxlength: 2000 },
    otp: { type: String },
    otpExpires: { type: Date },
    location: {
        latitude: { type: Number },
        longitude: { type: Number },
        address: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        country: { type: String, trim: true },
        lastUpdated: { type: Date }
    },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'post' }],
    interests: [{ type: String }],
    walletBalance: { type: Number, default: 0 },
    verifyBadge: {
        enabled: { type: Boolean, default: false },
        requiredBookings: { type: Number, default: 1 },
        successfulBookingsCount: { type: Number, default: 0 }
    },
    pinnedExperienceMedia: [{ type: String }],
    activeGridTab: {
        type: String,
        enum: ["experience", "personal"],
        default: "experience"
    }
}, { timestamps: true });

userSchema.index({ role: 1 });
userSchema.index({ role: 1, 'location.city': 1 });

const User = mongoose.model("user", userSchema);

module.exports = User;
