const express = require("express");
const router = express.Router();
const { checkAuth, checkAdmin } = require("../middleware/checkRole");
const analyticsHandler = require("../handlers/analyticsHandler");

// All analytics routes require authentication and admin role
router.use(checkAuth, checkAdmin);

router.get("/traffic", analyticsHandler.getTrafficAnalytics);

module.exports = router;
