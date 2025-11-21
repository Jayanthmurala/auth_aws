import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getHealthStatus, getSystemMetrics } from '../middleware/monitoring.js';

/**
 * Monitoring and health check routes
 */
export default async function monitoringRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Note: /health and /health/detailed endpoints are handled by healthRoutes.ts to avoid conflicts

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

  // Note: /ready and /live endpoints are handled by healthRoutes.ts to avoid conflicts

  // Note: /metrics endpoint is handled by healthRoutes.ts to avoid conflicts
}
