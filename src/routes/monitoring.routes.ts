import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getHealthStatus, getSystemMetrics } from '../middleware/monitoring';

/**
 * Monitoring and health check routes
 */
export default async function monitoringRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Basic health check
   */
  f.get('/health', {
    schema: {
      tags: ['monitoring'],
      summary: 'Health check',
      response: {
        200: z.object({ status: z.string(), timestamp: z.string() })
      }
    }
  }, async (request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Detailed health check
   */
  f.get('/health/detailed', {
    schema: {
      tags: ['monitoring'],
      summary: 'Detailed health check',
      response: {
        200: z.any()
      }
    }
  }, async (request, reply) => {
    const health = await getHealthStatus();
    return reply.send(health);
  });

  /**
   * System metrics
   */
  f.get('/monitoring/metrics', {
    schema: {
      tags: ['monitoring'],
      summary: 'System metrics',
      response: {
        200: z.any()
      }
    }
  }, async (request, reply) => {
    const metrics = await getSystemMetrics();
    return reply.send(metrics);
  });

  /**
   * Readiness probe
   */
  f.get('/ready', {
    schema: {
      tags: ['monitoring'],
      summary: 'Readiness probe',
      response: {
        200: z.object({ ready: z.boolean(), timestamp: z.string() }),
        503: z.object({ ready: z.boolean(), reason: z.string(), timestamp: z.string() })
      }
    }
  }, async (request, reply) => {
    const health = await getHealthStatus();
    const isReady = health.status !== 'unhealthy';
    
    if (isReady) {
      return reply.send({
        ready: true,
        timestamp: new Date().toISOString()
      });
    } else {
      return reply.status(503).send({
        ready: false,
        reason: 'Health checks failing',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * Liveness probe
   */
  f.get('/live', {
    schema: {
      tags: ['monitoring'],
      summary: 'Liveness probe',
      response: {
        200: z.object({ status: z.string(), timestamp: z.string(), uptime: z.number() })
      }
    }
  }, async (request, reply) => {
    return reply.send({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  /**
   * Prometheus metrics
   */
  f.get('/metrics', {
    schema: {
      tags: ['monitoring'],
      summary: 'Prometheus metrics',
      response: {
        200: z.string()
      }
    }
  }, async (request, reply) => {
    const metrics = await getSystemMetrics();
    
    const prometheusMetrics = `
# HELP auth_service_uptime_seconds Service uptime
# TYPE auth_service_uptime_seconds counter
auth_service_uptime_seconds ${metrics.uptime}

# HELP auth_service_memory_usage_bytes Memory usage in bytes
# TYPE auth_service_memory_usage_bytes gauge
auth_service_memory_usage_bytes ${metrics.memory.used}

# HELP auth_service_requests_total Total requests
# TYPE auth_service_requests_total counter
auth_service_requests_total ${metrics.requests.total}

# HELP auth_service_database_connected Database connection status
# TYPE auth_service_database_connected gauge
auth_service_database_connected ${metrics.database.connected ? 1 : 0}
`.trim();

    reply.header('Content-Type', 'text/plain');
    return reply.send(prometheusMetrics);
  });
}
