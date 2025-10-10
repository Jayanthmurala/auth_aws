import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { createErrorResponse } from './errorHandler';

/**
 * Enhanced CSRF Protection Implementation with HMAC and Redis support
 */
class CSRFProtection {
  public static tokens = new Map<string, { token: string; expiry: number; used: boolean }>();
  
  /**
   * Generate secure CSRF token using HMAC
   */
  static generateToken(sessionId: string): string {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const data = `${sessionId}:${timestamp}:${nonce}`;
    
    const signature = createHmac('sha256', env.CSRF_SECRET)
      .update(data)
      .digest('hex');
    
    const token = `${data}:${signature}`;
    
    // Store in memory for fallback (will be replaced with Redis in production)
    const expiry = Date.now() + (30 * 60 * 1000); // 30 minutes
    this.tokens.set(sessionId, { token, expiry, used: false });
    
    // Clean up expired tokens
    this.cleanup();
    
    return token;
  }
  
  /**
   * Verify CSRF token using HMAC
   */
  static verifyToken(sessionId: string, providedToken: string): boolean {
    const parts = providedToken.split(':');
    if (parts.length !== 4) return false;
    
    const [tokenSessionId, timestamp, nonce, signature] = parts;
    
    // Verify session ID matches
    if (tokenSessionId !== sessionId) return false;
    
    // Verify timestamp (30 minutes)
    const tokenTime = parseInt(timestamp);
    if (Date.now() - tokenTime > 30 * 60 * 1000) return false;
    
    // Verify HMAC signature
    const data = `${tokenSessionId}:${timestamp}:${nonce}`;
    const expectedSignature = createHmac('sha256', env.CSRF_SECRET)
      .update(data)
      .digest('hex');
    
    if (!timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      return false;
    }
    
    // Check if token was already used (one-time use)
    const tokenData = this.tokens.get(sessionId);
    if (tokenData && tokenData.used) {
      return false;
    }
    
    // Mark as used
    if (tokenData) {
      tokenData.used = true;
    }
    
    return true;
  }
  
  /**
   * Clean up expired tokens
   */
  private static cleanup(): void {
    const now = Date.now();
    for (const [sessionId, tokenData] of this.tokens.entries()) {
      if (now > tokenData.expiry) {
        this.tokens.delete(sessionId);
      }
    }
  }
  
  /**
   * Get token statistics
   */
  static getStats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;
    let used = 0;
    
    for (const tokenData of this.tokens.values()) {
      if (now > tokenData.expiry) {
        expired++;
      } else if (tokenData.used) {
        used++;
      } else {
        active++;
      }
    }
    
    return { active, expired, used, total: this.tokens.size };
  }
}

/**
 * Redis-based CSRF Protection (for production use)
 */
class DistributedCSRFProtection {
  // Note: Redis client would be initialized here in a real implementation
  // private static redis: Redis;
  
  /**
   * Generate secure CSRF token with Redis storage
   */
  static async generateToken(sessionId: string): Promise<string> {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const data = `${sessionId}:${timestamp}:${nonce}`;
    
    const signature = createHmac('sha256', env.CSRF_SECRET)
      .update(data)
      .digest('hex');
    
    const token = `${data}:${signature}`;
    
    // In production, store in Redis:
    // await this.redis.setex(`csrf:${sessionId}:${token}`, 1800, 'valid'); // 30 minutes
    
    // For now, fallback to memory storage
    CSRFProtection.tokens.set(sessionId, { 
      token, 
      expiry: Date.now() + (30 * 60 * 1000), 
      used: false 
    });
    
    return token;
  }
  
  /**
   * Verify CSRF token with Redis storage
   */
  static async verifyToken(sessionId: string, providedToken: string): Promise<boolean> {
    const parts = providedToken.split(':');
    if (parts.length !== 4) return false;
    
    const [tokenSessionId, timestamp, nonce, signature] = parts;
    
    // Verify session ID matches
    if (tokenSessionId !== sessionId) return false;
    
    // Verify timestamp (30 minutes)
    const tokenTime = parseInt(timestamp);
    if (Date.now() - tokenTime > 30 * 60 * 1000) return false;
    
    // Verify HMAC signature
    const data = `${tokenSessionId}:${timestamp}:${nonce}`;
    const expectedSignature = createHmac('sha256', env.CSRF_SECRET)
      .update(data)
      .digest('hex');
    
    if (!timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      return false;
    }
    
    // In production, check and delete from Redis:
    // const key = `csrf:${sessionId}:${providedToken}`;
    // const result = await this.redis.get(key);
    // if (result === 'valid') {
    //   await this.redis.del(key); // One-time use
    //   return true;
    // }
    // return false;
    
    // For now, fallback to memory storage
    return CSRFProtection.verifyToken(sessionId, providedToken);
  }
}

/**
 * Advanced Rate Limiting with different strategies
 */
export class AdvancedRateLimit {
  private static requests = new Map<string, { count: number; resetTime: number; blocked: boolean }>();
  private static suspiciousIPs = new Set<string>();
  
  /**
   * Check rate limit with different strategies
   */
  static checkLimit(
    identifier: string, 
    maxRequests: number, 
    windowMs: number,
    strategy: 'sliding' | 'fixed' = 'sliding'
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const windowStart = strategy === 'sliding' ? now - windowMs : Math.floor(now / windowMs) * windowMs;
    
    let requestData = this.requests.get(identifier);
    
    if (!requestData || requestData.resetTime <= now) {
      requestData = { count: 0, resetTime: windowStart + windowMs, blocked: false };
      this.requests.set(identifier, requestData);
    }
    
    // Check if IP is blocked
    if (requestData.blocked) {
      return { allowed: false, remaining: 0, resetTime: requestData.resetTime };
    }
    
    requestData.count++;
    
    const allowed = requestData.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - requestData.count);
    
    // Block if exceeded significantly
    if (requestData.count > maxRequests * 2) {
      requestData.blocked = true;
      this.suspiciousIPs.add(identifier);
    }
    
    return { allowed, remaining, resetTime: requestData.resetTime };
  }
  
  /**
   * Check if IP is suspicious
   */
  static isSuspicious(ip: string): boolean {
    return this.suspiciousIPs.has(ip);
  }
  
  /**
   * Unblock an IP
   */
  static unblock(identifier: string): void {
    this.requests.delete(identifier);
    this.suspiciousIPs.delete(identifier);
  }
  
  /**
   * Get rate limit statistics
   */
  static getStats() {
    const now = Date.now();
    let active = 0;
    let blocked = 0;
    
    for (const data of this.requests.values()) {
      if (data.resetTime > now) {
        active++;
        if (data.blocked) blocked++;
      }
    }
    
    return {
      active,
      blocked,
      suspicious: this.suspiciousIPs.size,
      total: this.requests.size
    };
  }
}

/**
 * Security headers middleware
 */
export async function securityHeadersMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Additional security headers beyond Helmet
  reply.header('X-Request-ID', request.id);
  reply.header('X-Response-Time', Date.now().toString());
  
  // Prevent clickjacking for sensitive operations
  if (request.url.includes('/admin') || request.url.includes('/auth')) {
    reply.header('X-Frame-Options', 'DENY');
  }
  
  // Content Security Policy for API responses
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");
  
  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff');
  
  // Referrer policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/**
 * CSRF protection middleware
 */
export function csrfProtection(options: { 
  ignoreMethods?: string[];
  headerName?: string;
  cookieName?: string;
} = {}) {
  const {
    ignoreMethods = ['GET', 'HEAD', 'OPTIONS'],
    headerName = 'X-CSRF-Token',
    cookieName = 'csrf-token'
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip CSRF for safe methods
    if (ignoreMethods.includes(request.method)) {
      return;
    }
    
    // Get session ID (from user ID or IP as fallback)
    const sessionId = (request as any).user?.id || request.ip;
    
    // Get CSRF token from header or body
    const providedToken = request.headers[headerName.toLowerCase()] as string ||
                         (request.body as any)?.[cookieName];
    
    if (!providedToken) {
      const errorResponse = createErrorResponse(
        'CSRF token required',
        'CSRF_TOKEN_MISSING',
        { headerName, cookieName },
        403
      );
      return reply.status(403).send(errorResponse);
    }
    
    if (!CSRFProtection.verifyToken(sessionId, providedToken)) {
      const errorResponse = createErrorResponse(
        'Invalid CSRF token',
        'CSRF_TOKEN_INVALID',
        undefined,
        403
      );
      return reply.status(403).send(errorResponse);
    }
  };
}

/**
 * Advanced rate limiting middleware
 */
export function advancedRateLimit(options: {
  max: number;
  windowMs: number;
  strategy?: 'sliding' | 'fixed';
  keyGenerator?: (request: FastifyRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}) {
  const {
    max,
    windowMs,
    strategy = 'sliding',
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = keyGenerator(request);
    
    // Check if IP is already marked as suspicious
    if (AdvancedRateLimit.isSuspicious(key)) {
      const errorResponse = createErrorResponse(
        'IP temporarily blocked due to suspicious activity',
        'IP_BLOCKED',
        { unblockTime: Date.now() + (60 * 60 * 1000) }, // 1 hour
        429
      );
      return reply.status(429).send(errorResponse);
    }
    
    const { allowed, remaining, resetTime } = AdvancedRateLimit.checkLimit(
      key, max, windowMs, strategy
    );
    
    // Set rate limit headers
    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', new Date(resetTime).toISOString());
    
    if (!allowed) {
      const errorResponse = createErrorResponse(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        {
          limit: max,
          windowMs,
          resetTime: new Date(resetTime).toISOString()
        },
        429
      );
      return reply.status(429).send(errorResponse);
    }
    
    // Hook into response to potentially skip counting
    reply.raw.on('finish', () => {
      const statusCode = reply.statusCode;
      const isSuccess = statusCode >= 200 && statusCode < 400;
      const isFailure = statusCode >= 400;
      
      if ((skipSuccessfulRequests && isSuccess) || 
          (skipFailedRequests && isFailure)) {
        // Would need to implement request counting rollback
        // For now, we count all requests
      }
    });
  };
}

/**
 * IP whitelist/blacklist middleware
 */
export function ipFilter(options: {
  whitelist?: string[];
  blacklist?: string[];
  trustProxy?: boolean;
}) {
  const { whitelist = [], blacklist = [], trustProxy = true } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    let clientIP = request.ip;
    
    // Get real IP if behind proxy
    if (trustProxy) {
      const forwardedFor = request.headers['x-forwarded-for'] as string;
      const realIP = request.headers['x-real-ip'] as string;
      
      if (forwardedFor) {
        clientIP = forwardedFor.split(',')[0].trim();
      } else if (realIP) {
        clientIP = realIP;
      }
    }
    
    // Check blacklist first
    if (blacklist.length > 0 && blacklist.includes(clientIP)) {
      const errorResponse = createErrorResponse(
        'Access denied',
        'IP_BLACKLISTED',
        { ip: clientIP },
        403
      );
      return reply.status(403).send(errorResponse);
    }
    
    // Check whitelist if specified
    if (whitelist.length > 0 && !whitelist.includes(clientIP)) {
      const errorResponse = createErrorResponse(
        'Access denied',
        'IP_NOT_WHITELISTED',
        { ip: clientIP },
        403
      );
      return reply.status(403).send(errorResponse);
    }
  };
}

/**
 * Request signature verification
 */
export function requestSignature(options: {
  secret: string;
  headerName?: string;
  algorithm?: string;
}) {
  const { secret, headerName = 'X-Signature', algorithm = 'sha256' } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const providedSignature = request.headers[headerName.toLowerCase()] as string;
    
    if (!providedSignature) {
      const errorResponse = createErrorResponse(
        'Request signature required',
        'SIGNATURE_MISSING',
        { headerName },
        401
      );
      return reply.status(401).send(errorResponse);
    }
    
    // Calculate expected signature
    const payload = JSON.stringify(request.body) || '';
    const expectedSignature = createHash(algorithm)
      .update(payload + secret)
      .digest('hex');
    
    if (providedSignature !== expectedSignature) {
      const errorResponse = createErrorResponse(
        'Invalid request signature',
        'SIGNATURE_INVALID',
        undefined,
        401
      );
      return reply.status(401).send(errorResponse);
    }
  };
}

/**
 * Generate CSRF token endpoint helper
 */
export function generateCSRFToken(sessionId: string): string {
  return CSRFProtection.generateToken(sessionId);
}

/**
 * Security statistics
 */
export function getSecurityStats() {
  return {
    csrf: CSRFProtection.getStats(),
    rateLimit: AdvancedRateLimit.getStats(),
    timestamp: new Date().toISOString()
  };
}

/**
 * Predefined security configurations
 */
export const SecurityConfigs = {
  // Strict security for admin endpoints
  admin: {
    rateLimit: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 requests per 15 minutes
    csrf: true,
    signature: env.NODE_ENV === 'production'
  },
  
  // Standard security for auth endpoints
  auth: {
    rateLimit: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes
    csrf: true,
    signature: false
  },
  
  // Relaxed security for public endpoints
  public: {
    rateLimit: { max: 100, windowMs: 15 * 60 * 1000 }, // 100 requests per 15 minutes
    csrf: false,
    signature: false
  }
};
