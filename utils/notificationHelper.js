const { notificationService } = require("../services/notificationService");

/**
 * Backwards compatibility shim delegating to NotificationService.
 */
async function sendPlatformNotification(ioOrOptions, maybeOptions) {
    const options = maybeOptions || ioOrOptions;
    return notificationService.sendNotification(options);
}

module.exports = { sendPlatformNotification };
