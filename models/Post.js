const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    userRole: {
        type: String,
        enum: ['guest', 'host', 'admin'],
        required: true
    },
    postType: {
        type: String,
        enum: ['experience', 'service', 'plan', 'trek'],
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
        meetingPoint: { type: String, trim: true },  // Meeting point/landmark for services
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
        type: mongoose.Schema.Types.Mixed
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
        type: String  // WiFi, Pool, Parking, etc.
    }],
    capacity: {
        guests: { type: Number, min: 1 },
        maxPeople: { type: Number, min: 1 },
        bedrooms: { type: Number, min: 0 },
        beds: { type: Number, min: 0 },
        bathrooms: { type: Number, min: 0 }
    },
    plan: {
        name: { type: String, trim: true },
        latitude: { type: Number },
        longitude: { type: Number }
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
    reactions: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        name: { type: String },
        emoji: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
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
    season: {
        months: {
            type: [String],
            default: []
        }
    },
    approvedAt: {
        type: Date
    }
}, { timestamps: true });

postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ postType: 1, status: 1 });
postSchema.index({ 'location.city': 1, 'location.country': 1 });
postSchema.index({ categories: 1 });
postSchema.index({ isFeatured: 1, status: 1 });
postSchema.index({ 'location.coordinates': '2dsphere' });
postSchema.index({ clicks: -1, createdAt: -1 });
postSchema.index({ bookingCount: -1, createdAt: -1 });
postSchema.index({ savesCount: -1, createdAt: -1 });
postSchema.index({ 'rating.average': -1, 'rating.count': -1, createdAt: -1 });
postSchema.index({ approvedAt: -1 });

const Post = mongoose.model("post", postSchema);

module.exports = Post;
