import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';

/**
 * Standard success response format
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  meta?: {
    timestamp: string;
    requestId?: string;
    version: string;
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      hasNext?: boolean;
      hasPrev?: boolean;
    };
  };
}

/**
 * Standard error response format (handled by errorHandler)
 */
export interface ErrorResponse {
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

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Response wrapper utility class
 */
export class ResponseWrapper {
  /**
   * Create a success response
   */
  static success<T>(
    data: T,
    message?: string,
    meta?: Partial<SuccessResponse['meta']>
  ): SuccessResponse<T> {
    return {
      success: true,
      data,
      message,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        ...meta
      }
    };
  }

  /**
   * Create a paginated success response
   */
  static paginated<T>(
    data: T[],
    pagination: PaginationMeta,
    message?: string
  ): SuccessResponse<T[]> {
    return {
      success: true,
      data,
      message,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        pagination
      }
    };
  }

  /**
   * Create pagination metadata
   */
  static createPaginationMeta(
    total: number,
    limit: number,
    offset: number
  ): PaginationMeta {
    return {
      total,
      limit,
      offset,
      hasNext: offset + limit < total,
      hasPrev: offset > 0
    };
  }

  /**
   * Send success response
   */
  static sendSuccess<T>(
    reply: FastifyReply,
    data: T,
    message?: string,
    statusCode: number = 200
  ) {
    const response = ResponseWrapper.success(data, message, {
      requestId: reply.request.id
    });
    
    return reply.status(statusCode).send(response);
  }

  /**
   * Send paginated response
   */
  static sendPaginated<T>(
    reply: FastifyReply,
    data: T[],
    pagination: PaginationMeta,
    message?: string,
    statusCode: number = 200
  ) {
    const response = ResponseWrapper.paginated(data, pagination, message);
    response.meta!.requestId = reply.request.id;
    
    return reply.status(statusCode).send(response);
  }

  /**
   * Send created response (201)
   */
  static sendCreated<T>(
    reply: FastifyReply,
    data: T,
    message: string = 'Resource created successfully'
  ) {
    return ResponseWrapper.sendSuccess(reply, data, message, 201);
  }

  /**
   * Send no content response (204)
   */
  static sendNoContent(reply: FastifyReply) {
    return reply.status(204).send();
  }
}

/**
 * Middleware to add response wrapper methods to reply object
 */
export async function responseWrapperPlugin(fastify: any) {
  fastify.decorateReply('sendSuccess', function<T>(
    this: FastifyReply,
    data: T,
    message?: string,
    statusCode: number = 200
  ) {
    return ResponseWrapper.sendSuccess(this, data, message, statusCode);
  });

  fastify.decorateReply('sendPaginated', function<T>(
    this: FastifyReply,
    data: T[],
    pagination: PaginationMeta,
    message?: string,
    statusCode: number = 200
  ) {
    return ResponseWrapper.sendPaginated(this, data, pagination, message, statusCode);
  });

  fastify.decorateReply('sendCreated', function<T>(
    this: FastifyReply,
    data: T,
    message: string = 'Resource created successfully'
  ) {
    return ResponseWrapper.sendCreated(this, data, message);
  });

  fastify.decorateReply('sendNoContent', function(this: FastifyReply) {
    return ResponseWrapper.sendNoContent(this);
  });
}

/**
 * Extend FastifyReply interface with wrapper methods
 */
declare module 'fastify' {
  interface FastifyReply {
    sendSuccess<T>(data: T, message?: string, statusCode?: number): FastifyReply;
    sendPaginated<T>(data: T[], pagination: PaginationMeta, message?: string, statusCode?: number): FastifyReply;
    sendCreated<T>(data: T, message?: string): FastifyReply;
    sendNoContent(): FastifyReply;
  }
}

/**
 * Legacy response format converter for backward compatibility
 */
export class LegacyResponseConverter {
  /**
   * Convert new format to legacy format if needed
   */
  static toLegacy<T>(response: SuccessResponse<T>): any {
    // Some endpoints might expect the old format
    // This can be used during migration period
    return {
      accessToken: (response.data as any)?.accessToken,
      user: (response.data as any)?.user,
      ...response.data
    };
  }

  /**
   * Detect if client expects legacy format
   */
  static shouldUseLegacy(request: FastifyRequest): boolean {
    const userAgent = request.headers['user-agent'] || '';
    const apiVersion = request.headers['api-version'] as string;
    
    // Use legacy format for old clients or if explicitly requested
    return apiVersion === 'v1-legacy' || userAgent.includes('legacy');
  }
}

/**
 * Middleware to handle response format based on client
 */
export async function responseFormatMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const originalSend = reply.send.bind(reply);
  
  reply.send = function(payload: any) {
    // Only wrap successful responses that aren't already wrapped
    if (payload && typeof payload === 'object' && !payload.hasOwnProperty('success')) {
      // Check if this looks like an auth response
      if (payload.accessToken || payload.user) {
        const wrappedResponse = ResponseWrapper.success(payload, undefined, {
          requestId: request.id
        });
        
        // Use legacy format if client expects it
        if (LegacyResponseConverter.shouldUseLegacy(request)) {
          return originalSend(payload);
        }
        
        return originalSend(wrappedResponse);
      }
    }
    
    return originalSend(payload);
  };
}
