import { FastifyRequest, FastifyReply } from 'fastify';
import { RedisManager, RedisKeys } from '../config/redis';
import { env } from '../config/env';

/**
 * Distributed rate limiting using Redis for 10M+ users
 * Uses sliding window algorithm with Redis sorted sets
 */
export class DistributedRateLimit {
  /**
   * Check rate limit using Redis sliding window
   */
  static async checkLimit(
    identifier: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    if (env.REDIS_DISABLED) {
      // Fallback to memory-based limiting
      return this.memoryFallback(identifier, windowMs, maxRequests);
    }

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.rateLimit(identifier);
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline();
      
      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      
      // Count requests in window
      pipeline.zcard(key);
      
      // Set expiry for cleanup
      pipeline.expire(key, Math.ceil(windowMs / 1000));
      
      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Redis pipeline failed');
      }

      const requestCount = results[2][1] as number;
      const remaining = Math.max(0, maxRequests - requestCount);
      const resetTime = now + windowMs;

      return {
        allowed: requestCount <= maxRequests,
        remaining,
        resetTime
      };
    } catch (error) {
      console.error('Redis rate limit error:', error);
      // Fallback to memory-based limiting
      return this.memoryFallback(identifier, windowMs, maxRequests);
    }
  }

  /**
   * Memory-based fallback when Redis is unavailable
   */
  private static memoryStore = new Map<string, { count: number; resetTime: number }>();

  private static memoryFallback(
    identifier: string,
    windowMs: number,
    maxRequests: number
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const existing = this.memoryStore.get(identifier);

    if (!existing || now > existing.resetTime) {
      // New window
      const resetTime = now + windowMs;
      this.memoryStore.set(identifier, { count: 1, resetTime });
      
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime
      };
    }

    // Increment count
    existing.count++;
    this.memoryStore.set(identifier, existing);

    return {
      allowed: existing.count <= maxRequests,
      remaining: Math.max(0, maxRequests - existing.count),
      resetTime: existing.resetTime
    };
  }

  /**
   * Block IP address in Redis
   */
  static async blockIP(ip: string, durationMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = `blocked:${ip}`;
      await redis.setex(key, Math.ceil(durationMs / 1000), 'blocked');
    } catch (error) {
      console.error('Redis block IP error:', error);
    }
  }

  /**
   * Check if IP is blocked
   */
  static async isBlocked(ip: string): Promise<boolean> {
    if (env.REDIS_DISABLED) return false;

    try {
      const redis = RedisManager.getInstance();
      const key = `blocked:${ip}`;
      const result = await redis.get(key);
      return result === 'blocked';
    } catch (error) {
      console.error('Redis check blocked error:', error);
      return false;
    }
  }

  /**
   * Unblock IP address
   */
  static async unblockIP(ip: string): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = `blocked:${ip}`;
      await redis.del(key);
    } catch (error) {
      console.error('Redis unblock IP error:', error);
    }
  }

  /**
   * Get rate limiting statistics
   */
  static async getStats(): Promise<{
    totalKeys: number;
    blockedIPs: number;
    activeWindows: number;
  }> {
    if (env.REDIS_DISABLED) {
      return {
        totalKeys: this.memoryStore.size,
        blockedIPs: 0,
        activeWindows: this.memoryStore.size
      };
    }

    try {
      const redis = RedisManager.getInstance();
      
      // Count rate limit keys
      const rateLimitKeys = await redis.keys('auth:rate:*');
      const blockedKeys = await redis.keys('auth:blocked:*');
      
      return {
        totalKeys: rateLimitKeys.length + blockedKeys.length,
        blockedIPs: blockedKeys.length,
        activeWindows: rateLimitKeys.length
      };
    } catch (error) {
      console.error('Redis stats error:', error);
      return { totalKeys: 0, blockedIPs: 0, activeWindows: 0 };
    }
  }
}

/**
 * Enhanced rate limiters using Redis
 */
export const DistributedRateLimiters = {
  // Strict rate limiting for authentication endpoints
  auth: async (request: FastifyRequest, reply: FastifyReply) => {
    const identifier = `auth:${request.ip}`;
    const result = await DistributedRateLimit.checkLimit(identifier, 15 * 60 * 1000, 5);
    
    if (!result.allowed) {
      return reply.status(429).send({
        success: false,
        message: 'Too many authentication attempts. Please try again in 15 minutes.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', '5');
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', result.resetTime.toString());
  },

  // Very strict rate limiting for security operations
  security: async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const identifier = `security:${user?.id || request.ip}`;
    const result = await DistributedRateLimit.checkLimit(identifier, 60 * 60 * 1000, 5);
    
    if (!result.allowed) {
      return reply.status(429).send({
        success: false,
        message: 'Too many security operations. Please try again in 1 hour.',
        code: 'SECURITY_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    reply.header('X-RateLimit-Limit', '5');
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', result.resetTime.toString());
  },

  // Rate limiting for admin operations
  admin: async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const identifier = `admin:${user?.id || request.ip}`;
    const result = await DistributedRateLimit.checkLimit(identifier, 60 * 60 * 1000, 10);
    
    if (!result.allowed) {
      return reply.status(429).send({
        success: false,
        message: 'Too many admin operations. Please try again in 1 hour.',
        code: 'ADMIN_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    reply.header('X-RateLimit-Limit', '10');
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', result.resetTime.toString());
  },

  // Rate limiting for internal API access
  internal: async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string;
    const identifier = `internal:${apiKey ? apiKey.slice(-8) : request.ip}`;
    const result = await DistributedRateLimit.checkLimit(identifier, 60 * 60 * 1000, 1000);
    
    if (!result.allowed) {
      return reply.status(429).send({
        success: false,
        message: 'Internal API rate limit exceeded. Please try again later.',
        code: 'INTERNAL_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    reply.header('X-RateLimit-Limit', '1000');
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', result.resetTime.toString());
  },

  // General API rate limiting
  general: async (request: FastifyRequest, reply: FastifyReply) => {
    const identifier = `general:${request.ip}`;
    const result = await DistributedRateLimit.checkLimit(identifier, 15 * 60 * 1000, 100);
    
    if (!result.allowed) {
      return reply.status(429).send({
        success: false,
        message: 'Too many requests. Please try again later.',
        code: 'GENERAL_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    reply.header('X-RateLimit-Limit', '100');
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', result.resetTime.toString());
  }
};
