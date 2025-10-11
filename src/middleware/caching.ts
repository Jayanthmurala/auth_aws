import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * In-memory cache implementation
 * In production, this should be replaced with Redis
 */
class MemoryCache {
  private static instance: MemoryCache;
  private cache = new Map<string, { value: any; expiry: number; hits: number }>();
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
  };

  static getInstance(): MemoryCache {
    if (!MemoryCache.instance) {
      MemoryCache.instance = new MemoryCache();
    }
    return MemoryCache.instance;
  }

  /**
   * Set a value in cache with TTL
   */
  set(key: string, value: any, ttlSeconds: number = 300): void {
    const expiry = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { value, expiry, hits: 0 });
    this.stats.sets++;
    
    // Clean up expired entries periodically
    this.cleanup();
  }

  /**
   * Get a value from cache
   */
  get(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    entry.hits++;
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Delete a value from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    return {
      ...this.stats,
      totalRequests,
      hitRate: Math.round(hitRate * 100) / 100,
      size: this.cache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (env.NODE_ENV === 'development' && cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Estimate memory usage
   */
  private getMemoryUsage(): number {
    let size = 0;
    for (const [key, entry] of this.cache.entries()) {
      size += key.length * 2; // Approximate string size
      size += JSON.stringify(entry.value).length * 2; // Approximate object size
      size += 24; // Overhead for entry object
    }
    return Math.round(size / 1024); // Return in KB
  }
}

/**
 * Cache configuration options
 */
export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyGenerator?: (request: FastifyRequest) => string;
  condition?: (request: FastifyRequest, reply: FastifyReply) => boolean;
  vary?: string[]; // Headers to vary cache by
}

/**
 * Default cache key generator
 */
function defaultKeyGenerator(request: FastifyRequest): string {
  const url = request.url;
  const method = request.method;
  const userId = (request as any).user?.id || 'anonymous';
  
  // Include query parameters in cache key
  const queryString = new URLSearchParams(request.query as any).toString();
  const key = `${method}:${url}${queryString ? '?' + queryString : ''}:${userId}`;
  
  return key;
}

/**
 * Cache middleware factory
 */
export function cacheMiddleware(options: CacheOptions = {}) {
  const {
    ttl = 300, // 5 minutes default
    keyGenerator = defaultKeyGenerator,
    condition = () => true,
    vary = []
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Only cache GET requests by default
    if (request.method !== 'GET') {
      return;
    }

    // Check if caching condition is met
    if (!condition(request, reply)) {
      return;
    }

    const cache = MemoryCache.getInstance();
    const cacheKey = keyGenerator(request);

    // Try to get from cache
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) {
      // Set cache headers
      reply.header('X-Cache', 'HIT');
      reply.header('X-Cache-Key', cacheKey);
      
      // Set vary headers
      if (vary.length > 0) {
        reply.header('Vary', vary.join(', '));
      }
      
      // Send cached response
      reply.status(cachedResponse.statusCode || 200);
      return reply.send(cachedResponse.body);
    }

    // Cache miss - intercept response to cache it
    reply.header('X-Cache', 'MISS');
    reply.header('X-Cache-Key', cacheKey);

    // Hook into response to cache the result
    const originalSend = reply.send.bind(reply);
    reply.send = function(payload: any) {
      // Only cache successful responses
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        const responseToCache = {
          body: payload,
          statusCode: reply.statusCode,
          headers: reply.getHeaders()
        };
        
        cache.set(cacheKey, responseToCache, ttl);
      }
      
      return originalSend(payload);
    };
  };
}

/**
 * Cache invalidation middleware
 */
export function cacheInvalidationMiddleware(patterns: string[] = []) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Only invalidate on write operations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const cache = MemoryCache.getInstance();
      
      // If no patterns specified, clear all cache
      if (patterns.length === 0) {
        cache.clear();
        if (env.NODE_ENV === 'development') {
          console.log('[Cache] Cleared all cache due to write operation');
        }
        return;
      }
      
      // Clear cache entries matching patterns
      let cleared = 0;
      for (const [key] of cache['cache'].entries()) {
        for (const pattern of patterns) {
          if (key.includes(pattern)) {
            cache.delete(key);
            cleared++;
            break;
          }
        }
      }
      
      if (env.NODE_ENV === 'development' && cleared > 0) {
        console.log(`[Cache] Cleared ${cleared} cache entries matching patterns:`, patterns);
      }
    }
  };
}

/**
 * Cache statistics endpoint data
 */
export function getCacheStats() {
  const cache = MemoryCache.getInstance();
  return cache.getStats();
}

/**
 * Predefined cache configurations
 */
export const CacheConfigs = {
  /**
   * Cache for static data that rarely changes
   */
  static: {
    ttl: 3600, // 1 hour
    condition: (request: FastifyRequest) => {
      return request.url.includes('/colleges') || 
             request.url.includes('/version') ||
             request.url.includes('/.well-known/');
    }
  },

  /**
   * Cache for user-specific data
   */
  userSpecific: {
    ttl: 300, // 5 minutes
    keyGenerator: (request: FastifyRequest) => {
      const userId = (request as any).user?.id || 'anonymous';
      return `user:${userId}:${request.method}:${request.url}`;
    },
    condition: (request: FastifyRequest) => {
      return !!(request as any).user?.id;
    }
  },

  /**
   * Cache for public data
   */
  public: {
    ttl: 600, // 10 minutes
    keyGenerator: (request: FastifyRequest) => {
      return `public:${request.method}:${request.url}`;
    },
    condition: (request: FastifyRequest) => {
      return !(request as any).user; // Only for unauthenticated requests
    }
  },

  /**
   * Short-term cache for frequently accessed data
   */
  shortTerm: {
    ttl: 60, // 1 minute
    condition: (request: FastifyRequest) => {
      return request.url.includes('/health') || 
             request.url.includes('/metrics');
    }
  }
};

/**
 * Cache warming utility
 */
export class CacheWarmer {
  private static cache = MemoryCache.getInstance();

  /**
   * Warm cache with frequently accessed data
   */
  static async warmCache() {
    if (env.NODE_ENV === 'development') {
      console.log('[Cache] Starting cache warming...');
    }

    try {
      // Pre-cache health status
      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cached: true
      };
      this.cache.set('health:basic', healthData, 60);

      // Pre-cache version info
      const versionData = {
        version: '0.1.0',
        name: '@nexus/auth-service',
        environment: env.NODE_ENV
      };
      this.cache.set('version:info', versionData, 3600);

      if (env.NODE_ENV === 'development') {
        console.log('[Cache] Cache warming completed');
      }
    } catch (error) {
      console.error('[Cache] Cache warming failed:', error);
    }
  }
}

/**
 * Cache middleware for specific route patterns
 */
export const CacheMiddlewares = {
  colleges: cacheMiddleware(CacheConfigs.static),
  userProfile: cacheMiddleware(CacheConfigs.userSpecific),
  publicData: cacheMiddleware(CacheConfigs.public),
  health: cacheMiddleware(CacheConfigs.shortTerm)
};
