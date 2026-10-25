const { notificationService } = require("../services/notificationService");

/**
 * Backwards compatibility shim delegating to NotificationService.
 */
async function notifyAdmins(reqOrApp, payload) {
    const opts = payload || reqOrApp;
    return notificationService.notifyAdmins(opts);
}

module.exports = { notifyAdmins };
