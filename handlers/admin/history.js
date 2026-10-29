const { HostAuditLog } = require("../../db/mongoose");

/**
 * Get all host profile updates and experience deletion audit logs
 */
exports.getHostHistory = async (req, res) => {
    try {
        const history = await HostAuditLog.find().sort({ createdAt: -1 });
        
        return res.status(200).json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error("Error fetching host audit history:", error);
        return res.status(500).json({ success: false, message: "Error fetching host history" });
    }
};
