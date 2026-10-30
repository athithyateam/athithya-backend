/**
 * Payment Service
 * Domain service providing payment gateway integration (Razorpay),
 * order generation, cryptographic signature verification, and payment detail retrieval.
 */

import crypto from "crypto";
const Razorpay = require("razorpay");
import { BadRequestError, InternalServerError } from "../errors";

export interface CreateOrderOptions {
    amount: number;
    currency?: string;
    receipt?: string;
}

export interface PaymentOrder {
    id: string;
    amount: number;
    currency: string;
    receipt?: string;
    status?: string;
    [key: string]: any;
}

export class PaymentService {
    private static instance: PaymentService | null = null;
    private static instanceKey = Symbol("PaymentServiceInstanceKey");

    private client: any;
    private keySecret: string;

    constructor(
        instanceKey: symbol,
        client?: any,
        keySecret?: string
    ) {
        if (instanceKey !== PaymentService.instanceKey) {
            throw new Error("Use PaymentService.getInstance() to obtain the singleton instance.");
        }

        const resolvedKeyId = process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder";
        const resolvedKeySecret = keySecret || process.env.RAZORPAY_KEY_SECRET || "rzp_secret_placeholder";

        this.keySecret = resolvedKeySecret;
        this.client = client || new Razorpay({
            key_id: resolvedKeyId,
            key_secret: resolvedKeySecret
        });
    }

    public static getInstance(client?: any, keySecret?: string): PaymentService {
        if (!this.instance) {
            this.instance = new PaymentService(this.instanceKey, client, keySecret);
        }
        return this.instance;
    }

    /**
     * Creates a Razorpay Order
     * @param amount - Amount in basic currency unit (e.g. INR)
     * @param currency - Currency code (defaults to INR)
     * @param receipt - Optional custom receipt ID
     */
    public async createOrder(amount: number, currency: string = "INR", receipt?: string): Promise<PaymentOrder> {
        if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
            throw new BadRequestError("Payment amount must be a positive number");
        }

        try {
            const options = {
                amount: Math.round(amount * 100), // Razorpay expects amount in paise
                currency,
                receipt: receipt || `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
            };
            const order = await this.client.orders.create(options);
            return order;
        } catch (error: any) {
            console.error("Razorpay Order Creation Error:", error);
            throw new InternalServerError(error.message || "Failed to create payment order");
        }
    }

    /**
     * Verifies Razorpay Payment Signature
     * @param orderId - Razorpay Order ID
     * @param paymentId - Razorpay Payment ID
     * @param signature - Razorpay Signature (HMAC SHA256 hex digest)
     */
    public verifySignature(orderId: string, paymentId: string, signature: string): boolean {
        if (!orderId || !paymentId || !signature) {
            return false;
        }

        try {
            const text = `${orderId}|${paymentId}`;
            const generatedSignature = crypto
                .createHmac("sha256", this.keySecret)
                .update(text)
                .digest("hex");

            const genBuf = Buffer.from(generatedSignature, "utf-8");
            const sigBuf = Buffer.from(signature, "utf-8");
            if (genBuf.length !== sigBuf.length) {
                return false;
            }

            return crypto.timingSafeEqual(genBuf, sigBuf);
        } catch (error) {
            console.error("Razorpay Signature Verification Error:", error);
            return false;
        }
    }

    /**
     * Fetches full payment details from Razorpay
     * @param paymentId - Razorpay Payment ID
     */
    public async fetchPaymentDetails(paymentId: string): Promise<any> {
        if (!paymentId) {
            throw new BadRequestError("Payment ID is required");
        }

        try {
            const payment = await this.client.payments.fetch(paymentId);
            return payment;
        } catch (error: any) {
            console.error("Razorpay Fetch Payment Error:", error);
            throw new InternalServerError(error.message || "Failed to fetch payment details");
        }
    }
}

export const paymentService = PaymentService.getInstance();
export default PaymentService;

// CommonJS compatibility
module.exports = paymentService;
module.exports.default = PaymentService;
module.exports.PaymentService = PaymentService;
module.exports.paymentService = paymentService;
