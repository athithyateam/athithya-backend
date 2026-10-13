const { setSecurityHeaders, sanitizeNoSQL } = require("../middleware/security");
const { checkRole } = require("../middleware/checkRole");
const { validateUser } = require("../middleware/validateUser");
const rateLimiter = require("../middleware/rateLimiter");

module.exports = {
  setSecurityHeaders,
  sanitizeNoSQL,
  checkRole,
  validateUser,
  rateLimiter,
};
