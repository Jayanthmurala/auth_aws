import { FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodSchema } from 'zod';
import { createErrorResponse } from './errorHandler';

/**
 * Input sanitization utilities
 */
export class InputSanitizer {
  /**
   * Sanitize string input to prevent XSS
   */
  static sanitizeString(input: string): string {
    return input
      .trim()
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers
  }

  /**
   * Sanitize email input
   */
  static sanitizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  /**
   * Sanitize and validate password strength
   */
  static validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate and sanitize college member ID
   */
  static sanitizeCollegeMemberId(id: string): string {
    return id.trim().replace(/[^a-zA-Z0-9-_]/g, '');
  }
}

/**
 * Common validation schemas
 */
export const CommonSchemas = {
  email: z.string()
    .email('Invalid email format')
    .min(1, 'Email is required')
    .max(255, 'Email too long')
    .transform(InputSanitizer.sanitizeEmail),

  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .refine((password) => {
      const validation = InputSanitizer.validatePassword(password);
      return validation.valid;
    }, 'Password does not meet security requirements'),

  displayName: z.string()
    .min(2, 'Display name must be at least 2 characters')
    .max(100, 'Display name too long')
    .transform(InputSanitizer.sanitizeString),

  department: z.string()
    .min(1, 'Department is required')
    .max(100, 'Department name too long')
    .transform(InputSanitizer.sanitizeString),

  collegeMemberId: z.string()
    .min(1, 'College member ID is required')
    .max(50, 'College member ID too long')
    .transform(InputSanitizer.sanitizeCollegeMemberId)
    .optional(),

  year: z.number()
    .int('Year must be an integer')
    .min(1, 'Year must be between 1 and 6')
    .max(6, 'Year must be between 1 and 6')
    .optional(),

  collegeId: z.string()
    .min(1, 'College ID is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid college ID format'),

  pagination: {
    limit: z.string()
      .optional()
      .transform((val) => val ? parseInt(val, 10) : 20)
      .refine((val) => val >= 1 && val <= 100, 'Limit must be between 1 and 100'),
    
    offset: z.string()
      .optional()
      .transform((val) => val ? parseInt(val, 10) : 0)
      .refine((val) => val >= 0, 'Offset must be non-negative'),
  }
};

/**
 * Rate limiting validation schemas
 */
export const RateLimitSchemas = {
  // Stricter limits for sensitive operations
  auth: {
    login: { max: 5, timeWindow: '15 minutes' },
    register: { max: 3, timeWindow: '15 minutes' },
    forgotPassword: { max: 3, timeWindow: '15 minutes' },
    resetPassword: { max: 5, timeWindow: '15 minutes' },
    verifyEmail: { max: 10, timeWindow: '15 minutes' }
  },
  
  // Standard limits for general operations
  general: {
    max: 100,
    timeWindow: '15 minutes'
  }
};

/**
 * Middleware factory for input validation
 */
export function validateInput<T extends ZodSchema>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate request body
      if (request.body) {
        const validatedBody = schema.parse(request.body);
        request.body = validatedBody;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          value: (err as any).received || 'invalid'
        }));

        const errorResponse = createErrorResponse(
          'Validation failed',
          'VALIDATION_ERROR',
          { validationErrors },
          400
        );

        return reply.status(400).send(errorResponse);
      }
      
      throw error;
    }
  };
}

/**
 * Middleware for query parameter validation
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedQuery = schema.parse(request.query);
      request.query = validatedQuery;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          value: (err as any).received || 'invalid'
        }));

        const errorResponse = createErrorResponse(
          'Query validation failed',
          'QUERY_VALIDATION_ERROR',
          { validationErrors },
          400
        );

        return reply.status(400).send(errorResponse);
      }
      
      throw error;
    }
  };
}

/**
 * Middleware for parameter validation
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedParams = schema.parse(request.params);
      request.params = validatedParams;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          value: (err as any).received || 'invalid'
        }));

        const errorResponse = createErrorResponse(
          'Parameter validation failed',
          'PARAM_VALIDATION_ERROR',
          { validationErrors },
          400
        );

        return reply.status(400).send(errorResponse);
      }
      
      throw error;
    }
  };
}

/**
 * Security validation middleware
 */
export const SecurityValidation = {
  /**
   * Prevent SQL injection patterns
   */
  preventSQLInjection: async (request: FastifyRequest, reply: FastifyReply) => {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
      /(--|\/\*|\*\/|;|'|")/,
      /(\bOR\b|\bAND\b).*?[=<>]/i
    ];

    const checkValue = (value: any): boolean => {
      if (typeof value === 'string') {
        return sqlPatterns.some(pattern => pattern.test(value));
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(checkValue);
      }
      return false;
    };

    const hasSQLInjection = 
      checkValue(request.body) || 
      checkValue(request.query) || 
      checkValue(request.params);

    if (hasSQLInjection) {
      const errorResponse = createErrorResponse(
        'Invalid input detected',
        'SECURITY_VIOLATION',
        undefined,
        400
      );
      return reply.status(400).send(errorResponse);
    }
  },

  /**
   * Validate file upload security
   */
  validateFileUpload: (allowedTypes: string[], maxSize: number = 5 * 1024 * 1024) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const data = request.body as any;
      
      if (data?.file) {
        const { mimetype, size } = data.file;
        
        if (!allowedTypes.includes(mimetype)) {
          const errorResponse = createErrorResponse(
            'Invalid file type',
            'INVALID_FILE_TYPE',
            { allowedTypes },
            400
          );
          return reply.status(400).send(errorResponse);
        }
        
        if (size > maxSize) {
          const errorResponse = createErrorResponse(
            'File too large',
            'FILE_TOO_LARGE',
            { maxSize, actualSize: size },
            400
          );
          return reply.status(400).send(errorResponse);
        }
      }
    };
  }
};
