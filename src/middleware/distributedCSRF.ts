import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { RedisManager, RedisKeys } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * Distributed CSRF Protection using Redis for 10M+ users
 * Uses HMAC-based tokens with Redis storage for persistence
 */
export class DistributedCSRFProtection {
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
    
    if (!env.REDIS_DISABLED) {
      try {
        const redis = RedisManager.getInstance();
        const key = RedisKeys.csrf(sessionId, token);
        
        // Store token in Redis with 30-minute expiry
        await redis.setex(key, 1800, JSON.stringify({
          sessionId,
          timestamp: parseInt(timestamp),
          used: false,
          createdAt: new Date().toISOString()
        }));
        
        // Also store by session for cleanup
        const sessionKey = `csrf:session:${sessionId}`;
        await redis.sadd(sessionKey, token);
        await redis.expire(sessionKey, 1800);
        
      } catch (error) {
        console.error('Redis CSRF generation error:', error);
        // Continue without Redis storage - token is still valid via HMAC
      }
    }
    
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
    
    // Check Redis for one-time use enforcement
    if (!env.REDIS_DISABLED) {
      try {
        const redis = RedisManager.getInstance();
        const key = RedisKeys.csrf(sessionId, providedToken);
        
        // Get token data
        const tokenData = await redis.get(key);
        if (!tokenData) {
          // Token not found in Redis, but HMAC is valid
          // This could be a replay attack or Redis failure
          // For security, reject if Redis is expected to be available
          return false;
        }
        
        const data = JSON.parse(tokenData);
        if (data.used) {
          return false; // Token already used
        }
        
        // Mark as used and delete
        await redis.del(key);
        
        // Remove from session set
        const sessionKey = `csrf:session:${sessionId}`;
        await redis.srem(sessionKey, providedToken);
        
        return true;
      } catch (error) {
        console.error('Redis CSRF verification error:', error);
        // If Redis fails, fall back to HMAC-only verification
        // This is less secure but maintains availability
        return true;
      }
    }
    
    // Redis disabled - rely on HMAC verification only
    return true;
  }
  
  /**
   * Clean up expired tokens for a session
   */
  static async cleanupSession(sessionId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;
    
    try {
      const redis = RedisManager.getInstance();
      const sessionKey = `csrf:session:${sessionId}`;
      
      // Get all tokens for this session
      const tokens = await redis.smembers(sessionKey);
      
      // Check each token and remove expired ones
      const pipeline = redis.pipeline();
      for (const token of tokens) {
        const key = RedisKeys.csrf(sessionId, token);
        pipeline.get(key);
      }
      
      const results = await pipeline.exec();
      
      if (results) {
        const expiredTokens: string[] = [];
        
        results.forEach((result: any, index: number) => {
          if (result[1] === null) {
            // Token expired or doesn't exist
            expiredTokens.push(tokens[index]);
          }
        });
        
        // Remove expired tokens from session set
        if (expiredTokens.length > 0) {
          await redis.srem(sessionKey, ...expiredTokens);
        }
      }
    } catch (error) {
      console.error('Redis CSRF cleanup error:', error);
    }
  }
  
  /**
   * Get CSRF statistics
   */
  static async getStats(): Promise<{
    totalTokens: number;
    activeSessions: number;
    expiredTokens: number;
  }> {
    if (env.REDIS_DISABLED) {
      return { totalTokens: 0, activeSessions: 0, expiredTokens: 0 };
    }
    
    try {
      const redis = RedisManager.getInstance();
      
      // Count CSRF tokens
      const csrfKeys = await redis.keys('auth:csrf:*');
      const sessionKeys = await redis.keys('auth:csrf:session:*');
      
      // Count expired tokens (keys that exist in session sets but not as individual keys)
      let expiredCount = 0;
      for (const sessionKey of sessionKeys) {
        const tokens = await redis.smembers(sessionKey);
        for (const token of tokens) {
          const parts = token.split(':');
          if (parts.length === 4) {
            const [sessionId] = parts;
            const key = RedisKeys.csrf(sessionId, token);
            const exists = await redis.exists(key);
            if (!exists) expiredCount++;
          }
        }
      }
      
      return {
        totalTokens: csrfKeys.length,
        activeSessions: sessionKeys.length,
        expiredTokens: expiredCount
      };
    } catch (error) {
      console.error('Redis CSRF stats error:', error);
      return { totalTokens: 0, activeSessions: 0, expiredTokens: 0 };
    }
  }
  
  /**
   * Revoke all CSRF tokens for a session (useful for logout)
   */
  static async revokeSessionTokens(sessionId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;
    
    try {
      const redis = RedisManager.getInstance();
      const sessionKey = `csrf:session:${sessionId}`;
      
      // Get all tokens for this session
      const tokens = await redis.smembers(sessionKey);
      
      // Delete all token keys
      const pipeline = redis.pipeline();
      for (const token of tokens) {
        const key = RedisKeys.csrf(sessionId, token);
        pipeline.del(key);
      }
      
      // Delete session key
      pipeline.del(sessionKey);
      
      await pipeline.exec();
    } catch (error) {
      console.error('Redis CSRF revoke error:', error);
    }
  }
}

/**
 * Enhanced CSRF token generation function
 */
export async function generateCSRFToken(sessionId: string): Promise<string> {
  return await DistributedCSRFProtection.generateToken(sessionId);
}

/**
 * Enhanced CSRF token verification function
 */
export async function verifyCSRFToken(sessionId: string, token: string): Promise<boolean> {
  return await DistributedCSRFProtection.verifyToken(sessionId, token);
}

/**
 * CSRF middleware for protecting routes
 */
export async function csrfProtection(request: any, reply: any): Promise<void> {
  const token = request.headers['x-csrf-token'] || request.body?.csrfToken;
  const sessionId = request.user?.id || request.ip;
  
  if (!token) {
    return reply.status(403).send({
      success: false,
      message: 'CSRF token required',
      code: 'CSRF_TOKEN_MISSING'
    });
  }
  
  const isValid = await verifyCSRFToken(sessionId, token);
  
  if (!isValid) {
    return reply.status(403).send({
      success: false,
      message: 'Invalid CSRF token',
      code: 'CSRF_TOKEN_INVALID'
    });
  }
}
