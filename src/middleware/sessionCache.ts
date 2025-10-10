import { RedisManager, RedisKeys } from '../config/redis';
import { env } from '../config/env';
import { prisma } from '../db';

/**
 * Redis-based session and user data caching for 10M+ users
 * Reduces database load by caching frequently accessed data
 */
export class SessionCache {
  /**
   * Cache user session data
   */
  static async cacheUserSession(userId: string, userData: any, ttlSeconds: number = 900): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.session(userId);
      
      const sessionData = {
        ...userData,
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
      };
      
      await redis.setex(key, ttlSeconds, JSON.stringify(sessionData));
    } catch (error) {
      console.error('Redis session cache error:', error);
    }
  }

  /**
   * Get cached user session data
   */
  static async getCachedUserSession(userId: string): Promise<any | null> {
    if (env.REDIS_DISABLED) return null;

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.session(userId);
      
      const cached = await redis.get(key);
      if (!cached) return null;
      
      return JSON.parse(cached);
    } catch (error) {
      console.error('Redis session get error:', error);
      return null;
    }
  }

  /**
   * Invalidate user session cache
   */
  static async invalidateUserSession(userId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.session(userId);
      await redis.del(key);
    } catch (error) {
      console.error('Redis session invalidate error:', error);
    }
  }

  /**
   * Cache user profile data
   */
  static async cacheUserProfile(userId: string, ttlSeconds: number = 300): Promise<any> {
    if (env.REDIS_DISABLED) {
      // Fallback to direct database query
      return await this.getUserFromDatabase(userId);
    }

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.userCache(userId);
      
      // Try to get from cache first
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      
      // Not in cache, fetch from database
      const user = await this.getUserFromDatabase(userId);
      if (user) {
        // Cache for 5 minutes
        await redis.setex(key, ttlSeconds, JSON.stringify({
          ...user,
          cachedAt: new Date().toISOString()
        }));
      }
      
      return user;
    } catch (error) {
      console.error('Redis user cache error:', error);
      // Fallback to database
      return await this.getUserFromDatabase(userId);
    }
  }

  /**
   * Cache college data (shared across users)
   */
  static async cacheCollegeData(collegeId: string, ttlSeconds: number = 3600): Promise<any> {
    if (env.REDIS_DISABLED) {
      return await this.getCollegeFromDatabase(collegeId);
    }

    try {
      const redis = RedisManager.getInstance();
      const key = RedisKeys.collegeCache(collegeId);
      
      // Try cache first
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      
      // Fetch from database
      const college = await this.getCollegeFromDatabase(collegeId);
      if (college) {
        // Cache for 1 hour
        await redis.setex(key, ttlSeconds, JSON.stringify({
          ...college,
          cachedAt: new Date().toISOString()
        }));
      }
      
      return college;
    } catch (error) {
      console.error('Redis college cache error:', error);
      return await this.getCollegeFromDatabase(collegeId);
    }
  }

  /**
   * Batch cache multiple users (for performance)
   */
  static async batchCacheUsers(userIds: string[], ttlSeconds: number = 300): Promise<any[]> {
    if (env.REDIS_DISABLED) {
      return await this.batchGetUsersFromDatabase(userIds);
    }

    try {
      const redis = RedisManager.getInstance();
      
      // Get all cached users first
      const pipeline = redis.pipeline();
      const keys = userIds.map(id => RedisKeys.userCache(id));
      keys.forEach(key => pipeline.get(key));
      
      const results = await pipeline.exec();
      const cachedUsers: any[] = [];
      const uncachedIds: string[] = [];
      
      results?.forEach((result: any, index: number) => {
        if (result[1]) {
          cachedUsers[index] = JSON.parse(result[1]);
        } else {
          uncachedIds.push(userIds[index]);
          cachedUsers[index] = null;
        }
      });
      
      // Fetch uncached users from database
      if (uncachedIds.length > 0) {
        const freshUsers = await this.batchGetUsersFromDatabase(uncachedIds);
        
        // Cache the fresh users
        const cachePipeline = redis.pipeline();
        freshUsers.forEach(user => {
          if (user) {
            const key = RedisKeys.userCache(user.id);
            cachePipeline.setex(key, ttlSeconds, JSON.stringify({
              ...user,
              cachedAt: new Date().toISOString()
            }));
          }
        });
        await cachePipeline.exec();
        
        // Merge cached and fresh data
        let freshIndex = 0;
        cachedUsers.forEach((cached, index) => {
          if (cached === null) {
            cachedUsers[index] = freshUsers[freshIndex++];
          }
        });
      }
      
      return cachedUsers;
    } catch (error) {
      console.error('Redis batch cache error:', error);
      return await this.batchGetUsersFromDatabase(userIds);
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{
    userSessions: number;
    userProfiles: number;
    collegeData: number;
    totalCached: number;
  }> {
    if (env.REDIS_DISABLED) {
      return { userSessions: 0, userProfiles: 0, collegeData: 0, totalCached: 0 };
    }

    try {
      const redis = RedisManager.getInstance();
      
      const [sessionKeys, userKeys, collegeKeys] = await Promise.all([
        redis.keys('auth:session:*'),
        redis.keys('auth:user:*'),
        redis.keys('auth:college:*')
      ]);
      
      return {
        userSessions: sessionKeys.length,
        userProfiles: userKeys.length,
        collegeData: collegeKeys.length,
        totalCached: sessionKeys.length + userKeys.length + collegeKeys.length
      };
    } catch (error) {
      console.error('Redis cache stats error:', error);
      return { userSessions: 0, userProfiles: 0, collegeData: 0, totalCached: 0 };
    }
  }

  /**
   * Clear all cache for a user (useful for profile updates)
   */
  static async clearUserCache(userId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      
      const keys = [
        RedisKeys.session(userId),
        RedisKeys.userCache(userId)
      ];
      
      await redis.del(...keys);
    } catch (error) {
      console.error('Redis clear user cache error:', error);
    }
  }

  /**
   * Database fallback methods
   */
  private static async getUserFromDatabase(userId: string): Promise<any> {
    try {
      return await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          collegeMemberId: true,
          department: true,
          year: true,
          collegeId: true,
          roles: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (error) {
      console.error('Database user fetch error:', error);
      return null;
    }
  }

  private static async batchGetUsersFromDatabase(userIds: string[]): Promise<any[]> {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
          displayName: true,
          collegeMemberId: true,
          department: true,
          year: true,
          collegeId: true,
          roles: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });
      
      // Maintain order matching input userIds
      return userIds.map(id => users.find(user => user.id === id) || null);
    } catch (error) {
      console.error('Database batch user fetch error:', error);
      return userIds.map(() => null);
    }
  }

  private static async getCollegeFromDatabase(collegeId: string): Promise<any> {
    try {
      return await prisma.college.findUnique({
        where: { id: collegeId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (error) {
      console.error('Database college fetch error:', error);
      return null;
    }
  }
}
