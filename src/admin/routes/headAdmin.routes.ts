import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAdmin, requireHeadAdmin } from '../middleware/adminAuth.js';
import { HeadAdminController } from '../controllers/HeadAdminController.js';
import { DistributedRateLimiters } from '../../middleware/distributedRateLimit.js';
import { csrfProtection } from '../../middleware/distributedCSRF.js';
import {
  createUserSchema,
  updateUserSchema,
  bulkUserOperationSchema,
  resetPasswordSchema,
  userFiltersSchema,
  paginationSchema,
  userParamsSchema,
  usersListResponseSchema,
  userResponseSchema,
  createUserResponseSchema,
  bulkOperationResponseSchema,
  errorResponseSchema,
  headAdminCreateUserSchema,
  headAdminUpdateUserSchema
} from '../validators/adminUserSchemas.js';
import {
  updateCollegeSchema,
  addDepartmentSchema,
  removeDepartmentSchema,
  transferUsersSchema,
  collegeSettingsResponseSchema,
  collegeGetResponseSchema,
  collegeUpdateResponseSchema,
  departmentUpdateResponseSchema,
  transferResponseSchema,
  collegeErrorResponseSchema
} from '../validators/adminCollegeSchemas.js';
import {
  analyticsQuerySchema,
  auditLogsQuerySchema,
  exportQuerySchema,
  headAdminDashboardResponseSchema,
  analyticsResponseSchema,
  auditLogsResponseSchema,
  analyticsErrorResponseSchema
} from '../validators/adminAnalyticsSchemas.js';

export async function headAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply security middleware to all routes
  f.addHook('preHandler', DistributedRateLimiters.admin);
  f.addHook('preHandler', requireAdmin);
  f.addHook('preHandler', requireHeadAdmin);

  // Dashboard
  f.get('/v1/admin/head/dashboard', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get HEAD_ADMIN dashboard data',
      description: 'Retrieve comprehensive dashboard data including analytics, college info, and admin activity',
      response: {
        200: headAdminDashboardResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getDashboard);

  // User Management
  f.get('/v1/admin/head/users', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get users with filtering and pagination',
      description: 'Retrieve all users in the college with advanced filtering options',
      querystring: userFiltersSchema.merge(paginationSchema),
      response: {
        200: usersListResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getUsers);

  f.post('/v1/admin/head/users', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Create a new user',
      description: 'Create a new user with any role (except HEAD_ADMIN and SUPER_ADMIN)',
      body: headAdminCreateUserSchema,
      response: {
        201: createUserResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, HeadAdminController.createUser);

  f.put('/v1/admin/head/users/:userId', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Update a user',
      description: 'Update user information and roles',
      params: userParamsSchema,
      body: headAdminUpdateUserSchema,
      response: {
        200: createUserResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, HeadAdminController.updateUser);

  f.delete('/v1/admin/head/users/:userId', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Delete a user (soft delete)',
      description: 'Soft delete a user account',
      params: z.object({
        userId: z.string().min(1, 'User ID is required')
      }),
      response: {
        200: z.object({
          success: z.boolean(),
          message: z.string()
        }),
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, HeadAdminController.deleteUser);

  f.post('/v1/admin/head/users/bulk', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Bulk user operations',
      description: 'Perform bulk operations on users (create, update, delete, suspend, activate)',
      body: bulkUserOperationSchema,
      response: {
        200: bulkOperationResponseSchema,
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.bulkUserOperation);

  f.post('/v1/admin/head/users/:userId/reset-password', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Reset user password',
      description: 'Reset password for a specific user',
      params: userParamsSchema,
      body: resetPasswordSchema,
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } },
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, HeadAdminController.resetUserPassword);

  // College Management
  f.get('/v1/admin/head/college', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get college settings',
      description: 'Retrieve college settings and statistics',
      response: {
        200: collegeGetResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getCollegeSettings);

  f.put('/v1/admin/head/college', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['head-admin'],
      summary: 'Update college settings',
      description: 'Update college information and settings',
      body: updateCollegeSchema,
      response: {
        200: collegeUpdateResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, HeadAdminController.updateCollegeSettings);

  // Analytics
  f.get('/v1/admin/head/analytics', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get analytics data',
      description: 'Retrieve various analytics data (growth, activity, departments, overview)',
      querystring: analyticsQuerySchema,
      response: {
        200: analyticsResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getAnalytics);

  // Audit Logs
  f.get('/v1/admin/head/audit-logs', {
    schema: {
      tags: ['head-admin'],
      summary: 'Get audit logs',
      description: 'Retrieve admin audit logs with filtering and pagination',
      querystring: auditLogsQuerySchema,
      response: {
        200: auditLogsResponseSchema,
        500: errorResponseSchema
      }
    }
  }, HeadAdminController.getAuditLogs);

  // Data Export
  f.get('/v1/admin/head/export', {
    schema: {
      tags: ['head-admin'],
      summary: 'Export data',
      description: 'Export various data types (users, analytics, audit logs) in CSV format',
      querystring: exportQuerySchema,
      response: {
        200: { type: 'string', description: 'CSV file content' },
        400: errorResponseSchema
      }
    }
  }, HeadAdminController.exportData);
}

export default headAdminRoutes;
