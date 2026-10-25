const { chatService } = require("../services/chatService");
const { checkChatEligibility } = require("../services/chat/chatHelper");

/**
 * Automatically sends a welcome DM from the Host to the Guest upon successful booking.
 * Backward compatibility wrapper delegating to chatService.sendHostBookingWelcome.
 */
async function triggerHostBookingWelcome(reqOrApp, booking) {
    try {
        const bookingDoc = booking || reqOrApp;
        await chatService.sendHostBookingWelcome(bookingDoc);
    } catch (error) {
        console.error("Error in triggerHostBookingWelcome:", error);
    }
}

module.exports = {
    triggerHostBookingWelcome,
    checkChatEligibility
};
