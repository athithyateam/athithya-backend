const { User, Notification, HostHistory } = require("../../db/mongoose");
const { sendHtmlEmail } = require("../../utils/emailService");
const { deleteFromS3 } = require("../../utils/s3");

const saveHostOldDetails = async (user, changedFields = []) => {
    try {
        if (!user) return;
        const hostName = `${user.firstname || ''} ${user.lastname || ''}`.trim() || "Host";
        await HostHistory.create({
            type: "profile_update",
            hostId: user._id,
            hostName: hostName,
            changedFields: changedFields,
            avatarUrl: user.avatar?.url || "",
            physicalAddress: user.hostDetails?.physicalAddress || "",
            city: user.hostDetails?.city || "",
            district: user.hostDetails?.district || "",
            state: user.hostDetails?.state || "",
            pincode: user.hostDetails?.pincode || "",
            phone: user.hostDetails?.phone || "",
            email: user.email || "",
            aadhaarCard: user.hostDetails?.aadhaarCard || []
        });
        
        // Prune to only keep last 10 globally
        const items = await HostHistory.find({ type: "profile_update" }).sort({ createdAt: -1 });
        if (items.length > 10) {
            const idsToDelete = items.slice(10).map(item => item._id);
            await HostHistory.deleteMany({ _id: { $in: idsToDelete } });
        }
    } catch (err) {
        console.error("Error saving host old details to history:", err);
    }
};

function hasPendingHostChanges(user) {
    if (!user.pendingHostDetails) return false;
    const pend = typeof user.pendingHostDetails.toObject === 'function' ? user.pendingHostDetails.toObject() : user.pendingHostDetails;
    const current = user.hostDetails || {};
    
    if (pend.firstname && pend.firstname.trim() !== (user.firstname || '').trim()) return true;
    if (pend.lastname && pend.lastname.trim() !== (user.lastname || '').trim()) return true;
    if (pend.description !== undefined && pend.description.trim() !== (user.description || '').trim()) return true;
    
    const pendAvatarUrl = pend.avatar ? (typeof pend.avatar === 'string' ? pend.avatar : pend.avatar.url || '') : '';
    const origAvatarUrl = user.avatar ? (typeof user.avatar === 'string' ? user.avatar : user.avatar.url || '') : '';
    if (pend.avatar !== undefined && pendAvatarUrl !== '' && pendAvatarUrl !== origAvatarUrl) return true;
    
    if (pend.yearsOfExperience !== undefined && Number(pend.yearsOfExperience) !== Number(current.yearsOfExperience || 0)) return true;
    if (pend.phone !== undefined && pend.phone.trim() !== '' && pend.phone.trim() !== (current.phone || '').trim()) return true;
    if (pend.physicalAddress !== undefined && pend.physicalAddress.trim() !== '' && pend.physicalAddress.trim() !== (current.physicalAddress || '').trim()) return true;
    if (pend.city !== undefined && pend.city.trim() !== '' && pend.city.trim() !== (current.city || '').trim()) return true;
    if (pend.district !== undefined && pend.district.trim() !== '' && pend.district.trim() !== (current.district || '').trim()) return true;
    if (pend.state !== undefined && pend.state.trim() !== '' && pend.state.trim() !== (current.state || '').trim()) return true;
    if (pend.pincode !== undefined && pend.pincode.trim() !== '' && pend.pincode.trim() !== (current.pincode || '').trim()) return true;

    const pendAadhaarUrls = (pend.aadhaarCard || []).map(a => typeof a === 'string' ? a : (a?.url || a?.fileUrl || '')).filter(Boolean);
    const origAadhaarUrls = (current.aadhaarCard || []).map(a => typeof a === 'string' ? a : (a?.url || a?.fileUrl || '')).filter(Boolean);
    if (pendAadhaarUrls.length > 0 && (
        pendAadhaarUrls.length !== origAadhaarUrls.length ||
        pendAadhaarUrls.some((url, idx) => url !== origAadhaarUrls[idx])
    )) {
        return true;
    }

    return false;
}

/**
 * Get all hosts awaiting verification approval
 */
exports.getPendingHostVerifications = async (req, res) => {
    try {
        const pendingHosts = await User.find({
            $or: [
                { hostStatus: 'pending_approval' },
                { 
                    hostStatus: 'approved',
                    pendingHostDetails: { $exists: true, $ne: null }
                }
            ]
        })
            .select("firstname lastname email avatar description role isVerified location hostDetails pendingHostDetails hostStatus createdAt")
            .sort({ createdAt: -1 });

        // Filter out any host where pendingHostDetails has no actual modified fields
        const filteredPending = pendingHosts.filter(user => {
            if (user.hostStatus === 'pending_approval') return true;
            if (user.hostStatus === 'approved') {
                return hasPendingHostChanges(user);
            }
            return false;
        });

        return res.status(200).json({
            success: true,
            data: filteredPending
        });
    } catch (error) {
        console.error("Error fetching pending hosts:", error);
        return res.status(500).json({ success: false, message: "Error fetching pending hosts" });
    }
};

/**
 * Approve or reject a host verification
 */
exports.updateHostVerificationStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, reason } = req.body; // status: approved or rejected

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status. Use 'approved' or 'rejected'." });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const pendObj = user.pendingHostDetails 
            ? (typeof user.pendingHostDetails.toObject === 'function' ? user.pendingHostDetails.toObject() : user.pendingHostDetails) 
            : null;
        const isProfileUpdate = user.hostStatus === 'approved' && pendObj && Object.keys(pendObj).length > 0;

        if (isProfileUpdate) {
            // Case A: Profile verification details update review
            const pending = user.pendingHostDetails;
            const current = user.hostDetails || {};
            
            const notificationTitle = status === 'approved' ? "Profile Update Approved" : "Profile Update Rejected";
            let notificationMessage = "";

            if (status === 'approved') {
                // Log host old details before overwriting, tracking which fields are modified
                const changedFields = [];
                if (pending.firstname && (pending.firstname !== user.firstname || pending.lastname !== user.lastname)) changedFields.push("name");
                if (pending.description !== undefined && pending.description !== user.description) changedFields.push("description");
                if (pending.avatar !== undefined && JSON.stringify(pending.avatar) !== JSON.stringify(user.avatar)) changedFields.push("avatar");
                if (pending.yearsOfExperience !== undefined && Number(pending.yearsOfExperience) !== Number(current.yearsOfExperience)) changedFields.push("yearsOfExperience");
                if (pending.phone !== undefined && pending.phone !== current.phone) changedFields.push("phone");
                if (pending.physicalAddress !== undefined && pending.physicalAddress !== current.physicalAddress) changedFields.push("physicalAddress");
                if (pending.pincode !== undefined && pending.pincode !== current.pincode) changedFields.push("pincode");
                if (pending.district !== undefined && pending.district !== current.district) changedFields.push("district");
                if (pending.state !== undefined && pending.state !== current.state) changedFields.push("state");
                if (pending.city !== undefined && pending.city !== current.city) changedFields.push("city");
                
                // Aadhaar check
                const currentAadhaar = current.aadhaarCard || [];
                const approvedAadhaar = pending.aadhaarCard || [];
                let isAadhaarChanging = currentAadhaar.length !== approvedAadhaar.length;
                if (!isAadhaarChanging) {
                    for (let i = 0; i < approvedAadhaar.length; i++) {
                        if (approvedAadhaar[i].url !== currentAadhaar[i]?.url) {
                            isAadhaarChanging = true;
                            break;
                        }
                    }
                }
                if (isAadhaarChanging) changedFields.push("aadhaarCard");

                await saveHostOldDetails(user, changedFields);

                // Copy ONLY changed details to active user profile
                if (changedFields.includes("name")) {
                    if (pending.firstname) user.firstname = pending.firstname;
                    if (pending.lastname) user.lastname = pending.lastname;
                }
                if (changedFields.includes("description") && pending.description !== undefined) {
                    user.description = pending.description;
                }
                if (changedFields.includes("avatar") && pending.avatar !== undefined) {
                    user.avatar = pending.avatar;
                }

                // Copy proposed details to current details
                if (!user.hostDetails) user.hostDetails = {};
                
                if (changedFields.includes("yearsOfExperience") && pending.yearsOfExperience !== undefined) {
                    user.hostDetails.yearsOfExperience = Number(pending.yearsOfExperience);
                }
                if (changedFields.includes("phone") && pending.phone !== undefined) {
                    user.hostDetails.phone = pending.phone;
                }
                if (changedFields.includes("physicalAddress") && pending.physicalAddress !== undefined) {
                    user.hostDetails.physicalAddress = pending.physicalAddress;
                }
                if (changedFields.includes("pincode") && pending.pincode !== undefined) {
                    user.hostDetails.pincode = pending.pincode;
                }
                if (changedFields.includes("district") && pending.district !== undefined) {
                    user.hostDetails.district = pending.district;
                }
                if (changedFields.includes("state") && pending.state !== undefined) {
                    user.hostDetails.state = pending.state;
                }
                if (changedFields.includes("city") && pending.city !== undefined) {
                    user.hostDetails.city = pending.city;
                    if (!user.location) user.location = {};
                    user.location.city = pending.city;
                    user.location.state = pending.state || user.hostDetails.state || 'Uttarakhand';
                    user.location.country = 'India';
                    user.location.lastUpdated = new Date();
                } else if (changedFields.includes("state") && pending.state !== undefined) {
                    if (!user.location) user.location = {};
                    user.location.state = pending.state;
                    user.location.country = 'India';
                    user.location.lastUpdated = new Date();
                }

                if (changedFields.includes("aadhaarCard") && pending.aadhaarCard !== undefined) {
                    // Cleanup deleted files from S3: 
                    const approvedIds = approvedAadhaar.map(doc => doc.public_id).filter(id => id);
                    for (const doc of currentAadhaar) {
                        if (doc.public_id && !approvedIds.includes(doc.public_id)) {
                            try { await deleteFromS3(doc.public_id); } catch (err) {}
                        }
                    }
                    user.hostDetails.aadhaarCard = approvedAadhaar;
                }

                user.pendingHostDetails = undefined;
                user.isVerified = true;
                user.hostStatus = 'approved';
                user.role = 'host';

                notificationMessage = "Your profile update review has successfully completed and your details have been updated.";
            } else {
                // Rejected: Discard proposed details.
                // Cleanup newly uploaded files from S3 that were rejected:
                const currentAadhaar = current.aadhaarCard || [];
                const pendingAadhaar = pending.aadhaarCard || [];
                const currentIds = currentAadhaar.map(doc => doc.public_id).filter(id => id);
                for (const doc of pendingAadhaar) {
                    if (doc.public_id && !currentIds.includes(doc.public_id)) {
                        try { await deleteFromS3(doc.public_id); } catch (err) {}
                    }
                }
                user.pendingHostDetails = undefined;

                notificationMessage = `Your profile update review has been rejected. ${reason || "The original details remain unchanged."}`;
            }

            await user.save();
            await User.updateOne({ _id: userId }, { $unset: { pendingHostDetails: 1 } });

            // Send notification
            try {
                await Notification.create({
                    recipient: userId,
                    sender: req.user?.userId || req.user?.id,
                    title: notificationTitle,
                    message: notificationMessage,
                    type: status === 'approved' ? 'success' : 'error',
                    link: `/profile/${userId}`
                });
            } catch (notifErr) {
                console.error("Failed to create notification:", notifErr);
            }

            // Real-time notification via Socket.io
            const io = req.app.get("io");
            if (io) {
                io.to(userId.toString()).emit("host_status_update", {
                    status: user.hostStatus,
                    message: notificationMessage
                });
            }

            // Send email to Host
            if (user.email) {
                const hostFirstName = user.firstname || "Host";
                const emailSubject = status === 'approved' ? "Profile Update Approved! - Athithya" : "Profile Verification Update - Athithya";
                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                        <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                        </div>
                        <div style="padding: 20px;">
                            <h2 style="color: ${status === 'approved' ? '#2e7d32' : '#c62828'}; margin-top: 0;">${notificationTitle}</h2>
                            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                                Hi ${hostFirstName},
                            </p>
                            <p style="color: #555; font-size: 16px; line-height: 1.6;">
                                ${notificationMessage}
                            </p>
                        </div>
                    </div>
                `;
                sendHtmlEmail(user.email, emailSubject, htmlContent).catch(err => console.error("Failed to send profile verification status email:", err));
            }

            return res.status(200).json({
                success: true,
                message: `Host profile updates ${status} successfully.`,
                data: { userId, status }
            });
        }

        // Case B: Initial host verification approval/rejection
        user.hostStatus = status;
        if (status === 'approved') {
            user.isVerified = true;
            user.role = 'host';
        }
        user.pendingHostDetails = undefined;
        await user.save();
        await User.updateOne({ _id: userId }, { $unset: { pendingHostDetails: 1 } });

        // Create notification
        const notificationTitle = status === 'approved' ? "Host Account Approved" : "Host Account Rejected";
        const notificationMessage = status === 'approved' 
            ? "Congratulations, your host account has been approved. You can now add experiences!" 
            : `Sorry, your host account verification was rejected. ${reason || "Please check your details and try again."}`;

        try {
            await Notification.create({
                recipient: userId,
                sender: req.user?.userId || req.user?.id,
                title: notificationTitle,
                message: notificationMessage,
                type: status === 'approved' ? 'success' : 'error',
                link: status === 'approved' ? '/post' : `/profile/${userId}`
            });
        } catch (notifErr) {
            console.error("Failed to create notification:", notifErr);
        }

        // Real-time notification via Socket.io
        const io = req.app.get("io");
        if (io) {
            io.to(userId.toString()).emit("host_status_update", {
                status,
                message: notificationMessage
            });
        }

        // Send email to Host
        if (user.email) {
            const hostFirstName = user.firstname || "Host";
            const emailSubject = status === 'approved' ? "Host Account Approved! - Athithya" : "Host Account Verification Update - Athithya";
            const htmlContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                    <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                    </div>
                    <div style="padding: 20px;">
                        <h2 style="color: ${status === 'approved' ? '#2e7d32' : '#c62828'}; margin-top: 0;">${notificationTitle}</h2>
                        <p style="color: #333; font-size: 16px; line-height: 1.6;">
                            Hi ${hostFirstName},
                        </p>
                        <p style="color: #555; font-size: 16px; line-height: 1.6;">
                            ${notificationMessage}
                        </p>
                        ${status === 'approved' ? `
                        <div style="margin-top: 30px; text-align: center;">
                            <a href="https://athithya.in" style="background-color: #C59A2F; color: #fff; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 14px;">Log In to Dashboard</a>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
            sendHtmlEmail(user.email, emailSubject, htmlContent).catch(err => console.error("Failed to send host verification status email:", err));
        }

        return res.status(200).json({
            success: true,
            message: `Host account ${status} successfully.`,
            data: { userId, status }
        });

    } catch (error) {
        console.error("Error updating host status:", error);
        return res.status(500).json({ success: false, message: "Error updating host status" });
    }
};
