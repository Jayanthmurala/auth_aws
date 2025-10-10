import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAdmin, requireDeptAdmin } from '../middleware/adminAuth';
import { DeptAdminController } from '../controllers/DeptAdminController';
import { DistributedRateLimiters } from '../../middleware/distributedRateLimit';
import { csrfProtection } from '../../middleware/distributedCSRF';
import {
  deptAdminQuerySchema,
  auditLogsQuerySchema as userAuditLogsQuerySchema,
  exportQuerySchema as userExportQuerySchema,
  userParamsSchema,
  usersListResponseSchema,
  userResponseSchema,
  errorResponseSchema,
  deptAdminCreateUserSchema,
  deptAdminUpdateUserSchema,
  updateUserStatusSchema,
  createUserResponseSchema
} from '../validators/adminUserSchemas';
import {
  analyticsQuerySchema,
  auditLogsQuerySchema as analyticsAuditLogsQuerySchema,
  exportQuerySchema as analyticsExportQuerySchema,
  deptAdminDashboardResponseSchema,
  departmentAnalyticsResponseSchema,
  auditLogsResponseSchema,
  analyticsErrorResponseSchema
} from '../validators/adminAnalyticsSchemas';

export async function deptAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply security middleware to all routes
  f.addHook('preHandler', DistributedRateLimiters.admin);
  f.addHook('preHandler', requireAdmin);
  f.addHook('preHandler', requireDeptAdmin);

  // Dashboard
  f.get('/v1/admin/dept/dashboard', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get DEPT_ADMIN dashboard data',
      description: 'Retrieve department-specific dashboard data and analytics',
      response: {
        200: deptAdminDashboardResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getDashboard);

  // User Management (Department Scoped)
  f.get('/v1/admin/dept/users', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get users in department',
      description: 'Retrieve all users in the admin\'s department with filtering options',
      querystring: deptAdminQuerySchema,
      response: {
        200: usersListResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getUsers);

  f.post('/v1/admin/dept/users', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['dept-admin'],
      summary: 'Create a new user in department',
      description: 'Create a new STUDENT or FACULTY user in the admin\'s department',
      body: deptAdminCreateUserSchema,
      response: {
        201: createUserResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, DeptAdminController.createUser);

  f.put('/v1/admin/dept/users/:userId', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['dept-admin'],
      summary: 'Update a user in department',
      description: 'Update user information (limited to STUDENT and FACULTY roles)',
      params: userParamsSchema,
      body: deptAdminUpdateUserSchema,
      response: {
        200: createUserResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, DeptAdminController.updateUser);

  f.patch('/v1/admin/dept/users/:userId/status', {
    preHandler: [csrfProtection],
    schema: {
      tags: ['dept-admin'],
      summary: 'Update user status',
      description: 'Activate or suspend a user in the department',
      params: userParamsSchema,
      body: updateUserStatusSchema,
      response: {
        200: createUserResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, DeptAdminController.updateUserStatus);

  // Analytics (Department Scoped)
  f.get('/v1/admin/dept/analytics', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department analytics',
      description: 'Retrieve analytics data specific to the admin\'s department',
      response: {
        200: departmentAnalyticsResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getAnalytics);

  // Audit Logs (Admin's Actions Only)
  f.get('/v1/admin/dept/audit-logs', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department audit logs',
      description: 'Retrieve audit logs for the admin\'s own actions',
      querystring: userAuditLogsQuerySchema,
      response: {
        200: auditLogsResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getAuditLogs);

  // Data Export (Department Scoped)
  f.get('/v1/admin/dept/export', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Export department data',
      description: 'Export department users and audit logs in CSV format',
      querystring: userExportQuerySchema,
      response: {
        200: { type: 'string', description: 'CSV file content' },
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.exportData);

  // Get college departments
  f.get('/v1/admin/dept/college/departments', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get college departments',
      description: 'Get list of departments in the admin\'s college',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        404: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, DeptAdminController.getCollegeDepartments);

}

export default deptAdminRoutes;
