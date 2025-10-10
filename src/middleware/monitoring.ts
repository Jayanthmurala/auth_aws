import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';
import { prisma } from '../db';
import { RedisManager } from '../config/redis';

/**
 * System metrics interface
 */
export interface SystemMetrics {
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
  };
  database: {
    connected: boolean;
    responseTime: number;
  };
  redis?: {
    connected: boolean;
    responseTime: number;
  };
}

/**
 * Health check status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: HealthCheck;
    redis?: HealthCheck;
    memory: HealthCheck;
    disk: HealthCheck;
  };
}

export interface HealthCheck {
  status: 'pass' | 'warn' | 'fail';
  responseTime?: number;
  message?: string;
  details?: any;
}

/**
 * Request metrics tracking
 */
class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics = {
    requests: {
      total: 0,
      successful: 0,
      failed: 0
    },
    responseTimes: [] as number[],
    startTime: Date.now()
  };

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  recordRequest(responseTime: number, success: boolean) {
    this.metrics.requests.total++;
    if (success) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }
    
    this.metrics.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times to prevent memory leak
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes = this.metrics.responseTimes.slice(-1000);
    }
  }

  getMetrics(): SystemMetrics['requests'] {
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((a: number, b: number) => a + b, 0) / this.metrics.responseTimes.length
      : 0;

    return {
      total: this.metrics.requests.total,
      successful: this.metrics.requests.successful,
      failed: this.metrics.requests.failed,
      averageResponseTime: Math.round(avgResponseTime * 100) / 100
    };
  }

  getUptime(): number {
    return Date.now() - this.metrics.startTime;
  }
}

/**
 * Health check implementations
 */
export class HealthChecks {
  /**
   * Check database connectivity
   */
  static async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      await prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 1000 ? 'pass' : 'warn',
        responseTime,
        message: responseTime < 1000 ? 'Database responsive' : 'Database slow response'
      };
    } catch (error) {
      return {
        status: 'fail',
        responseTime: Date.now() - startTime,
        message: 'Database connection failed',
        details: env.NODE_ENV === 'development' ? error : undefined
      };
    }
  }

  /**
   * Check Redis connectivity (if enabled)
   */
  static async checkRedis(): Promise<HealthCheck | undefined> {
    if (env.REDIS_DISABLED) {
      return undefined;
    }

    const startTime = Date.now();
    
    try {
      const redis = RedisManager.getInstance();
      await redis.ping();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'pass',
        responseTime,
        message: 'Redis responsive'
      };
    } catch (error) {
      return {
        status: 'fail',
        responseTime: Date.now() - startTime,
        message: 'Redis connection failed',
        details: env.NODE_ENV === 'development' ? error : undefined
      };
    }
  }

  /**
   * Check memory usage
   */
  static checkMemory(): HealthCheck {
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal;
    const usedMem = memUsage.heapUsed;
    const percentage = (usedMem / totalMem) * 100;

    let status: HealthCheck['status'] = 'pass';
    let message = 'Memory usage normal';

    if (percentage > 90) {
      status = 'fail';
      message = 'Critical memory usage';
    } else if (percentage > 75) {
      status = 'warn';
      message = 'High memory usage';
    }

    return {
      status,
      message,
      details: {
        used: Math.round(usedMem / 1024 / 1024),
        total: Math.round(totalMem / 1024 / 1024),
        percentage: Math.round(percentage * 100) / 100
      }
    };
  }

  /**
   * Check disk space (simplified)
   */
  static checkDisk(): HealthCheck {
    // In a real implementation, you'd check actual disk space
    // For now, we'll return a basic check
    return {
      status: 'pass',
      message: 'Disk space sufficient'
    };
  }
}

/**
 * Monitoring middleware to track request metrics
 */
export async function monitoringMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const startTime = Date.now();
  const collector = MetricsCollector.getInstance();

  // Hook into response to record metrics
  reply.raw.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const success = reply.statusCode < 400;
    collector.recordRequest(responseTime, success);
  });
}

/**
 * Get comprehensive system metrics
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const collector = MetricsCollector.getInstance();
  const memUsage = process.memoryUsage();
  
  // Get database check for response time
  const dbCheck = await HealthChecks.checkDatabase();
  const redisCheck = await HealthChecks.checkRedis();

  return {
    uptime: collector.getUptime(),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 10000) / 100
    },
    cpu: {
      usage: 0 // Would need additional library for CPU usage
    },
    requests: collector.getMetrics(),
    database: {
      connected: dbCheck.status !== 'fail',
      responseTime: dbCheck.responseTime || 0
    },
    redis: redisCheck ? {
      connected: redisCheck.status !== 'fail',
      responseTime: redisCheck.responseTime || 0
    } : undefined
  };
}

/**
 * Get health status
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const checks = {
    database: await HealthChecks.checkDatabase(),
    redis: await HealthChecks.checkRedis(),
    memory: HealthChecks.checkMemory(),
    disk: HealthChecks.checkDisk()
  };

  // Determine overall status
  const hasFailures = Object.values(checks).some(check => check?.status === 'fail');
  const hasWarnings = Object.values(checks).some(check => check?.status === 'warn');

  let status: HealthStatus['status'] = 'healthy';
  if (hasFailures) {
    status = 'unhealthy';
  } else if (hasWarnings) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: MetricsCollector.getInstance().getUptime(),
    version: '0.1.0',
    environment: env.NODE_ENV,
    checks: {
      database: checks.database,
      ...(checks.redis && { redis: checks.redis }),
      memory: checks.memory,
      disk: checks.disk
    }
  };
}
