import { redis } from '../config/redis.js';
import { Logger } from '../utils/logger.js';

/**
 * Cache Service for query result caching
 * Provides centralized cache management with TTL and invalidation
 */
export class CacheService {
  // Cache TTLs in seconds
  private static readonly CACHE_TTLS = {
    USER_LIST: 300,           // 5 minutes
    USER_DETAIL: 600,         // 10 minutes
    COLLEGE_DATA: 900,        // 15 minutes
    ANALYTICS: 600,           // 10 minutes
    AUDIT_LOGS: 300,          // 5 minutes
    DEPARTMENT_DATA: 900      // 15 minutes
  };

  /**
   * Get cached data
   */
  static async get<T>(key: string): Promise<T | null> {
    if (!redis) return null;
    
    try {
      const cached = await redis.get(key);
      if (cached) {
        Logger.debug(`[CACHE] Hit for key: ${key}`);
        return JSON.parse(cached) as T;
      }
      Logger.debug(`[CACHE] Miss for key: ${key}`);
      return null;
    } catch (error) {
      Logger.error('[CACHE] Error getting cached data:', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Set cached data with TTL
   */
  static async set<T>(key: string, data: T, ttlSeconds?: number): Promise<void> {
    if (!redis) return;
    
    try {
      const ttl = ttlSeconds || 300; // Default 5 minutes
      await redis.setex(key, ttl, JSON.stringify(data));
      Logger.debug(`[CACHE] Set key: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      Logger.error('[CACHE] Error setting cached data:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Delete cached data
   */
  static async delete(key: string): Promise<void> {
    if (!redis) return;
    
    try {
      await redis.del(key);
      Logger.debug(`[CACHE] Deleted key: ${key}`);
    } catch (error) {
      Logger.error('[CACHE] Error deleting cached data:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Delete multiple cached keys by pattern
   */
  static async deletePattern(pattern: string): Promise<void> {
    if (!redis) return;
    
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        Logger.debug(`[CACHE] Deleted ${keys.length} keys matching pattern: ${pattern}`);
      }
    } catch (error) {
      Logger.error('[CACHE] Error deleting pattern:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Generate cache key for user list
   */
  static generateUserListKey(collegeId: string, page: number, limit: number, filters?: any): string {
    const filterStr = filters ? JSON.stringify(filters).replace(/"/g, '').replace(/:/g, '-').replace(/,/g, '_') : 'none';
    return `users:list:${collegeId}:p${page}:l${limit}:${filterStr}`;
  }

  /**
   * Generate cache key for user detail
   */
  static generateUserDetailKey(userId: string): string {
    return `user:detail:${userId}`;
  }

  /**
   * Generate cache key for college data
   */
  static generateCollegeKey(collegeId: string): string {
    return `college:${collegeId}`;
  }

  /**
   * Generate cache key for analytics
   */
  static generateAnalyticsKey(collegeId: string, type: string, department?: string): string {
    return `analytics:${collegeId}:${type}${department ? ':' + department : ''}`;
  }

  /**
   * Generate cache key for audit logs
   */
  static generateAuditLogsKey(collegeId: string, page: number, limit: number): string {
    return `audit:${collegeId}:p${page}:l${limit}`;
  }

  /**
   * Invalidate all user-related caches for a college
   */
  static async invalidateUserCaches(collegeId: string): Promise<void> {
    const patterns = [
      `users:list:${collegeId}:*`,
      `user:detail:*`,
      `analytics:${collegeId}:*`,
      `audit:${collegeId}:*`
    ];

    for (const pattern of patterns) {
      await this.deletePattern(pattern);
    }
  }

  /**
   * Invalidate college caches
   */
  static async invalidateCollegeCaches(collegeId: string): Promise<void> {
    const patterns = [
      `college:${collegeId}`,
      `analytics:${collegeId}:*`,
      `users:list:${collegeId}:*`
    ];

    for (const pattern of patterns) {
      await this.deletePattern(pattern);
    }
  }

  /**
   * Get cache TTL for a data type
   */
  static getTTL(type: keyof typeof CacheService.CACHE_TTLS): number {
    return this.CACHE_TTLS[type] || 300;
  }

  /**
   * Clear all caches (use with caution)
   */
  static async clearAll(): Promise<void> {
    if (!redis) return;
    
    try {
      await redis.flushdb();
      Logger.warn('[CACHE] Cleared all caches');
    } catch (error) {
      Logger.error('[CACHE] Error clearing all caches:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get cache statistics
   */
  static async getStats(): Promise<{ keys: number; memory: string } | null> {
    if (!redis) return null;
    
    try {
      const info = await redis.info('memory');
      const keys = await redis.dbsize();
      return {
        keys,
        memory: info || 'unknown'
      };
    } catch (error) {
      Logger.error('[CACHE] Error getting cache stats:', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }
}
