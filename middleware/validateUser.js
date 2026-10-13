const { z } = require('zod');

// Schema for signup
const signupSchema = z.object({
    firstname: z.string().min(1, "First name is required"),
    lastname: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(['guest', 'host']).optional() // Only guest or host allowed during signup
});

// Schema for signin
const signinSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required")
});

// Schema for OTP completion
const otpCompleteSchema = z.object({
    firstname: z.string().min(1, "First name is required"),
    lastname: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(['guest', 'host']).optional(),
    otp: z.string().min(1, "OTP is required")
});

// Schema for update info
const updateinfoSchema = z.object({
    firstname: z.string().min(1).optional(),
    lastname: z.string().min(1).optional(),
    password: z.string().min(6).optional()
});

// Schema for Google signin / signup (strictly forbids 'admin' role elevation)
const googleSigninSchema = z.object({
    token: z.string().min(1, "Google token is required"),
    role: z.enum(['guest', 'host']).optional()
});

// Middleware function to validate
const validateUser = (schema) => {
    return (req, res, next) => {
        try {
            schema.parse(req.body);
            next();
        } catch (error) {
            const errorMessages = error.errors?.map(err => ({
                field: err.path.join('.'),
                message: err.message
            })) || [];
            return res.status(400).json({ 
                success: false, 
                message: "Validation failed", 
                errors: errorMessages 
            });
        }
    };
};

module.exports = { validateUser, signupSchema, signinSchema, updateinfoSchema, otpCompleteSchema, googleSigninSchema };
