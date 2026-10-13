const { HostHistory } = require("../../db/mongoose");

/**
 * Get all host profile updates and experience deletion history logs
 */
exports.getHostHistory = async (req, res) => {
    try {
        const history = await HostHistory.find().sort({ createdAt: -1 });
        
        return res.status(200).json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error("Error fetching host history:", error);
        return res.status(500).json({ success: false, message: "Error fetching host history" });
    }
};
