const brevo = require('@getbrevo/brevo');

// Create Brevo API client
let apiInstance = new brevo.TransactionalEmailsApi();
let apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
};

// Send HTML Email Generic Helper
const sendHtmlEmail = async (email, subject, htmlContent) => {
    try {
        let sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = htmlContent;
        sendSmtpEmail.sender = { "name": "Athithya", "email": "teamsathithya@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        return { success: true, data };
    } catch (error) {
        const errorMsg = error.response?.body?.message || error.message || 'Unknown Brevo error';
        console.error('Brevo email error:', errorMsg);
        if (error.response?.body) {
            console.error('Brevo error details:', JSON.stringify(error.response.body, null, 2));
        }
        return { success: false, error: errorMsg };
    }
};

// Send OTP Email
const sendOTPEmail = async (email, otp, subject = "Email Verification - OTP", title = "Email Verification") => {
    try {
        let sendSmtpEmail = new brevo.SendSmtpEmail();
        
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px;">
                <div style="background-color: #1a1a1a; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                    <h1 style="color: #C59A2F; margin: 0; font-size: 28px; letter-spacing: 2px;">ATHITHYA</h1>
                </div>
                <div style="padding: 20px;">
                    <h2 style="color: #333; margin-top: 0;">${title}</h2>
                    <p style="color: #555; font-size: 16px;">Your OTP code is:</p>
                    <h1 style="color: #C59A2F; font-size: 36px; letter-spacing: 5px; margin: 20px 0; font-family: monospace;">${otp}</h1>
                    <p style="color: #666; font-size: 14px;">This OTP will expire in 5 minutes.</p>
                    <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">If you didn't request this code, please ignore this email.</p>
                </div>
            </div>
        `;
        sendSmtpEmail.sender = { "name": "Athithya", "email": "teamsathithya@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        return { success: true, data };
    } catch (error) {
        const errorMsg = error.response?.body?.message || error.message || 'Unknown Brevo error';
        console.error('Brevo email error:', errorMsg);
        if (error.response?.body) {
            console.error('Brevo error details:', JSON.stringify(error.response.body, null, 2));
        }
        return { success: false, error: errorMsg };
    }
};

module.exports = { generateOTP, sendOTPEmail, sendHtmlEmail };
