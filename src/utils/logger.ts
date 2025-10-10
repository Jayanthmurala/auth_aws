import { FastifyRequest } from 'fastify';
import { env } from '../config/env';

export interface LogContext {
  userId?: string;
  requestId?: string;
  operation?: string;
  duration?: number;
  [key: string]: any;
}

/**
 * Structured logging utility to replace console.log statements
 * Uses Fastify's built-in logger when available, falls back to structured console logging
 */
export class Logger {
  /**
   * Log info level messages
   */
  static info(message: string, context?: LogContext, request?: FastifyRequest) {
    if (request?.log) {
      request.log.info(context, message);
    } else {
      const logEntry = {
        level: 'info',
        message,
        timestamp: new Date().toISOString(),
        ...context
      };
      
      if (env.NODE_ENV === 'development') {
        console.log(JSON.stringify(logEntry, null, 2));
      } else {
        console.log(JSON.stringify(logEntry));
      }
    }
  }
  
  /**
   * Log warning level messages
   */
  static warn(message: string, context?: LogContext, request?: FastifyRequest) {
    if (request?.log) {
      request.log.warn(context, message);
    } else {
      const logEntry = {
        level: 'warn',
        message,
        timestamp: new Date().toISOString(),
        ...context
      };
      
      if (env.NODE_ENV === 'development') {
        console.warn(JSON.stringify(logEntry, null, 2));
      } else {
        console.warn(JSON.stringify(logEntry));
      }
    }
  }
  
  /**
   * Log error level messages
   */
  static error(message: string, error?: Error, context?: LogContext, request?: FastifyRequest) {
    const errorContext = {
      ...context,
      error: error ? {
        message: error.message,
        stack: env.NODE_ENV === 'development' ? error.stack : undefined,
        name: error.name
      } : undefined
    };
    
    if (request?.log) {
      request.log.error(errorContext, message);
    } else {
      const logEntry = {
        level: 'error',
        message,
        timestamp: new Date().toISOString(),
        ...errorContext
      };
      
      if (env.NODE_ENV === 'development') {
        console.error(JSON.stringify(logEntry, null, 2));
      } else {
        console.error(JSON.stringify(logEntry));
      }
    }
  }
  
  /**
   * Log debug level messages (only in development)
   */
  static debug(message: string, context?: LogContext, request?: FastifyRequest) {
    if (env.NODE_ENV !== 'development') {
      return; // Skip debug logs in production
    }
    
    if (request?.log) {
      request.log.debug(context, message);
    } else {
      const logEntry = {
        level: 'debug',
        message,
        timestamp: new Date().toISOString(),
        ...context
      };
      
      console.debug(JSON.stringify(logEntry, null, 2));
    }
  }
  
  /**
   * Log authentication events
   */
  static auth(message: string, context: LogContext & { 
    userId?: string; 
    action: 'login' | 'logout' | 'register' | 'refresh' | 'verify';
    success: boolean;
  }, request?: FastifyRequest) {
    const authContext = {
      ...context,
      category: 'authentication'
    };
    
    if (context.success) {
      this.info(message, authContext, request);
    } else {
      this.warn(message, authContext, request);
    }
  }
  
  /**
   * Log security events
   */
  static security(message: string, context: LogContext & {
    severity: 'low' | 'medium' | 'high' | 'critical';
    event: string;
  }, request?: FastifyRequest) {
    const securityContext = {
      ...context,
      category: 'security'
    };
    
    if (context.severity === 'critical' || context.severity === 'high') {
      this.error(message, undefined, securityContext, request);
    } else if (context.severity === 'medium') {
      this.warn(message, securityContext, request);
    } else {
      this.info(message, securityContext, request);
    }
  }
  
  /**
   * Log performance metrics
   */
  static performance(message: string, context: LogContext & {
    operation: string;
    duration: number;
    threshold?: number;
  }, request?: FastifyRequest) {
    const perfContext = {
      ...context,
      category: 'performance'
    };
    
    const threshold = context.threshold || 1000; // Default 1s threshold
    
    if (context.duration > threshold) {
      this.warn(message, perfContext, request);
    } else {
      this.info(message, perfContext, request);
    }
  }
}

/**
 * Create a performance timer
 */
export function createTimer(operation: string) {
  const start = Date.now();
  
  return {
    end: (message?: string, context?: LogContext, request?: FastifyRequest) => {
      const duration = Date.now() - start;
      Logger.performance(
        message || `${operation} completed`,
        { operation, duration, ...context },
        request
      );
      return duration;
    }
  };
}

/**
 * Sanitize sensitive data from logs
 */
export function sanitizeLogData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'password', 'passwordHash', 'token', 'accessToken', 'refreshToken',
    'secret', 'key', 'apiKey', 'authorization', 'cookie', 'session'
  ];
  
  const sanitized = { ...data };
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  // Recursively sanitize nested objects
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }
  
  return sanitized;
}
