const mongoose = require("../db/mongoose");
const Booking = require("../models/Booking");
const CommunityPost = require("../models/CommunityPost");
const Conversation = require("../models/Conversation");
const GuestSchedule = require("../models/GuestSchedule");
const HostHistory = require("../models/HostHistory");
const HostPersonalMedia = require("../models/HostPersonalMedia");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const OTP = require("../models/OTP");
const Post = require("../models/Post");
const Review = require("../models/Review");
const Schedule = require("../models/Schedule");
const User = require("../models/User");

module.exports = {
  ...mongoose,
  models: {
    Booking,
    CommunityPost,
    Conversation,
    GuestSchedule,
    HostHistory,
    HostPersonalMedia,
    Message,
    Notification,
    OTP,
    Post,
    Review,
    Schedule,
    User,
  },
};
