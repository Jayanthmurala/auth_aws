import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';
import { env } from './env';
import { Logger } from '../utils/logger';

/**
 * Redis configuration for 10M+ user scale with clustering support
 */
export class RedisManager {
  private static instance: Redis | null = null;
  private static clusterInstance: Cluster | null = null;
  private static isClusterMode: boolean = false;

  /**
   * Get Redis instance (single node or cluster)
   */
  static getInstance(): Redis | Cluster {
    if (env.REDIS_DISABLED) {
      throw new Error('Redis is disabled but required for this operation');
    }

    // For production scale, use cluster
    if (env.NODE_ENV === 'production' && env.REDIS_CLUSTER_NODES) {
      return this.getClusterInstance();
    }

    // For development/staging, use single instance
    return this.getSingleInstance();
  }

  /**
   * Single Redis instance (development/staging)
   */
  private static getSingleInstance(): Redis {
    if (!this.instance) {
      const options: RedisOptions = {
        // Connection settings for high load
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        
        // Connection pool for performance
        lazyConnect: true,
        keepAlive: 30000,
        
        // Key prefix for service isolation
        keyPrefix: 'auth:'
      };

      this.instance = new Redis(env.REDIS_URL, options);
      
      // Event handlers
      this.instance.on('ready', () => Logger.info('Redis connected', { service: 'redis' }));
      this.instance.on('error', (error: Error) => Logger.error('Redis error', error, { service: 'redis' }));
    }
    return this.instance;
  }

  /**
   * Redis Cluster instance (production scale)
   */
  private static getClusterInstance(): Cluster {
    if (!this.clusterInstance) {
      const nodes = env.REDIS_CLUSTER_NODES?.split(',').map(node => {
        const [host, port] = node.split(':');
        return { host, port: parseInt(port) };
      }) || [];

      const clusterOptions: ClusterOptions = {
        // Cluster settings for 10M+ users
        redisOptions: {
          password: env.REDIS_PASSWORD,
          connectTimeout: 10000,
          commandTimeout: 5000,
          keyPrefix: 'auth:',
          maxRetriesPerRequest: 3,
          lazyConnect: true
        },
        
        // Scaling configuration
        enableOfflineQueue: false,
        
        // Performance settings
        scaleReads: 'slave',
        
        // High availability
        slotsRefreshTimeout: 10000,
        slotsRefreshInterval: 5000
      };

      this.clusterInstance = new Cluster(nodes, clusterOptions);
    }
    return this.clusterInstance;
  }

  /**
   * Health check for Redis
   */
  static async healthCheck(): Promise<{ connected: boolean; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      await redis.ping();
      
      return {
        connected: true,
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        connected: false,
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get Redis statistics for monitoring
   */
  static async getStats() {
    try {
      const redis = this.getInstance();
      const info = await redis.info('memory');
      const keyspace = await redis.info('keyspace');
      
      return {
        memory: this.parseRedisInfo(info),
        keyspace: this.parseRedisInfo(keyspace),
        connected: true
      };
    } catch (error) {
      return {
        memory: {},
        keyspace: {},
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Parse Redis INFO command output
   */
  private static parseRedisInfo(info: string): Record<string, any> {
    const result: Record<string, any> = {};
    
    info.split('\r\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key] = isNaN(Number(value)) ? value : Number(value);
        }
      }
    });
    
    return result;
  }

  /**
   * Graceful shutdown
   */
  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.quit();
      this.instance = null;
    }
    
    if (this.clusterInstance) {
      await this.clusterInstance.quit();
      this.clusterInstance = null;
    }
  }
}

/**
 * Redis key management for service isolation
 */
export class RedisKeys {
  // Session management (high frequency)
  static session(userId: string): string {
    return `session:${userId}`;
  }

  // Rate limiting (very high frequency)
  static rateLimit(identifier: string): string {
    return `rate:${identifier}`;
  }

  // CSRF tokens (medium frequency)
  static csrf(sessionId: string, token: string): string {
    return `csrf:${sessionId}:${token}`;
  }

  // JWT blacklist (for logout)
  static jwtBlacklist(jti: string): string {
    return `blacklist:${jti}`;
  }

  // User cache (for performance)
  static userCache(userId: string): string {
    return `user:${userId}`;
  }

  // College cache (shared data)
  static collegeCache(collegeId: string): string {
    return `college:${collegeId}`;
  }

  // Security events (for monitoring)
  static securityEvent(eventId: string): string {
    return `security:${eventId}`;
  }
}

// Export singleton instance
export const redis = RedisManager.getInstance();
export default RedisManager;
