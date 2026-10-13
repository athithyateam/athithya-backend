const { User, OTP, Notification } = require("../../db/mongoose");
const { parseIfJson } = require("../../utils/postUtils");
const brevo = require("@getbrevo/brevo");
const { sendHtmlEmail } = require("../../utils/emailService");

// Initialize Brevo transactional SMS API client
const smsApiInstance = new brevo.TransactionalSMSApi();
if (smsApiInstance.authentications['apiKey']) {
    smsApiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
}

// Generate OTP helper
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
};

/**
 * Send phone OTP verification via Brevo SMS API
 */
exports.sendPhoneOTP = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        // Normalize phone number
        let normalizedPhone = phone.trim().replace(/\s+/g, '');
        if (!normalizedPhone.startsWith('+')) {
            if (normalizedPhone.length === 10) {
                normalizedPhone = '+91' + normalizedPhone;
            } else {
                return res.status(400).json({ success: false, message: "Please include your country code (e.g. +91)" });
            }
        }

        // Check if phone number is already registered and verified by another user
        const existingHostWithPhone = await User.findOne({
            "hostDetails.phone": normalizedPhone,
            "hostDetails.phoneVerified": true,
            _id: { $ne: req.user?.userId }
        });

        if (existingHostWithPhone) {
            return res.status(400).json({
                success: false,
                message: "This phone number has already been used, please try another number"
            });
        }

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

        // Always print to console for development/debugging bypass
        console.log(`\n========================================`);
        console.log(`[SMS OTP] Phone: ${normalizedPhone}, OTP: ${otp}`);
        console.log(`========================================\n`);

        try {
            await smsApiInstance.sendTransacSms(sendTransacSms);
        } catch (smsError) {
            const errorMsg = smsError.response?.body?.message || smsError.message || 'Unknown Brevo SMS error';
            console.error('Brevo SMS sending error:', errorMsg);
            if (smsError.response?.body) {
                console.error('Brevo SMS error details:', JSON.stringify(smsError.response.body, null, 2));
            }
            // Return error if we fail to send
            return res.status(500).json({ 
                success: false, 
                message: `Failed to send OTP SMS. Details: ${errorMsg}` 
            });
        }

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully to your phone number",
            phone: normalizedPhone
        });

    } catch (error) {
        console.error("Error in sendPhoneOTP:", error);
        return res.status(500).json({ success: false, message: "Error sending OTP code" });
    }
};

/**
 * Verify phone OTP code
 */
exports.verifyPhoneOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;
        const userId = req.user.userId;

        if (!phone || !otp) {
            return res.status(400).json({ success: false, message: "Phone number and OTP code are required" });
        }

        // Normalize phone number
        let normalizedPhone = phone.trim().replace(/\s+/g, '');
        if (!normalizedPhone.startsWith('+')) {
            if (normalizedPhone.length === 10) {
                normalizedPhone = '+91' + normalizedPhone;
            } else {
                return res.status(400).json({ success: false, message: "Invalid phone number format" });
            }
        }

        // Find OTP record
        const otpRecord = await OTP.findOne({ phone: normalizedPhone, otp });
        if (!otpRecord) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        // Check if phone number is already registered and verified by another user
        const existingHostWithPhone = await User.findOne({
            "hostDetails.phone": normalizedPhone,
            "hostDetails.phoneVerified": true,
            _id: { $ne: userId }
        });

        if (existingHostWithPhone) {
            return res.status(400).json({
                success: false,
                message: "This phone number has already been used, please try another number"
            });
        }

        // Find user and mark phone as verified
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Initialize hostDetails if not present
        if (!user.hostDetails) {
            user.hostDetails = {};
        }

        if (user.hostStatus === 'approved') {
            // For approved hosts, do not update phone directly.
            // Save it in tempVerifiedPhone. It will be copied to pendingHostDetails.phone
            // during the save profile step, to be reviewed and approved by the admin.
            user.hostDetails.tempVerifiedPhone = normalizedPhone;
        } else {
            // For new/pending hosts, they can update instantly.
            user.hostDetails.phone = normalizedPhone;
            user.hostDetails.phoneVerified = true;
        }
        await user.save();

        // Delete OTP record
        await OTP.deleteOne({ _id: otpRecord._id });

        return res.status(200).json({
            success: true,
            message: "Phone number verified successfully"
        });

    } catch (error) {
        console.error("Error in verifyPhoneOTP:", error);
        return res.status(500).json({ success: false, message: "Error verifying OTP code" });
    }
};

/**
 * Submit host verification details
 */
exports.submitHostVerification = async (req, res) => {
    try {
        const { phone, physicalAddress, pincode, city, district, state, yearsOfExperience } = req.body;
        const userId = req.user.userId;

        if (!phone || !physicalAddress || !pincode || !city || !district || !state) {
            return res.status(400).json({ success: false, message: "Phone, current address, pincode, city, district, and state are required" });
        }

        // Normalize phone number
        let normalizedPhone = phone.trim().replace(/\s+/g, '');
        if (!normalizedPhone.startsWith('+')) {
            if (normalizedPhone.length === 10) {
                normalizedPhone = '+91' + normalizedPhone;
            }
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Enforce phone OTP verification
        if (!user.hostDetails || !user.hostDetails.phoneVerified || user.hostDetails.phone !== normalizedPhone) {
            return res.status(400).json({ success: false, message: "Please verify your phone number via OTP first" });
        }

        // Aadhaar card data comes as a JSON array of S3 objects from the frontend
        let aadhaarCardData = [];
        if (req.body.aadhaar) {
            if (Array.isArray(req.body.aadhaar)) {
                aadhaarCardData = req.body.aadhaar;
            } else {
                aadhaarCardData = parseIfJson(req.body.aadhaar) || [];
            }
        }

        const parsedYears = yearsOfExperience !== undefined ? Math.min(30, Math.max(0, parseInt(yearsOfExperience) || 0)) : 0;

        // Update user
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

        // Sync to location
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

        const adminHtml = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA ADMIN</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Host Verification Application</h2>
                    <p style="color: #555; font-size: 16px; line-height: 1.6;">
                        <strong>${hostname}</strong> is waiting for an approval to be host in Athithya, please review his approval.
                    </p>
                    <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Applicant Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Name:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${hostname}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${user.email}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Phone:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${normalizedPhone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Years of Experience:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${parsedYears} ${parsedYears === 1 ? 'Year' : 'Years'}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Address:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${physicalAddress}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">City:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${city}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">District:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${district}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">State:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${state}</td>
                        </tr>
                        <tr style="background-color: #f9f9f9;">
                            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Pin Code:</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${pincode}</td>
                        </tr>
                    </table>

                    <h3 style="color: #C59A2F; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 25px;">Uploaded Documents</h3>
                    <div style="margin-top: 10px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee;">
                        ${docListHtml}
                    </div>
                </div>
            </div>
        `;
        sendHtmlEmail(adminEmail, adminSubject, adminHtml).catch(err => console.error("Failed to send admin host verification email:", err));

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

            // Notify admins
            const io = req.app.get("io");
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

        return res.status(200).json({
            success: true,
            message: "Verification details submitted successfully. Awaiting admin approval.",
            hostStatus: user.hostStatus
        });

    } catch (error) {
        console.error("Verification submission error:", error);
        return res.status(500).json({ success: false, message: "Error submitting verification details" });
    }
};
