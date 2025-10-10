import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';

export interface StandardError {
  success: false;
  error: {
    message: string;
    code: string;
    details?: any;
    timestamp: string;
    path: string;
    requestId?: string;
  };
}

export interface ValidationError extends StandardError {
  error: StandardError['error'] & {
    code: 'VALIDATION_ERROR';
    validationErrors: Array<{
      field: string;
      message: string;
      value?: any;
    }>;
  };
}

/**
 * Global error handler for consistent error responses
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const timestamp = new Date().toISOString();
  const path = request.url;
  const requestId = request.id;

  // Log error details (without sensitive data)
  if (env.NODE_ENV === 'development') {
    console.error('[ERROR]', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      path,
      requestId,
      timestamp
    });
  }

  // Handle validation errors (Zod/Fastify validation)
  if (error.code === 'FST_ERR_VALIDATION') {
    const validationError: ValidationError = {
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.validation,
        validationErrors: error.validation?.map((v: any) => ({
          field: v.instancePath || v.schemaPath || 'unknown',
          message: v.message || 'Invalid value',
          value: v.data
        })) || [],
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(400).send(validationError);
  }

  // Handle authentication errors
  if (error.code === 'FST_ERR_UNAUTHORIZED' || error.statusCode === 401) {
    const authError: StandardError = {
      success: false,
      error: {
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(401).send(authError);
  }

  // Handle forbidden errors
  if (error.statusCode === 403) {
    const forbiddenError: StandardError = {
      success: false,
      error: {
        message: 'Access forbidden',
        code: 'FORBIDDEN',
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(403).send(forbiddenError);
  }

  // Handle not found errors
  if (error.statusCode === 404) {
    const notFoundError: StandardError = {
      success: false,
      error: {
        message: 'Resource not found',
        code: 'NOT_FOUND',
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(404).send(notFoundError);
  }

  // Handle rate limit errors
  if (error.code === 'FST_ERR_RATE_LIMIT') {
    const rateLimitError: StandardError = {
      success: false,
      error: {
        message: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        details: {
          retryAfter: (error as any).retryAfter || 900 // 15 minutes default
        },
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(429).send(rateLimitError);
  }

  // Handle database errors
  if (error.message?.includes('Prisma') || error.message?.includes('database')) {
    const dbError: StandardError = {
      success: false,
      error: {
        message: 'Database operation failed',
        code: 'DATABASE_ERROR',
        details: env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(500).send(dbError);
  }

  // Handle JWT errors
  if (error.message?.includes('JWT') || error.message?.includes('token')) {
    const jwtError: StandardError = {
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'TOKEN_ERROR',
        timestamp,
        path,
        requestId
      }
    };
    
    return reply.status(401).send(jwtError);
  }

  // Default internal server error
  const internalError: StandardError = {
    success: false,
    error: {
      message: env.NODE_ENV === 'development' 
        ? error.message 
        : 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: env.NODE_ENV === 'development' ? {
        stack: error.stack,
        originalCode: error.code
      } : undefined,
      timestamp,
      path,
      requestId
    }
  };

  return reply.status(error.statusCode || 500).send(internalError);
}

/**
 * Helper function to create consistent success responses
 */
export function createSuccessResponse<T = any>(data: T, message?: string) {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Helper function to create consistent error responses
 */
export function createErrorResponse(
  message: string,
  code: string,
  details?: any,
  statusCode: number = 400
) {
  return {
    success: false,
    error: {
      message,
      code,
      details,
      timestamp: new Date().toISOString()
    },
    statusCode
  };
}
