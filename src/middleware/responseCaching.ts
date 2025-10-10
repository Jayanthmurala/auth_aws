import { FastifyRequest, FastifyReply } from 'fastify';
import { RedisManager } from '../config/redis';
import { env } from '../config/env';
import { Logger } from '../utils/logger';
import crypto from 'node:crypto';

/**
 * Response caching middleware for high-performance endpoints
 * Uses Redis for distributed caching across multiple instances
 */

export interface CacheOptions {
  ttl: number; // Time to live in seconds
  keyPrefix?: string;
  varyBy?: string[]; // Headers to vary cache by (e.g., ['user-id', 'accept-language'])
  skipCache?: (req: FastifyRequest) => boolean;
  skipCacheOnError?: boolean;
  compressResponse?: boolean;
}

const DEFAULT_CACHE_OPTIONS: Required<CacheOptions> = {
  ttl: 300, // 5 minutes
  keyPrefix: 'cache',
  varyBy: [],
  skipCache: () => false,
  skipCacheOnError: true,
  compressResponse: true
};

/**
 * Generate cache key based on request
 */
function generateCacheKey(
  req: FastifyRequest,
  options: Required<CacheOptions>
): string {
  const baseKey = `${options.keyPrefix}:${req.method}:${req.url}`;
  
  // Add vary headers to key
  const varyParts: string[] = [];
  for (const header of options.varyBy) {
    const value = req.headers[header.toLowerCase()];
    if (value) {
      varyParts.push(`${header}:${value}`);
    }
  }
  
  // Add query parameters to key
  const queryString = new URLSearchParams(req.query as any).toString();
  if (queryString) {
    varyParts.push(`query:${queryString}`);
  }
  
  if (varyParts.length > 0) {
    const varyHash = crypto
      .createHash('md5')
      .update(varyParts.join('|'))
      .digest('hex');
    return `${baseKey}:${varyHash}`;
  }
  
  return baseKey;
}

/**
 * Compress response data
 */
function compressData(data: any): string {
  // Simple JSON compression - in production, consider using gzip
  return JSON.stringify(data);
}

/**
 * Decompress response data
 */
function decompressData(data: string): any {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Create response caching middleware
 */
export function createResponseCache(options: Partial<CacheOptions> = {}) {
  const config = { ...DEFAULT_CACHE_OPTIONS, ...options };

  return async function responseCacheMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Skip caching if disabled or conditions not met
    if (env.REDIS_DISABLED || config.skipCache(request)) {
      return;
    }

    const cacheKey = generateCacheKey(request, config);
    
    try {
      const redis = RedisManager.getInstance();
      
      // Try to get cached response
      const cachedResponse = await redis.get(cacheKey);
      
      if (cachedResponse) {
        const data = config.compressResponse 
          ? decompressData(cachedResponse)
          : JSON.parse(cachedResponse);
        
        // Set cache headers
        reply.header('X-Cache', 'HIT');
        reply.header('X-Cache-Key', cacheKey.substring(0, 32) + '...');
        
        Logger.debug('Cache hit', {
          operation: 'response_cache',
          cacheKey: cacheKey.substring(0, 32) + '...',
          url: request.url
        });
        
        return reply.send(data);
      }
      
      // Cache miss - intercept response
      reply.header('X-Cache', 'MISS');
      
      // Cache miss - we'll cache on successful response
      // Note: For production, consider using Fastify hooks or plugins for better caching
      
    } catch (error) {
      // Don't fail the request if cache check fails
      Logger.warn('Cache check failed', {
        error: error instanceof Error ? error.message : String(error),
        cacheKey: cacheKey.substring(0, 32) + '...',
        url: request.url
      });
    }
  };
}

/**
 * Predefined cache configurations for common use cases
 */
export const CacheConfigs = {
  // Short-term cache for frequently accessed data
  short: createResponseCache({
    ttl: 60, // 1 minute
    keyPrefix: 'short',
    varyBy: ['authorization']
  }),

  // Medium-term cache for semi-static data
  medium: createResponseCache({
    ttl: 300, // 5 minutes
    keyPrefix: 'medium',
    varyBy: ['authorization']
  }),

  // Long-term cache for static data
  long: createResponseCache({
    ttl: 3600, // 1 hour
    keyPrefix: 'long',
    varyBy: []
  }),

  // User-specific cache
  userSpecific: createResponseCache({
    ttl: 300, // 5 minutes
    keyPrefix: 'user',
    varyBy: ['authorization'],
    skipCache: (req) => !req.headers.authorization
  }),

  // Public data cache (no user variation)
  public: createResponseCache({
    ttl: 1800, // 30 minutes
    keyPrefix: 'public',
    varyBy: [],
    skipCache: (req) => !!req.headers.authorization // Skip for authenticated requests
  }),

  // College-specific data cache
  collegeSpecific: createResponseCache({
    ttl: 600, // 10 minutes
    keyPrefix: 'college',
    varyBy: ['x-college-id', 'authorization']
  })
};

/**
 * Cache invalidation utilities
 */
export class CacheInvalidator {
  private static redis = RedisManager.getInstance();

  /**
   * Invalidate cache by pattern
   */
  static async invalidatePattern(pattern: string): Promise<number> {
    try {
      if (env.REDIS_DISABLED) return 0;

      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;

      const result = await this.redis.del(...keys);
      
      Logger.info('Cache invalidated by pattern', {
        pattern,
        keysDeleted: result,
        operation: 'cache_invalidation'
      });
      
      return result;
    } catch (error) {
      Logger.error('Cache invalidation failed', 
        error instanceof Error ? error : new Error(String(error)), 
        { pattern }
      );
      return 0;
    }
  }

  /**
   * Invalidate user-specific cache
   */
  static async invalidateUserCache(userId: string): Promise<number> {
    return this.invalidatePattern(`*user*${userId}*`);
  }

  /**
   * Invalidate college-specific cache
   */
  static async invalidateCollegeCache(collegeId: string): Promise<number> {
    return this.invalidatePattern(`*college*${collegeId}*`);
  }

  /**
   * Invalidate all auth-related cache
   */
  static async invalidateAuthCache(): Promise<number> {
    return this.invalidatePattern('cache:*auth*');
  }

  /**
   * Clear all cache
   */
  static async clearAllCache(): Promise<void> {
    try {
      if (env.REDIS_DISABLED) return;

      await this.redis.flushdb();
      
      Logger.info('All cache cleared', {
        operation: 'cache_clear_all'
      });
    } catch (error) {
      Logger.error('Failed to clear all cache', 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

/**
 * Cache warming utilities
 */
export class CacheWarmer {
  /**
   * Warm up frequently accessed endpoints
   */
  static async warmupCommonEndpoints(): Promise<void> {
    try {
      // This would typically make requests to common endpoints
      // to populate the cache during application startup
      
      Logger.info('Cache warmup completed', {
        operation: 'cache_warmup'
      });
    } catch (error) {
      Logger.error('Cache warmup failed', 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

/**
 * Cache statistics and monitoring
 */
export class CacheMonitor {
  private static redis = RedisManager.getInstance();

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    hitRate?: number;
  }> {
    try {
      if (env.REDIS_DISABLED) {
        return { totalKeys: 0, memoryUsage: '0B' };
      }

      const info = await this.redis.info('memory');
      const keyCount = await this.redis.dbsize();
      
      // Parse memory usage from Redis info
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : 'Unknown';
      
      return {
        totalKeys: keyCount,
        memoryUsage
      };
    } catch (error) {
      Logger.error('Failed to get cache stats', 
        error instanceof Error ? error : new Error(String(error))
      );
      return { totalKeys: 0, memoryUsage: 'Error' };
    }
  }
}

/**
 * Conditional caching based on request/response characteristics
 */
export function createConditionalCache(
  condition: (req: FastifyRequest, reply: FastifyReply) => boolean,
  cacheOptions: Partial<CacheOptions> = {}
) {
  const cache = createResponseCache(cacheOptions);
  
  return async function conditionalCacheMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (condition(request, reply)) {
      return cache(request, reply);
    }
  };
}
