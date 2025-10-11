import { FastifyRequest, FastifyReply } from 'fastify';
// import DOMPurify from 'isomorphic-dompurify'; // Removed due to Node.js 18 compatibility
// Using simple string sanitization instead

/**
 * Simple HTML/XSS sanitization function
 * Replaces DOMPurify for Node.js 18 compatibility
 */
function simpleSanitize(input: string, options: { 
  ALLOWED_TAGS?: string[], 
  ALLOWED_ATTR?: string[], 
  KEEP_CONTENT?: boolean,
  ALLOW_DATA_ATTR?: boolean,
  ALLOW_UNKNOWN_PROTOCOLS?: boolean,
  SANITIZE_DOM?: boolean
} = {}): string {
  if (!input || typeof input !== 'string') return input;
  
  // Remove script tags and their content
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove dangerous HTML tags
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'];
  for (const tag of dangerousTags) {
    const regex = new RegExp(`<${tag}\\b[^>]*>.*?<\\/${tag}>`, 'gi');
    sanitized = sanitized.replace(regex, '');
  }
  
  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  
  // If no tags allowed, remove all HTML tags but keep content
  if (options.ALLOWED_TAGS && options.ALLOWED_TAGS.length === 0) {
    if (options.KEEP_CONTENT) {
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }
  }
  
  return sanitized;
}
import { Logger } from '../utils/logger.js';

/**
 * Input sanitization middleware to prevent XSS attacks
 * Sanitizes request body, query parameters, and headers
 */

interface SanitizationOptions {
  sanitizeBody?: boolean;
  sanitizeQuery?: boolean;
  sanitizeHeaders?: boolean;
  allowedTags?: string[];
  allowedAttributes?: string[];
  logSanitization?: boolean;
}

const DEFAULT_OPTIONS: Required<SanitizationOptions> = {
  sanitizeBody: true,
  sanitizeQuery: true,
  sanitizeHeaders: false, // Headers are typically safe
  allowedTags: [], // No HTML tags allowed by default
  allowedAttributes: [],
  logSanitization: true
};

/**
 * Recursively sanitize an object
 */
function sanitizeObject(obj: any, options: Required<SanitizationOptions>): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    const original = obj;
    const sanitized = simpleSanitize(obj, {
      ALLOWED_TAGS: options.allowedTags,
      ALLOWED_ATTR: options.allowedAttributes,
      KEEP_CONTENT: true, // Keep text content even if tags are removed
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      SANITIZE_DOM: true
    });
    
    // Log if content was modified
    if (options.logSanitization && original !== sanitized && sanitized.length < original.length) {
      Logger.security('Input sanitized - potential XSS attempt detected', {
        severity: 'medium',
        event: 'input_sanitization',
        originalLength: original.length,
        sanitizedLength: sanitized.length,
        removed: original.length - sanitized.length
      });
    }
    
    return sanitized;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize both key and value
      const sanitizedKey = typeof key === 'string' 
        ? simpleSanitize(key, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
        : key;
      sanitized[sanitizedKey] = sanitizeObject(value, options);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Create input sanitization middleware
 */
export function createInputSanitizer(options: SanitizationOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async function inputSanitizationMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Sanitize request body
      if (config.sanitizeBody && request.body) {
        request.body = sanitizeObject(request.body, config);
      }

      // Sanitize query parameters
      if (config.sanitizeQuery && request.query) {
        request.query = sanitizeObject(request.query, config);
      }

      // Sanitize specific headers if enabled
      if (config.sanitizeHeaders && request.headers) {
        const headersToSanitize = ['user-agent', 'referer', 'x-forwarded-for'];
        for (const header of headersToSanitize) {
          if (request.headers[header] && typeof request.headers[header] === 'string') {
            request.headers[header] = simpleSanitize(request.headers[header] as string, {
              ALLOWED_TAGS: [],
              ALLOWED_ATTR: []
            });
          }
        }
      }

    } catch (error) {
      Logger.error('Input sanitization failed', error instanceof Error ? error : new Error(String(error)), {
        operation: 'input_sanitization',
        url: request.url,
        method: request.method
      });
      
      // Don't block the request, but log the error
      // In production, you might want to be more strict
    }
  };
}

/**
 * Predefined sanitizers for different use cases
 */
export const InputSanitizers = {
  // Strict sanitization - no HTML allowed
  strict: createInputSanitizer({
    sanitizeBody: true,
    sanitizeQuery: true,
    sanitizeHeaders: false,
    allowedTags: [],
    allowedAttributes: [],
    logSanitization: true
  }),

  // Moderate sanitization - basic formatting allowed
  moderate: createInputSanitizer({
    sanitizeBody: true,
    sanitizeQuery: true,
    sanitizeHeaders: false,
    allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br'],
    allowedAttributes: [],
    logSanitization: true
  }),

  // Lenient sanitization - more HTML allowed (for rich text)
  lenient: createInputSanitizer({
    sanitizeBody: true,
    sanitizeQuery: true,
    sanitizeHeaders: false,
    allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    allowedAttributes: ['class'],
    logSanitization: true
  }),

  // Query-only sanitization
  queryOnly: createInputSanitizer({
    sanitizeBody: false,
    sanitizeQuery: true,
    sanitizeHeaders: false,
    allowedTags: [],
    allowedAttributes: [],
    logSanitization: true
  }),

  // Body-only sanitization
  bodyOnly: createInputSanitizer({
    sanitizeBody: true,
    sanitizeQuery: false,
    sanitizeHeaders: false,
    allowedTags: [],
    allowedAttributes: [],
    logSanitization: true
  })
};

/**
 * Utility function to manually sanitize a string
 */
export function sanitizeString(input: string, options: {
  allowedTags?: string[];
  allowedAttributes?: string[];
} = {}): string {
  return simpleSanitize(input, {
    ALLOWED_TAGS: options.allowedTags || [],
    ALLOWED_ATTR: options.allowedAttributes || [],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true
  });
}

/**
 * Utility function to check if a string contains potentially dangerous content
 */
export function containsPotentialXSS(input: string): boolean {
  const original = input;
  const sanitized = simpleSanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
  
  return original !== sanitized;
}

/**
 * Advanced XSS detection patterns
 */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  /<embed\b[^<]*>/gi,
  /<link\b[^<]*>/gi,
  /<meta\b[^<]*>/gi,
  /data:text\/html/gi,
  /vbscript:/gi,
  /expression\s*\(/gi
];

/**
 * Check for common XSS patterns
 */
export function detectXSSPatterns(input: string): boolean {
  return XSS_PATTERNS.some(pattern => pattern.test(input));
}

/**
 * Comprehensive XSS validation middleware
 */
export function createXSSValidator() {
  return async function xssValidationMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const checkForXSS = (obj: any, path: string = ''): boolean => {
      if (typeof obj === 'string') {
        if (detectXSSPatterns(obj) || containsPotentialXSS(obj)) {
          Logger.security('Potential XSS attack detected', {
            severity: 'high',
            event: 'xss_detection',
            path,
            content: obj.substring(0, 100), // Log first 100 chars
            ip: request.ip,
            userAgent: request.headers['user-agent']
          });
          return true;
        }
      } else if (Array.isArray(obj)) {
        return obj.some((item, index) => checkForXSS(item, `${path}[${index}]`));
      } else if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([key, value]) => 
          checkForXSS(value, path ? `${path}.${key}` : key)
        );
      }
      return false;
    };

    // Check body for XSS
    if (request.body && checkForXSS(request.body, 'body')) {
      return reply.code(400).send({
        error: 'Invalid input detected',
        message: 'Request contains potentially malicious content'
      });
    }

    // Check query parameters for XSS
    if (request.query && checkForXSS(request.query, 'query')) {
      return reply.code(400).send({
        error: 'Invalid query parameters',
        message: 'Query contains potentially malicious content'
      });
    }
  };
}
