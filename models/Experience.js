const mongoose = require("mongoose");

const experienceSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true
    },
    userRole: {
        type: String,
        enum: ['host', 'admin'],
        default: 'host',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    subtitle: {
        type: String,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        maxlength: 5000
    },
    longDescription: {
        type: String
    },
    photos: [{
        url: { type: String },
        public_id: { type: String },
        resource_type: { type: String, default: 'image' },
        googleDriveFileId: { type: String }
    }],
    videos: [{
        url: { type: String },
        public_id: { type: String },
        resource_type: { type: String, default: 'video' },
        googleDriveFileId: { type: String }
    }],
    location: {
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        country: { type: String, trim: true },
        address: { type: String, trim: true },
        meetingPoint: { type: String, trim: true },
        startPoint: { type: String, trim: true },
        endPoint: { type: String, trim: true },
        coordinates: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }  // [longitude, latitude]
        }
    },
    categories: [{
        type: String,
        enum: ['Adventure', 'Wildlife', 'Safari', 'Spiritual', 'Cultural', 'Beach', 'Mountain', 'Desert', 'Forest', 'Historical', 'Pilgrimage', 'Snow', 'Camping', 'Backpacking', 'Photography', 'Nature', 'Luxury', 'Budget', 'Trek', 'Rafting', 'Bungee jumping', 'Experience Guide', 'Paragliding', 'Flyboarding', 'Rock Climbing', 'Others', 'Other']
    }],
    season: {
        months: {
            type: [String],
            default: []
        }
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    price: {
        amount: { type: Number, min: 0 },
        total: { type: Number, min: 0 },
        perPerson: { type: Number, min: 0 },
        currency: { type: String, default: 'INR' },
        period: { type: String, enum: ['night', 'hour', 'day', 'person', 'total', 'minute', 'session', 'group', 'trip', 'event'], default: 'person' }
    },
    amenities: [{
        type: String
    }],
    capacity: {
        guests: { type: Number, min: 1 },
        maxPeople: { type: Number, min: 1 }
    },
    duration: {
        minutes: { type: Number, min: 0 },
        hours: { type: Number, min: 0 },
        days: { type: Number, min: 0 },
        nights: { type: Number, min: 0 }
    },
    difficulty: {
        type: String
    },
    tags: [{
        type: String
    }],
    rating: {
        average: { type: Number, min: 0, max: 5, default: 0 },
        count: { type: Number, default: 0 }
    },
    privacyPolicy: [{ type: String }],
    status: {
        type: String,
        enum: ['active', 'inactive', 'pending', 'archived'],
        default: 'pending'
    },
    clicks: {
        type: Number,
        default: 0
    },
    bookingCount: {
        type: Number,
        default: 0
    },
    savesCount: {
        type: Number,
        default: 0
    },
    discounts: [{
        threshold: { type: Number, min: 0 },
        percentage: { type: Number, min: 0, max: 100 }
    }],
    availability: {
        isAvailable: { type: Boolean, default: false },
        ranges: [{
            start: { type: Date },
            end: { type: Date },
            notes: { type: String }
        }]
    },
    pendingUpdate: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    deleteRequested: {
        type: Boolean,
        default: false
    },
    isHidden: {
        type: Boolean,
        default: false
    },
    hideRequested: {
        type: Boolean,
        default: false
    },
    unhideRequested: {
        type: Boolean,
        default: false
    },
    hideReason: {
        type: String,
        default: ""
    },
    approvedAt: {
        type: Date
    }
}, { timestamps: true });

experienceSchema.index({ user: 1, createdAt: -1 });
experienceSchema.index({ status: 1, createdAt: -1 });
experienceSchema.index({ 'location.city': 1, 'location.country': 1 });
experienceSchema.index({ categories: 1 });
experienceSchema.index({ isFeatured: 1, status: 1 });
experienceSchema.index({ 'location.coordinates': '2dsphere' });
experienceSchema.index({ clicks: -1, createdAt: -1 });
experienceSchema.index({ bookingCount: -1, createdAt: -1 });
experienceSchema.index({ savesCount: -1, createdAt: -1 });
experienceSchema.index({ 'rating.average': -1, 'rating.count': -1, createdAt: -1 });
experienceSchema.index({ approvedAt: -1 });

// Ensure MongoDB uses the 'posts' collection for seamless continuity
const Experience = mongoose.models.experience || mongoose.model("experience", experienceSchema, "posts");

module.exports = Experience;
