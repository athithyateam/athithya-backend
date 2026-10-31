/**
 * Background Task Scheduler & Lifecycle Coordinator
 * Manages periodic background jobs (wishlist reminders, expired group booking cleanup)
 * and supports graceful startup and teardown.
 */

const { startWishlistReminderWorker } = require("./wishlistReminderWorker");
const { checkExpiredGroupBookings } = require("./bookingCleanup");

let activeWorkers = {
    wishlistReminderId: null,
    bookingCleanupId: null,
    isRunning: false
};

/**
 * Starts all background workers for standalone server mode.
 * @param {import("express").Application} [app] - Express application instance
 */
function startBackgroundWorkers(app) {
    if (activeWorkers.isRunning) {
        return activeWorkers;
    }

    try {
        // 1. Wishlist reminder worker (runs every 30s)
        const wishlistId = startWishlistReminderWorker(app);
        activeWorkers.wishlistReminderId = wishlistId;

        // 2. Booking expiration cleanup scheduler (runs every 60s)
        const cleanupId = setInterval(() => {
            checkExpiredGroupBookings().catch(err => {
                console.error("[CLEANUP] Uncaught error in checkExpiredGroupBookings:", err);
            });
        }, 60 * 1000);
        activeWorkers.bookingCleanupId = cleanupId;

        activeWorkers.isRunning = true;
        console.log("🕒 [WORKERS] Periodic background workers started (Wishlist Reminders: 30s, Booking Expiration: 60s)");
    } catch (err) {
        console.error("❌ [WORKERS] Failed to initialize background workers:", err);
    }

    return activeWorkers;
}

/**
 * Stops all background workers cleanly.
 */
function stopBackgroundWorkers() {
    if (!activeWorkers.isRunning) {
        return;
    }

    if (activeWorkers.wishlistReminderId) {
        clearInterval(activeWorkers.wishlistReminderId);
        activeWorkers.wishlistReminderId = null;
    }

    if (activeWorkers.bookingCleanupId) {
        clearInterval(activeWorkers.bookingCleanupId);
        activeWorkers.bookingCleanupId = null;
    }

    activeWorkers.isRunning = false;
    console.log("🛑 [WORKERS] Background workers stopped cleanly.");
}

module.exports = {
    startBackgroundWorkers,
    stopBackgroundWorkers,
    getWorkerStatus: () => ({ ...activeWorkers })
};
