const mongoose = require("mongoose");

const hostDetailsSchema = new mongoose.Schema({
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
        required: true, 
        unique: true,
        index: true 
    },
    status: {
        type: String,
        enum: ['pending_verification', 'pending_approval', 'approved', 'rejected'],
        default: 'pending_verification',
        index: true
    },
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
    }],
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
    verifyBadge: {
        enabled: { type: Boolean, default: false },
        requiredBookings: { type: Number, default: 1 },
        successfulBookingsCount: { type: Number, default: 0 }
    }
}, { timestamps: true });

const HostDetails = mongoose.models.hostDetails || mongoose.model("hostDetails", hostDetailsSchema);

module.exports = HostDetails;
