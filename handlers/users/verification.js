const { parseIfJson } = require("../../services/experiences/experiencePayloadParser");
const { verificationService } = require("../../services/users/verificationService");

/**
 * Send phone OTP verification via Brevo SMS API
 */
exports.sendPhoneOTP = async (req, res) => {
    try {
        const { phone } = req.body;
        const result = await verificationService.sendPhoneOTP(
            phone,
            req.user?.userId
        );

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully to your phone number",
            phone: result.phone
        });
    } catch (error) {
        console.error("Error in sendPhoneOTP:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error sending OTP code"
        });
    }
};

/**
 * Verify phone OTP code
 */
exports.verifyPhoneOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;
        const userId = req.user.userId;

        await verificationService.verifyPhoneOTP(
            phone,
            otp,
            userId
        );

        return res.status(200).json({
            success: true,
            message: "Phone number verified successfully"
        });
    } catch (error) {
        console.error("Error in verifyPhoneOTP:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error verifying OTP code"
        });
    }
};

/**
 * Submit host verification details
 */
exports.submitHostVerification = async (req, res) => {
    try {
        const { phone, physicalAddress, pincode, city, district, state, yearsOfExperience } = req.body;
        const userId = req.user.userId;

        // Aadhaar card data comes as a JSON array of S3 objects from the frontend
        let aadhaarCardData = [];
        if (req.body.aadhaar) {
            if (Array.isArray(req.body.aadhaar)) {
                aadhaarCardData = req.body.aadhaar;
            } else {
                aadhaarCardData = parseIfJson(req.body.aadhaar) || [];
            }
        }

        const result = await verificationService.submitHostVerification(
            userId,
            {
                phone,
                physicalAddress,
                pincode,
                city,
                district,
                state,
                yearsOfExperience,
                aadhaarCardData
            }
        );

        return res.status(200).json({
            success: true,
            message: "Verification details submitted successfully. Awaiting admin approval.",
            hostStatus: result.hostStatus
        });
    } catch (error) {
        console.error("Verification submission error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Error submitting verification details"
        });
    }
};
