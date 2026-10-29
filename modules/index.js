const users = require("../routes/users");
const posts = require("../routes/posts");
const reviews = require("../routes/reviews");
const itineraries = require("../routes/itineraries");
const search = require("../routes/search");
const bookings = require("../routes/bookings");
const groupBookings = require("../routes/groupBookings");
const wishlistSchedules = require("../routes/wishlistSchedules");
const chat = require("../routes/chat");
const notifications = require("../routes/notifications");
const analytics = require("../routes/analytics");
const admin = require("../routes/admin");
const adminHandler = require("../handlers/adminHandler");

module.exports = {
  users,
  posts,
  reviews,
  itineraries,
  search,
  bookings,
  groupBookings,
  wishlistSchedules,
  chat,
  notifications,
  analytics,
  admin,
  adminHandler,
};
