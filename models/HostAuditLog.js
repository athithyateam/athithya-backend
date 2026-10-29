const mongoose = require("mongoose");

const hostAuditLogSchema = new mongoose.Schema({
    type: { 
        type: String, 
        enum: ["profile_update", "experience_delete"], 
        required: true,
        index: true
    },
    hostId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
        required: true,
        index: true 
    },
    hostName: { 
        type: String, 
        required: true 
    },
    changedFields: [{ type: String }],
    snapshot: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    createdAt: { 
        type: Date, 
        default: Date.now,
        index: true
    }
}, { 
    timestamps: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Backward-compatibility virtual getters for admin dashboard consumers
hostAuditLogSchema.virtual("avatarUrl").get(function() {
    return this.snapshot?.avatarUrl;
});
hostAuditLogSchema.virtual("physicalAddress").get(function() {
    return this.snapshot?.physicalAddress;
});
hostAuditLogSchema.virtual("city").get(function() {
    return this.snapshot?.city;
});
hostAuditLogSchema.virtual("district").get(function() {
    return this.snapshot?.district;
});
hostAuditLogSchema.virtual("state").get(function() {
    return this.snapshot?.state;
});
hostAuditLogSchema.virtual("pincode").get(function() {
    return this.snapshot?.pincode;
});
hostAuditLogSchema.virtual("phone").get(function() {
    return this.snapshot?.phone;
});
hostAuditLogSchema.virtual("email").get(function() {
    return this.snapshot?.email;
});
hostAuditLogSchema.virtual("aadhaarCard").get(function() {
    return this.snapshot?.aadhaarCard;
});
hostAuditLogSchema.virtual("experienceTitle").get(function() {
    return this.snapshot?.experienceTitle || this.snapshot?.title;
});
hostAuditLogSchema.virtual("experiencePrice").get(function() {
    return this.snapshot?.experiencePrice || this.snapshot?.price;
});
hostAuditLogSchema.virtual("experiencePhotos").get(function() {
    return this.snapshot?.experiencePhotos || this.snapshot?.photos;
});

const HostAuditLog = mongoose.model("hostAuditLog", hostAuditLogSchema);

module.exports = HostAuditLog;
