import { FastifyReply } from 'fastify';

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code: string;
        details?: any;
    };
}

/**
 * Send a standardized success response
 */
export function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200) {
    const response: ApiResponse<T> = {
        success: true,
        data
    };
    return reply.code(statusCode).send(response);
}

/**
 * Send a standardized error response
 */
export function sendError(reply: FastifyReply, message: string, code: string, statusCode = 400, details?: any) {
    const response: ApiResponse = {
        success: false,
        error: {
            message,
            code,
            details
        }
    };
    return reply.code(statusCode).send(response);
}
