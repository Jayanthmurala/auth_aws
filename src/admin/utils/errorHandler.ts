import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdminResponse } from '../types/adminTypes.js';

/**
 * Standardized Error Response Handler for Admin Operations
 * Ensures consistent error format across all admin endpoints
 */

export interface StandardError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  requestId?: string;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Standard error codes for admin operations
 */
export const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  ROLE_REQUIRED: 'ROLE_REQUIRED',
  
  // Validation Errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Business Logic Errors
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  COLLEGE_NOT_FOUND: 'COLLEGE_NOT_FOUND',
  DEPARTMENT_NOT_FOUND: 'DEPARTMENT_NOT_FOUND',
  
  // Security Errors
  PRIVILEGE_ESCALATION_DENIED: 'PRIVILEGE_ESCALATION_DENIED',
  MANAGEMENT_PERMISSION_DENIED: 'MANAGEMENT_PERMISSION_DENIED',
  CSRF_TOKEN_MISSING: 'CSRF_TOKEN_MISSING',
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Operation Errors
  BULK_OPERATION_FAILED: 'BULK_OPERATION_FAILED',
  BULK_OPERATION_LIMIT_EXCEEDED: 'BULK_OPERATION_LIMIT_EXCEEDED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CONFIRMATION_INVALID: 'CONFIRMATION_INVALID',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  
  // Data & Export Errors
  EXPORT_FAILED: 'EXPORT_FAILED',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  ENCRYPTION_KEY_INVALID: 'ENCRYPTION_KEY_INVALID',
  DATA_NOT_FOUND: 'DATA_NOT_FOUND',
  
  // System Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
} as const;

/**
 * Create standardized error response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: any,
  statusCode: number = 400
): { response: AdminResponse; statusCode: number } {
  const error: StandardError = {
    code,
    message,
    details,
    timestamp: new Date().toISOString()
  };

  const response: AdminResponse = {
    success: false,
    message,
    errors: [error.code]
  };

  return { response, statusCode };
}

/**
 * Handle validation errors from Zod
 */
export function handleValidationError(
  zodError: z.ZodError,
  customMessage?: string
): { response: AdminResponse; statusCode: number } {
  const validationErrors: ValidationError[] = zodError.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code
  }));

  return createErrorResponse(
    ERROR_CODES.VALIDATION_FAILED,
    customMessage || 'Request validation failed',
    { validationErrors },
    400
  );
}

/**
 * Handle authentication errors
 */
export function handleAuthError(
  type: 'missing' | 'invalid' | 'insufficient' | 'role_required',
  requiredRole?: string
): { response: AdminResponse; statusCode: number } {
  switch (type) {
    case 'missing':
      return createErrorResponse(
        ERROR_CODES.AUTH_REQUIRED,
        'Authentication required',
        undefined,
        401
      );
    case 'invalid':
      return createErrorResponse(
        ERROR_CODES.INVALID_TOKEN,
        'Invalid or expired authentication token',
        undefined,
        401
      );
    case 'insufficient':
      return createErrorResponse(
        ERROR_CODES.INSUFFICIENT_PRIVILEGES,
        'Insufficient privileges for this operation',
        undefined,
        403
      );
    case 'role_required':
      return createErrorResponse(
        ERROR_CODES.ROLE_REQUIRED,
        `${requiredRole || 'Admin'} role required for this operation`,
        { requiredRole },
        403
      );
    default:
      return createErrorResponse(
        ERROR_CODES.AUTH_REQUIRED,
        'Authentication error',
        undefined,
        401
      );
  }
}

/**
 * Handle privilege escalation errors
 */
export function handlePrivilegeError(
  reason: string,
  details?: any
): { response: AdminResponse; statusCode: number } {
  return createErrorResponse(
    ERROR_CODES.PRIVILEGE_ESCALATION_DENIED,
    reason,
    details,
    403
  );
}

/**
 * Handle CSRF errors
 */
export function handleCSRFError(
  type: 'missing' | 'invalid'
): { response: AdminResponse; statusCode: number } {
  const code = type === 'missing' ? ERROR_CODES.CSRF_TOKEN_MISSING : ERROR_CODES.CSRF_TOKEN_INVALID;
  const message = type === 'missing' ? 'CSRF token required' : 'Invalid CSRF token';
  
  return createErrorResponse(code, message, undefined, 403);
}

/**
 * Handle rate limiting errors
 */
export function handleRateLimitError(
  limit: number,
  window: string,
  retryAfter?: number
): { response: AdminResponse; statusCode: number } {
  return createErrorResponse(
    ERROR_CODES.RATE_LIMIT_EXCEEDED,
    'Rate limit exceeded. Please try again later.',
    {
      limit,
      window,
      retryAfter
    },
    429
  );
}

/**
 * Handle not found errors
 */
export function handleNotFoundError(
  resource: string,
  id?: string
): { response: AdminResponse; statusCode: number } {
  const code = resource === 'user' ? ERROR_CODES.USER_NOT_FOUND :
               resource === 'college' ? ERROR_CODES.COLLEGE_NOT_FOUND :
               resource === 'department' ? ERROR_CODES.DEPARTMENT_NOT_FOUND :
               ERROR_CODES.DATA_NOT_FOUND;

  return createErrorResponse(
    code,
    `${resource.charAt(0).toUpperCase() + resource.slice(1)} not found`,
    id ? { id } : undefined,
    404
  );
}

/**
 * Handle internal server errors
 */
export function handleInternalError(
  error: Error | unknown,
  operation?: string
): { response: AdminResponse; statusCode: number } {
  const message = error instanceof Error ? error.message : 'An internal error occurred';
  const sanitizedMessage = process.env.NODE_ENV === 'production' 
    ? 'An internal error occurred while processing your request'
    : message;

  return createErrorResponse(
    ERROR_CODES.INTERNAL_ERROR,
    sanitizedMessage,
    operation ? { operation } : undefined,
    500
  );
}

/**
 * Send standardized error response
 */
export function sendErrorResponse(
  reply: FastifyReply,
  error: { response: AdminResponse; statusCode: number }
): FastifyReply {
  return reply.status(error.statusCode).send(error.response);
}

/**
 * Middleware wrapper for consistent error handling
 */
export function withErrorHandling(
  handler: (request: any, reply: FastifyReply) => Promise<any>
) {
  return async (request: any, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorResponse = handleValidationError(error);
        return sendErrorResponse(reply, errorResponse);
      }
      
      const errorResponse = handleInternalError(error);
      return sendErrorResponse(reply, errorResponse);
    }
  };
}

/**
 * Log error for monitoring and debugging
 */
export function logError(
  error: Error | unknown,
  context: {
    operation?: string;
    adminId?: string;
    requestId?: string;
    additionalData?: any;
  }
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    context
  };

  console.error(`[ADMIN_ERROR] ${JSON.stringify(logEntry)}`);
  
  // In production, this should be sent to a proper logging service
  return logEntry;
}

/**
 * Create success response with consistent format
 */
export function createSuccessResponse(
  data?: any,
  message?: string,
  pagination?: any
): AdminResponse {
  return {
    success: true,
    data,
    message,
    pagination
  };
}
