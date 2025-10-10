import { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { Logger } from './logger';
import { RedisManager } from '../config/redis';
import os from 'os';
import cluster from 'cluster';

/**
 * Scalability utilities for horizontal scaling and load balancing
 */

export interface InstanceInfo {
  instanceId: string;
  hostname: string;
  pid: number;
  startTime: Date;
  version: string;
  nodeVersion: string;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  uptime: number;
}

export interface LoadBalancingConfig {
  enableStickySessions: boolean;
  sessionAffinityKey: string;
  healthCheckInterval: number;
  maxConcurrentRequests: number;
}

/**
 * Instance registry for load balancer awareness
 */
export class InstanceRegistry {
  private static instanceId: string;
  private static startTime: Date = new Date();
  private static healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize instance registry
   */
  static async initialize(app: FastifyInstance): Promise<void> {
    this.instanceId = `${os.hostname()}-${process.pid}-${Date.now()}`;
    
    Logger.info('Initializing instance registry', {
      instanceId: this.instanceId,
      hostname: os.hostname(),
      pid: process.pid,
      nodeVersion: process.version
    });

    // Register this instance
    await this.registerInstance();

    // Start health check reporting
    this.startHealthReporting();

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.deregisterInstance());
    process.on('SIGINT', () => this.deregisterInstance());

    // Add load balancing headers to responses
    app.addHook('onSend', async (request, reply) => {
      reply.header('X-Instance-ID', this.instanceId);
      reply.header('X-Node-Version', process.version);
    });
  }

  /**
   * Register this instance in Redis
   */
  private static async registerInstance(): Promise<void> {
    try {
      if (env.REDIS_DISABLED) return;

      const redis = RedisManager.getInstance();
      const instanceInfo: InstanceInfo = {
        instanceId: this.instanceId,
        hostname: os.hostname(),
        pid: process.pid,
        startTime: this.startTime,
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime()
      };

      await redis.setex(
        `instance:${this.instanceId}`,
        60, // 1 minute TTL
        JSON.stringify(instanceInfo)
      );

      await redis.sadd('active_instances', this.instanceId);

      Logger.debug('Instance registered', { instanceId: this.instanceId });
    } catch (error) {
      Logger.error('Failed to register instance', 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Start periodic health reporting
   */
  private static startHealthReporting(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.registerInstance(); // Refresh registration
    }, 30000); // Every 30 seconds
  }

  /**
   * Deregister instance on shutdown
   */
  static async deregisterInstance(): Promise<void> {
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      if (env.REDIS_DISABLED) return;

      const redis = RedisManager.getInstance();
      await redis.del(`instance:${this.instanceId}`);
      await redis.srem('active_instances', this.instanceId);

      Logger.info('Instance deregistered', { instanceId: this.instanceId });
    } catch (error) {
      Logger.error('Failed to deregister instance', 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get all active instances
   */
  static async getActiveInstances(): Promise<InstanceInfo[]> {
    try {
      if (env.REDIS_DISABLED) return [];

      const redis = RedisManager.getInstance();
      const instanceIds = await redis.smembers('active_instances');
      
      const instances: InstanceInfo[] = [];
      for (const instanceId of instanceIds) {
        const data = await redis.get(`instance:${instanceId}`);
        if (data) {
          instances.push(JSON.parse(data));
        }
      }

      return instances;
    } catch (error) {
      Logger.error('Failed to get active instances', 
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  /**
   * Get current instance ID
   */
  static getInstanceId(): string {
    return this.instanceId;
  }
}

/**
 * Session affinity for sticky sessions
 */
export class SessionAffinity {
  /**
   * Generate session affinity key
   */
  static generateAffinityKey(userId: string): string {
    // Simple hash-based affinity
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString();
  }

  /**
   * Check if request should be handled by this instance
   */
  static shouldHandleRequest(userId: string, totalInstances: number): boolean {
    if (totalInstances <= 1) return true;

    const affinityKey = this.generateAffinityKey(userId);
    const targetInstance = parseInt(affinityKey) % totalInstances;
    const currentInstance = parseInt(InstanceRegistry.getInstanceId().split('-')[2]) % totalInstances;
    
    return targetInstance === currentInstance;
  }
}

/**
 * Load balancing middleware
 */
export function createLoadBalancingMiddleware(config: Partial<LoadBalancingConfig> = {}) {
  const {
    enableStickySessions = false,
    sessionAffinityKey = 'user-id',
    maxConcurrentRequests = 1000
  } = config;

  let currentRequests = 0;

  return async function loadBalancingMiddleware(request: any, reply: any): Promise<void> {
    // Check concurrent request limit
    if (currentRequests >= maxConcurrentRequests) {
      Logger.warn('Max concurrent requests reached', {
        currentRequests,
        maxConcurrentRequests,
        instanceId: InstanceRegistry.getInstanceId()
      });
      
      return reply.code(503).send({
        error: 'Service temporarily unavailable',
        message: 'Server is at capacity, please try again later'
      });
    }

    currentRequests++;

    // Add cleanup on request completion
    reply.addHook('onSend', async () => {
      currentRequests--;
    });

    // Handle sticky sessions if enabled
    if (enableStickySessions && request.user?.id) {
      const instances = await InstanceRegistry.getActiveInstances();
      if (!SessionAffinity.shouldHandleRequest(request.user.id, instances.length)) {
        // This request should be handled by a different instance
        // In a real load balancer setup, this would redirect
        Logger.debug('Request routed to different instance', {
          userId: request.user.id,
          currentInstance: InstanceRegistry.getInstanceId()
        });
      }
    }

    // Add load balancing headers
    reply.header('X-Current-Requests', currentRequests);
    reply.header('X-Max-Requests', maxConcurrentRequests);
  };
}

/**
 * Cluster management for multi-core scaling
 */
export class ClusterManager {
  /**
   * Start application in cluster mode
   */
  static startCluster(workers: number = os.cpus().length): void {
    if (cluster.isPrimary) {
      Logger.info(`Starting cluster with ${workers} workers`, {
        cpuCount: os.cpus().length,
        workers
      });

      // Fork workers
      for (let i = 0; i < workers; i++) {
        cluster.fork();
      }

      // Handle worker events
      cluster.on('exit', (worker, code, signal) => {
        Logger.warn('Worker died, restarting...', {
          workerId: worker.process.pid,
          code,
          signal
        });
        cluster.fork();
      });

      cluster.on('online', (worker) => {
        Logger.info('Worker started', {
          workerId: worker.process.pid
        });
      });

    } else {
      // Worker process - start the actual application
      Logger.info('Worker process started', {
        workerId: process.pid
      });
    }
  }

  /**
   * Graceful shutdown of cluster
   */
  static async shutdownCluster(): Promise<void> {
    if (cluster.isPrimary) {
      Logger.info('Shutting down cluster...');
      
      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        if (worker) {
          worker.kill('SIGTERM');
        }
      }

      // Wait for workers to exit
      await new Promise<void>((resolve) => {
        let workersAlive = Object.keys(cluster.workers || {}).length;
        
        if (workersAlive === 0) {
          resolve();
          return;
        }

        cluster.on('exit', () => {
          workersAlive--;
          if (workersAlive === 0) {
            resolve();
          }
        });

        // Force kill after timeout
        setTimeout(() => {
          for (const id in cluster.workers) {
            const worker = cluster.workers[id];
            if (worker) {
              worker.kill('SIGKILL');
            }
          }
          resolve();
        }, 10000); // 10 second timeout
      });

      Logger.info('Cluster shutdown complete');
    }
  }
}

/**
 * Resource monitoring for scaling decisions
 */
export class ResourceMonitor {
  /**
   * Get current resource usage
   */
  static getResourceUsage(): {
    memory: NodeJS.MemoryUsage;
    cpu: NodeJS.CpuUsage;
    uptime: number;
    loadAverage: number[];
    freeMemory: number;
    totalMemory: number;
  } {
    return {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      loadAverage: os.loadavg(),
      freeMemory: os.freemem(),
      totalMemory: os.totalmem()
    };
  }

  /**
   * Check if scaling is needed
   */
  static shouldScale(): {
    scaleUp: boolean;
    scaleDown: boolean;
    reason: string;
  } {
    const usage = this.getResourceUsage();
    const memoryUsagePercent = (usage.memory.heapUsed / usage.memory.heapTotal) * 100;
    const systemMemoryPercent = ((usage.totalMemory - usage.freeMemory) / usage.totalMemory) * 100;
    const avgLoad = usage.loadAverage[0];

    // Scale up conditions
    if (memoryUsagePercent > 80) {
      return { scaleUp: true, scaleDown: false, reason: 'High memory usage' };
    }
    if (systemMemoryPercent > 85) {
      return { scaleUp: true, scaleDown: false, reason: 'High system memory usage' };
    }
    if (avgLoad > os.cpus().length * 0.8) {
      return { scaleUp: true, scaleDown: false, reason: 'High CPU load' };
    }

    // Scale down conditions
    if (memoryUsagePercent < 30 && systemMemoryPercent < 50 && avgLoad < os.cpus().length * 0.2) {
      return { scaleUp: false, scaleDown: true, reason: 'Low resource usage' };
    }

    return { scaleUp: false, scaleDown: false, reason: 'Resources within normal range' };
  }
}

/**
 * Health check endpoint for load balancers
 */
export function createHealthCheckEndpoint() {
  return async function healthCheck(request: any, reply: any) {
    const resourceUsage = ResourceMonitor.getResourceUsage();
    const scalingRecommendation = ResourceMonitor.shouldScale();
    
    const health = {
      status: 'healthy',
      instanceId: InstanceRegistry.getInstanceId(),
      timestamp: new Date().toISOString(),
      uptime: resourceUsage.uptime,
      memory: {
        used: resourceUsage.memory.heapUsed,
        total: resourceUsage.memory.heapTotal,
        percentage: (resourceUsage.memory.heapUsed / resourceUsage.memory.heapTotal) * 100
      },
      system: {
        loadAverage: resourceUsage.loadAverage,
        freeMemory: resourceUsage.freeMemory,
        totalMemory: resourceUsage.totalMemory,
        cpuCount: os.cpus().length
      },
      scaling: scalingRecommendation
    };

    // Determine health status
    if (health.memory.percentage > 90 || health.system.loadAverage[0] > os.cpus().length) {
      health.status = 'unhealthy';
      reply.code(503);
    } else if (health.memory.percentage > 75 || health.system.loadAverage[0] > os.cpus().length * 0.8) {
      health.status = 'degraded';
      reply.code(200);
    }

    return reply.send(health);
  };
}
