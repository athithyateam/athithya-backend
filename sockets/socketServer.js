/**
 * Socket.IO Realtime Server Setup & Presence Tracking
 * Encapsulates Socket.io connection lifecycle, private user rooms,
 * live typing indicators, presence broadcasts, and notificationService binding.
 */

const { Server } = require("socket.io");
const { notificationService } = require("../services/notificationService");

const onlineUsers = new Set();
let ioInstance = null;

/**
 * Initializes Socket.io with the given HTTP server and CORS configuration.
 * @param {import("http").Server} httpServer
 * @param {Object} corsOptions
 * @returns {Server}
 */
function initSocketServer(httpServer, corsOptions) {
    if (ioInstance) {
        return ioInstance;
    }

    const io = new Server(httpServer, {
        cors: corsOptions,
        pingTimeout: 30000,
        pingInterval: 25000
    });

    ioInstance = io;

    // Register with centralized NotificationService for real-time bell notifications
    notificationService.setIo(io);

    io.on("connection", (socket) => {
        let currentUserId = null;

        // User authenticates and joins their private room
        socket.on("join", (userId) => {
            if (!userId) return;
            currentUserId = String(userId);
            socket.join(currentUserId);
            onlineUsers.add(currentUserId);
            io.emit("online_users_list", Array.from(onlineUsers));
        });

        // Typing indicator between conversation participants
        socket.on("typing", (data) => {
            if (!data) return;
            const { recipientId, conversationId, isTyping, senderId } = data;
            if (recipientId) {
                io.to(String(recipientId)).emit("user_typing", {
                    senderId: senderId || currentUserId,
                    conversationId,
                    isTyping: Boolean(isTyping)
                });
            }
        });

        // Handle disconnect and update presence list
        socket.on("disconnect", () => {
            if (currentUserId) {
                onlineUsers.delete(currentUserId);
                io.emit("online_users_list", Array.from(onlineUsers));
            }
        });
    });

    return io;
}

/**
 * Returns the active Socket.IO server instance.
 * @returns {Server|null}
 */
function getIo() {
    return ioInstance;
}

/**
 * Returns an array of currently online user IDs.
 * @returns {string[]}
 */
function getOnlineUsers() {
    return Array.from(onlineUsers);
}

/**
 * Checks whether a specific user is currently connected.
 * @param {string} userId
 * @returns {boolean}
 */
function isUserOnline(userId) {
    return onlineUsers.has(String(userId));
}

module.exports = {
    initSocketServer,
    getIo,
    getOnlineUsers,
    isUserOnline
};
