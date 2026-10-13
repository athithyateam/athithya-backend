const users = require("../routes/users");
const posts = require("../routes/posts");
const reviews = require("../routes/reviews");
const itineraries = require("../routes/itineraries");
const search = require("../routes/search");
const bookings = require("../routes/bookings");
const schedules = require("../routes/schedules");
const guestSchedules = require("../routes/guestSchedules");
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
  schedules,
  guestSchedules,
  chat,
  notifications,
  analytics,
  admin,
  adminHandler,
};
