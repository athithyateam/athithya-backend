const { User, OTP, Notification } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const brevo = require("@getbrevo/brevo");
const { generateOTP, sendTemplateEmail } = require("../emailService");

// Initialize Brevo transactional SMS API client
const smsApiInstance = new brevo.TransactionalSMSApi();
if (smsApiInstance.authentications['apiKey']) {
    smsApiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
}

/**
 * Helper: Normalize phone number with country code (+91 default for India)
 */
const normalizePhoneNumber = (phone) => {
    if (!phone) return "";
    let normalized = phone.trim().replace(/\s+/g, '');
    if (!normalized.startsWith('+')) {
        if (normalized.length === 10) {
            normalized = '+91' + normalized;
        }
    }
    return normalized;
};

/**
 * Service: Send phone verification OTP via Brevo SMS
 */
const sendPhoneOTP = async ({ phone, userId }) => {
    if (!phone) {
        const error = new Error("Phone number is required");
        error.statusCode = 400;
        throw error;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone.startsWith('+')) {
        const error = new Error("Please include your country code (e.g. +91)");
        error.statusCode = 400;
        throw error;
    }

    // Check if phone number is already registered and verified by another user
    const existingHostWithPhone = await User.findOne({
        "hostDetails.phone": normalizedPhone,
        "hostDetails.phoneVerified": true,
        _id: { $ne: userId }
    });

    if (existingHostWithPhone) {
        const error = new Error("This phone number has already been used, please try another number");
        error.statusCode = 400;
        throw error;
    }

    // Generate OTP using shared utility
    const otp = generateOTP();

    // Store OTP in database (using phone field)
    await OTP.findOneAndUpdate(
        { phone: normalizedPhone },
        { phone: normalizedPhone, otp },
        { upsert: true, new: true }
    );

    // Send OTP via Brevo Transactional SMS
    const sendTransacSms = new brevo.SendTransacSms();
    sendTransacSms.sender = "Athithya";
    sendTransacSms.recipient = normalizedPhone;
    sendTransacSms.content = `Your Athithya verification code is ${otp}. It will expire in 5 minutes.`;

    // Console log for local dev fallback
    console.log(`\n========================================`);
    console.log(`[SMS OTP] Phone: ${normalizedPhone}, OTP: ${otp}`);
    console.log(`========================================\n`);

    try {
        await smsApiInstance.sendTransacSms(sendTransacSms);
    } catch (smsError) {
        const errorMsg = smsError.response?.body?.message || smsError.message || 'Unknown Brevo SMS error';
        console.error('Brevo SMS sending error:', errorMsg);
        const error = new Error(`Failed to send OTP SMS. Details: ${errorMsg}`);
        error.statusCode = 500;
        throw error;
    }

    return { phone: normalizedPhone };
};

/**
 * Service: Verify phone OTP code
 */
const verifyPhoneOTP = async ({ phone, otp, userId }) => {
    if (!phone || !otp) {
        const error = new Error("Phone number and OTP code are required");
        error.statusCode = 400;
        throw error;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone.startsWith('+')) {
        const error = new Error("Invalid phone number format");
        error.statusCode = 400;
        throw error;
    }

    // Find OTP record
    const otpRecord = await OTP.findOne({ phone: normalizedPhone, otp });
    if (!otpRecord) {
        const error = new Error("Invalid or expired OTP");
        error.statusCode = 400;
        throw error;
    }

    // Check if phone number is already registered and verified by another user
    const existingHostWithPhone = await User.findOne({
        "hostDetails.phone": normalizedPhone,
        "hostDetails.phoneVerified": true,
        _id: { $ne: userId }
    });

    if (existingHostWithPhone) {
        const error = new Error("This phone number has already been used, please try another number");
        error.statusCode = 400;
        throw error;
    }

    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    if (!user.hostDetails) {
        user.hostDetails = {};
    }

    if (user.hostStatus === 'approved') {
        user.hostDetails.tempVerifiedPhone = normalizedPhone;
    } else {
        user.hostDetails.phone = normalizedPhone;
        user.hostDetails.phoneVerified = true;
    }
    await user.save();

    await OTP.deleteOne({ _id: otpRecord._id });
    return true;
};

/**
 * Service: Submit host verification application
 */
const submitHostVerification = async ({ userId, data, io = null }) => {
    const { phone, physicalAddress, pincode, city, district, state, yearsOfExperience, aadhaar } = data;

    if (!phone || !physicalAddress || !pincode || !city || !district || !state) {
        const error = new Error("Phone, current address, pincode, city, district, and state are required");
        error.statusCode = 400;
        throw error;
    }

    const normalizedPhone = normalizePhoneNumber(phone);

    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
    }

    // Enforce phone OTP verification
    if (!user.hostDetails || !user.hostDetails.phoneVerified || user.hostDetails.phone !== normalizedPhone) {
        const error = new Error("Please verify your phone number via OTP first");
        error.statusCode = 400;
        throw error;
    }

    let aadhaarCardData = [];
    if (aadhaar) {
        if (Array.isArray(aadhaar)) {
            aadhaarCardData = aadhaar;
        } else {
            aadhaarCardData = parseIfJson(aadhaar) || [];
        }
    }

    const parsedYears = yearsOfExperience !== undefined ? Math.min(30, Math.max(0, parseInt(yearsOfExperience) || 0)) : 0;

    user.hostDetails = {
        phone: normalizedPhone,
        phoneVerified: true,
        physicalAddress,
        pincode,
        city,
        district,
        state,
        yearsOfExperience: parsedYears,
        aadhaarCard: aadhaarCardData
    };

    if (!user.location) {
        user.location = {};
    }
    user.location.city = city;
    user.location.state = state;
    user.location.country = 'India';
    user.location.lastUpdated = new Date();

    user.role = 'host';
    user.hostStatus = 'pending_approval';
    user.pendingHostDetails = undefined;
    await user.save();
    await User.updateOne({ _id: userId }, { $unset: { pendingHostDetails: 1 } });

    // Notify Admin via email
    const adminEmail = "teamsathithya@gmail.com";
    const hostname = `${user.firstname} ${user.lastname}`;
    const adminSubject = `Host Verification Request - Athithya`;
    
    let docListHtml = "None";
    if (aadhaarCardData && aadhaarCardData.length > 0) {
        docListHtml = aadhaarCardData.map((doc, idx) => `
            <div style="margin-bottom: 10px;">
                <strong>Document ${idx + 1}:</strong> <a href="${doc.url}" target="_blank" style="color: #C59A2F; text-decoration: none; font-weight: bold;">View / Download</a>
            </div>
        `).join("");
    }

    sendTemplateEmail({
        to: adminEmail,
        subject: adminSubject,
        templateName: "admin-host-verification",
        data: {
            hostname,
            email: user.email,
            phone: normalizedPhone,
            yearsOfExperience: `${parsedYears} ${parsedYears === 1 ? 'Year' : 'Years'}`,
            address: physicalAddress,
            city,
            district,
            state,
            pincode,
            docListHtml
        }
    }).catch(err => console.error("Failed to send admin host verification email:", err));

    try {
        const admins = await User.find({ role: 'admin' });
        const notifications = admins.map(admin => ({
            recipient: admin._id,
            sender: user._id,
            title: "New Host Verification Request",
            message: `${user.firstname} ${user.lastname} has applied to become a host.`,
            type: 'info',
            link: `/admin`,
            metadata: { userId: user._id }
        }));
        const savedNotifications = await Notification.insertMany(notifications);

        if (io) {
            savedNotifications.forEach(notif => {
                io.to(notif.recipient.toString()).emit("new_notification", notif);
            });
            io.emit("admin_new_verification_request", {
                userId: user._id,
                name: `${user.firstname} ${user.lastname}`
            });
        }
    } catch (notifErr) {
        console.error("Failed to notify admins via DB notification:", notifErr);
    }

    return { hostStatus: user.hostStatus };
};

module.exports = {
    normalizePhoneNumber,
    sendPhoneOTP,
    verifyPhoneOTP,
    submitHostVerification
};
