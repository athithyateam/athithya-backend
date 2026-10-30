const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
    email: { type: String },
    phone: { type: String },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 } // Auto-delete after 5 minutes
});

const OTP = mongoose.models.otp || mongoose.model("otp", otpSchema);

module.exports = OTP;
