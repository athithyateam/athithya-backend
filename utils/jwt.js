const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required but not set.");
}
const jwtkey = process.env.JWT_SECRET;

module.exports = { jwt, jwtkey };
