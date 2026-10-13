const Razorpay = require("razorpay");
const crypto = require("crypto");

const instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Creates a Razorpay Order
 * @param {number} amount - Amount in basic currency (e.g. INR)
 * @param {string} currency - Currency code (e.g. INR)
 * @returns {Promise} - Razorpay Order Object
 */
const createRazorpayOrder = async (amount, currency = "INR") => {
    try {
        const options = {
            amount: Math.round(amount * 100), // Razorpay expects amount in paise
            currency,
            receipt: `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        };
        const order = await instance.orders.create(options);
        return order;
    } catch (error) {
        console.error("Razorpay Order Creation Error:", error);
        throw error;
    }
};

/**
 * Verifies Razorpay Payment Signature
 * @param {string} orderId - Razorpay Order ID
 * @param {string} paymentId - Razorpay Payment ID
 * @param {string} signature - Razorpay Signature
 * @returns {boolean} - result of verification
 */
const verifyRazorpaySignature = (orderId, paymentId, signature) => {
    try {
        const text = orderId + "|" + paymentId;
        const generatedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(text)
            .digest("hex");
        return generatedSignature === signature;
    } catch (error) {
        console.error("Razorpay Signature Verification Error:", error);
        return false;
    }
};

/**
 * Fetches full payment details from Razorpay
 * @param {string} paymentId - Razorpay Payment ID
 * @returns {Promise} - Razorpay Payment Object
 */
const fetchPaymentDetails = async (paymentId) => {
    try {
        const payment = await instance.payments.fetch(paymentId);
        return payment;
    } catch (error) {
        console.error("Razorpay Fetch Payment Error:", error);
        throw error;
    }
};

module.exports = {
    instance,
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchPaymentDetails,
};
