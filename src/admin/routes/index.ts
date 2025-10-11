import { FastifyInstance } from 'fastify';
import headAdminRoutes from './headAdmin.routes.js';
import deptAdminRoutes from './deptAdmin.routes.js';
import placementsAdminRoutes from './placementsAdmin.routes.js';

/**
 * Register all admin routes
 */
export async function adminRoutes(app: FastifyInstance) {
  // Register HEAD_ADMIN routes
  await app.register(headAdminRoutes);
  
  // Register DEPT_ADMIN routes
  await app.register(deptAdminRoutes);
  
  // Register PLACEMENTS_ADMIN routes
  await app.register(placementsAdminRoutes);

  // Health check for admin routes
  app.get('/v1/admin/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'admin-routes',
      timestamp: new Date().toISOString(),
      routes: {
        headAdmin: 'available',
        deptAdmin: 'available',
        placementsAdmin: 'available'
      }
    };
  });
}

export default adminRoutes;
