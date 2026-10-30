const mongoose = require("../db/mongoose");
const Booking = require("../models/Booking");
const Conversation = require("../models/Conversation");
const FriendRequest = require("../models/FriendRequest");
const Friendship = require("../models/Friendship");
const GroupBooking = require("../models/GroupBooking");
const HostAuditLog = require("../models/HostAuditLog");
const HostDetails = require("../models/HostDetails");
const HostPersonalMedia = require("../models/HostPersonalMedia");
const HostPinnedExperienceMedia = require("../models/HostPinnedExperienceMedia");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const OTP = require("../models/OTP");
const Experience = require("../models/Experience");
const Review = require("../models/Review");
const SavedExperience = require("../models/SavedExperience");
const User = require("../models/User");
const WishlistSchedule = require("../models/WishlistSchedule");

module.exports = {
  ...mongoose,
  models: {
    Booking,
    Conversation,
    FriendRequest,
    Friendship,
    GroupBooking,
    HostAuditLog,
    HostDetails,
    HostPersonalMedia,
    HostPinnedExperienceMedia,
    Message,
    Notification,
    OTP,
    Experience,
    Review,
    SavedExperience,
    User,
    WishlistSchedule,
  },
};
