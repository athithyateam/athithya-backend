/**
 * Application & Domain Error Hierarchy
 * Provides typed, standardized domain errors with HTTP mapping capability
 * so service layers do not manually mutate error objects with status codes.
 */

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    [key: string]: any;

    constructor(message: string, statusCode: number = 500, extra?: Record<string, any>) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        if (extra) {
            Object.assign(this, extra);
        }
        Object.setPrototypeOf(this, new.target.prototype);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class BadRequestError extends AppError {
    constructor(message: string, extra?: Record<string, any>) {
        super(message, 400, extra);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = "Unauthorized", extra?: Record<string, any>) {
        super(message, 401, extra);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = "Forbidden", extra?: Record<string, any>) {
        super(message, 403, extra);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = "Resource not found", extra?: Record<string, any>) {
        super(message, 404, extra);
    }
}

export class ConflictError extends AppError {
    constructor(message: string = "Conflict", extra?: Record<string, any>) {
        super(message, 409, extra);
    }
}

export class NotImplementedError extends AppError {
    constructor(message: string = "Not implemented", extra?: Record<string, any>) {
        super(message, 501, extra);
    }
}

export class InternalServerError extends AppError {
    constructor(message: string = "Internal server error", extra?: Record<string, any>) {
        super(message, 500, extra);
    }
}
