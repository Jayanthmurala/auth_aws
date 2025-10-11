import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DatabaseManager } from '../config/database.js';
import { RedisManager } from '../config/redis.js';
import { InstanceRegistry, ResourceMonitor } from '../utils/scalability.js';
import { checkDatabaseHealth } from '../db.js';
import { Logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import os from 'os';

/**
 * Comprehensive health check and monitoring endpoints
 */

const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
  environment: z.string(),
  instanceId: z.string(),
  checks: z.object({
    database: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      responseTime: z.number(),
      connections: z.object({
        primary: z.number(),
        readReplicas: z.array(z.number())
      }).optional()
    }),
    redis: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      responseTime: z.number(),
      connected: z.boolean()
    }),
    memory: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      usage: z.object({
        used: z.number(),
        total: z.number(),
        percentage: z.number()
      }),
      system: z.object({
        free: z.number(),
        total: z.number(),
        percentage: z.number()
      })
    }),
    cpu: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      loadAverage: z.array(z.number()),
      cores: z.number()
    })
  }),
  metrics: z.object({
    requestsPerSecond: z.number().optional(),
    averageResponseTime: z.number().optional(),
    errorRate: z.number().optional()
  }).optional()
});

export async function healthRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Basic health check endpoint (for load balancers)
  f.get('/health', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: z.object({
          status: z.string(),
          timestamp: z.string()
        }),
        503: z.object({
          status: z.string(),
          timestamp: z.string(),
          error: z.string()
        })
      }
    }
  }, async (request, reply) => {
    try {
      // Quick health check - just verify basic functionality
      const dbHealth = await checkDatabaseHealth();
      
      if (!dbHealth.healthy) {
        return reply.code(503).send({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Database connection failed'
        });
      }

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  });

  // Comprehensive health check endpoint
  f.get('/health/detailed', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: healthResponseSchema,
        503: healthResponseSchema
      }
    }
  }, async (request, reply) => {
    const startTime = Date.now();
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    try {
      // Database health check
      const dbHealthStart = Date.now();
      const dbHealth = await DatabaseManager.healthCheck();
      const dbResponseTime = Date.now() - dbHealthStart;
      
      let dbStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (!dbHealth.primary.healthy) {
        dbStatus = 'unhealthy';
        overallStatus = 'unhealthy';
      } else if (dbResponseTime > 2000 || dbHealth.readReplicas.some(r => !r.healthy)) {
        dbStatus = 'degraded';
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }

      // Redis health check
      const redisHealthStart = Date.now();
      const redisHealth = await RedisManager.healthCheck();
      const redisResponseTime = Date.now() - redisHealthStart;
      
      let redisStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (!redisHealth.connected) {
        redisStatus = env.REDIS_DISABLED ? 'healthy' : 'degraded'; // Redis is optional
        if (overallStatus === 'healthy' && !env.REDIS_DISABLED) overallStatus = 'degraded';
      } else if (redisResponseTime > 1000) {
        redisStatus = 'degraded';
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }

      // Memory health check
      const memoryUsage = process.memoryUsage();
      const systemMemory = {
        free: os.freemem(),
        total: os.totalmem()
      };
      
      const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      const systemMemoryPercentage = ((systemMemory.total - systemMemory.free) / systemMemory.total) * 100;
      
      let memoryStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (memoryPercentage > 90 || systemMemoryPercentage > 95) {
        memoryStatus = 'unhealthy';
        overallStatus = 'unhealthy';
      } else if (memoryPercentage > 75 || systemMemoryPercentage > 85) {
        memoryStatus = 'degraded';
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }

      // CPU health check
      const loadAverage = os.loadavg();
      const cpuCores = os.cpus().length;
      
      let cpuStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (loadAverage[0] > cpuCores * 1.5) {
        cpuStatus = 'unhealthy';
        overallStatus = 'unhealthy';
      } else if (loadAverage[0] > cpuCores) {
        cpuStatus = 'degraded';
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }

      // Get database stats if available
      let dbStats;
      try {
        dbStats = await DatabaseManager.getStats();
      } catch (error) {
        Logger.warn('Failed to get database stats', { error: error instanceof Error ? error.message : String(error) });
      }

      const healthReport = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: env.NODE_ENV,
        instanceId: InstanceRegistry.getInstanceId(),
        checks: {
          database: {
            status: dbStatus,
            responseTime: dbResponseTime,
            ...(dbStats && {
              connections: dbStats.connections
            })
          },
          redis: {
            status: redisStatus,
            responseTime: redisResponseTime,
            connected: redisHealth.connected
          },
          memory: {
            status: memoryStatus,
            usage: {
              used: memoryUsage.heapUsed,
              total: memoryUsage.heapTotal,
              percentage: memoryPercentage
            },
            system: {
              free: systemMemory.free,
              total: systemMemory.total,
              percentage: systemMemoryPercentage
            }
          },
          cpu: {
            status: cpuStatus,
            loadAverage: loadAverage,
            cores: cpuCores
          }
        }
      };

      const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
      
      Logger.debug('Health check completed', {
        status: overallStatus,
        responseTime: Date.now() - startTime,
        checks: {
          database: dbStatus,
          redis: redisStatus,
          memory: memoryStatus,
          cpu: cpuStatus
        }
      });

      return reply.code(statusCode).send(healthReport);

    } catch (error) {
      Logger.error('Health check failed', error instanceof Error ? error : new Error(String(error)));
      
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: env.NODE_ENV,
        instanceId: InstanceRegistry.getInstanceId(),
        checks: {
          database: { status: 'unhealthy', responseTime: 0 },
          redis: { status: 'unhealthy', responseTime: 0, connected: false },
          memory: { status: 'unhealthy', usage: { used: 0, total: 0, percentage: 0 }, system: { free: 0, total: 0, percentage: 0 } },
          cpu: { status: 'unhealthy', loadAverage: [0, 0, 0], cores: 0 }
        }
      });
    }
  });

  // Readiness check (for Kubernetes)
  f.get('/ready', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: z.object({
          ready: z.boolean(),
          timestamp: z.string(),
          services: z.object({
            database: z.boolean(),
            redis: z.boolean()
          })
        }),
        503: z.object({
          ready: z.boolean(),
          timestamp: z.string(),
          error: z.string()
        })
      }
    }
  }, async (request, reply) => {
    try {
      // Check if all required services are ready
      const dbHealth = await checkDatabaseHealth();
      const redisHealth = env.REDIS_DISABLED ? { connected: true } : await RedisManager.healthCheck();
      
      const isReady = dbHealth.healthy && redisHealth.connected;
      
      if (!isReady) {
        return reply.code(503).send({
          ready: false,
          timestamp: new Date().toISOString(),
          error: 'Required services not ready'
        });
      }

      return reply.send({
        ready: true,
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth.healthy,
          redis: redisHealth.connected
        }
      });
    } catch (error) {
      return reply.code(503).send({
        ready: false,
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed'
      });
    }
  });

  // Liveness check (for Kubernetes)
  f.get('/live', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: z.object({
          alive: z.boolean(),
          timestamp: z.string(),
          uptime: z.number()
        })
      }
    }
  }, async (request, reply) => {
    // Simple liveness check - just verify the process is running
    return reply.send({
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Metrics endpoint (Prometheus-compatible)
  f.get('/metrics', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: z.object({
          timestamp: z.string(),
          instanceId: z.string(),
          metrics: z.object({
            process: z.object({
              uptime_seconds: z.number(),
              memory_usage_bytes: z.number(),
              memory_heap_used_bytes: z.number(),
              memory_heap_total_bytes: z.number(),
              cpu_usage_percent: z.number().optional()
            }),
            system: z.object({
              load_average_1m: z.number(),
              load_average_5m: z.number(),
              load_average_15m: z.number(),
              memory_free_bytes: z.number(),
              memory_total_bytes: z.number(),
              cpu_cores: z.number()
            }),
            database: z.object({
              connections_active: z.number(),
              response_time_ms: z.number(),
              healthy: z.number()
            }).optional(),
            redis: z.object({
              connected: z.number(),
              response_time_ms: z.number()
            }).optional()
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const memoryUsage = process.memoryUsage();
      const loadAverage = os.loadavg();
      
      // Get database metrics
      let dbMetrics;
      try {
        const dbHealth = await checkDatabaseHealth();
        const dbStats = await DatabaseManager.getStats();
        dbMetrics = {
          connections_active: dbStats.connections.primary,
          response_time_ms: dbHealth.connectionCount || 0,
          healthy: dbHealth.healthy ? 1 : 0
        };
      } catch (error) {
        dbMetrics = {
          connections_active: 0,
          response_time_ms: 0,
          healthy: 0
        };
      }

      // Get Redis metrics
      let redisMetrics;
      try {
        const redisHealth = await RedisManager.healthCheck();
        redisMetrics = {
          connected: redisHealth.connected ? 1 : 0,
          response_time_ms: redisHealth.responseTime
        };
      } catch (error) {
        redisMetrics = {
          connected: 0,
          response_time_ms: 0
        };
      }

      const metrics = {
        timestamp: new Date().toISOString(),
        instanceId: InstanceRegistry.getInstanceId(),
        metrics: {
          process: {
            uptime_seconds: process.uptime(),
            memory_usage_bytes: memoryUsage.rss,
            memory_heap_used_bytes: memoryUsage.heapUsed,
            memory_heap_total_bytes: memoryUsage.heapTotal
          },
          system: {
            load_average_1m: loadAverage[0],
            load_average_5m: loadAverage[1],
            load_average_15m: loadAverage[2],
            memory_free_bytes: os.freemem(),
            memory_total_bytes: os.totalmem(),
            cpu_cores: os.cpus().length
          },
          database: dbMetrics,
          redis: redisMetrics
        }
      };

      return reply.send(metrics);
    } catch (error) {
      Logger.error('Metrics collection failed', error instanceof Error ? error : new Error(String(error)));
      return reply.code(500).send({ 
        timestamp: new Date().toISOString(),
        instanceId: InstanceRegistry.getInstanceId(),
        metrics: {
          process: {
            uptime_seconds: 0,
            memory_usage_bytes: 0,
            memory_heap_used_bytes: 0,
            memory_heap_total_bytes: 0
          },
          system: {
            load_average_1m: 0,
            load_average_5m: 0,
            load_average_15m: 0,
            memory_free_bytes: 0,
            memory_total_bytes: 0,
            cpu_cores: 0
          }
        }
      });
    }
  });

  // Instance information endpoint
  f.get('/info', {
    schema: {
      tags: ['monitoring'],
      response: {
        200: z.object({
          instanceId: z.string(),
          hostname: z.string(),
          pid: z.number(),
          version: z.string(),
          nodeVersion: z.string(),
          environment: z.string(),
          startTime: z.string(),
          uptime: z.number(),
          platform: z.string(),
          architecture: z.string()
        })
      }
    }
  }, async (request, reply) => {
    return reply.send({
      instanceId: InstanceRegistry.getInstanceId(),
      hostname: os.hostname(),
      pid: process.pid,
      version: process.env.npm_package_version || '1.0.0',
      nodeVersion: process.version,
      environment: env.NODE_ENV,
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptime: process.uptime(),
      platform: os.platform(),
      architecture: os.arch()
    });
  });
}

export default healthRoutes;
