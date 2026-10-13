const mongoose = require("mongoose");

const HostHistorySchema = new mongoose.Schema({
    type: { 
        type: String, 
        enum: ["profile_update", "experience_delete"], 
        required: true 
    },
    hostId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
    },
    hostName: { 
        type: String, 
        required: true 
    },
    changedFields: [{ type: String }],
    
    // For profile_update (stores old values before update)
    avatarUrl: { type: String },
    physicalAddress: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    pincode: { type: String },
    phone: { type: String },
    email: { type: String },
    aadhaarCard: [{
        url: { type: String },
        public_id: { type: String }
    }],

    // For experience_delete (stores a full snapshot of the deleted experience)
    experienceTitle: { type: String },
    experienceSubtitle: { type: String },
    experienceDescription: { type: String },
    experienceLongDescription: { type: String },
    experiencePrice: { type: mongoose.Schema.Types.Mixed },
    experienceDuration: { type: mongoose.Schema.Types.Mixed },
    experienceLocation: { type: mongoose.Schema.Types.Mixed },
    experienceCapacity: { type: mongoose.Schema.Types.Mixed },
    experienceAmenities: [{ type: String }],
    experienceRules: [{ type: String }],
    experiencePhotos: [{
        url: { type: String },
        public_id: { type: String }
    }],
    experienceCategories: [{ type: String }],
    
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model("HostHistory", HostHistorySchema);
