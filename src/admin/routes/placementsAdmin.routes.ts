import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAdmin, requirePlacementsAdmin } from '../middleware/adminAuth.js';
import { PlacementsAdminController } from '../controllers/PlacementsAdminController.js';
import {
  userFiltersSchema,
  paginationSchema,
  userParamsSchema,
  usersListResponseSchema,
  userResponseSchema,
  errorResponseSchema,
  placementsAdminCreateUserSchema,
  placementsAdminUpdateUserSchema
} from '../validators/adminUserSchemas.js';
import {
  analyticsQuerySchema,
  auditLogsQuerySchema,
  exportQuerySchema,
  placementsAdminDashboardResponseSchema,
  placementAnalyticsResponseSchema,
  auditLogsResponseSchema,
  analyticsErrorResponseSchema
} from '../validators/adminAnalyticsSchemas.js';
import { z } from 'zod';

// Placement-specific schemas
const placementReadinessQuerySchema = z.object({
  readiness: z.enum(['ready', 'not-ready', 'all']).optional().default('all')
});

const studentFiltersSchema = userFiltersSchema.extend({
  departments: z.string().optional().transform(val => val ? val.split(',') : undefined),
  year: z.string().optional().transform(val => val ? val.split(',').map(Number) : undefined),
  skills: z.string().optional().transform(val => val ? val.split(',') : undefined),
  internshipStatus: z.enum(['completed', 'ongoing', 'not-started', 'all']).optional().default('all'),
  placementStatus: z.enum(['placed', 'not-placed', 'in-process', 'all']).optional().default('all')
});

export async function placementsAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply admin authentication to all routes
  f.addHook('preHandler', requireAdmin);
  f.addHook('preHandler', requirePlacementsAdmin);

  // Dashboard
  f.get('/v1/admin/placements/dashboard', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get PLACEMENTS_ADMIN dashboard data',
      description: 'Retrieve placement-focused dashboard data and statistics',
      response: {
        200: placementsAdminDashboardResponseSchema,
        500: errorResponseSchema
      }
    }
  }, PlacementsAdminController.getDashboard);

  // Student Management (Students Only)
  f.get('/v1/admin/placements/students', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get students with placement filters',
      description: 'Retrieve all students in the college with placement-focused filtering',
      querystring: studentFiltersSchema.merge(paginationSchema),
      response: {
        200: usersListResponseSchema,
        500: errorResponseSchema
      }
    }
  }, PlacementsAdminController.getStudents);

  f.post('/v1/admin/placements/students', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Create a new student',
      description: 'Create a new STUDENT user for placement purposes',
      body: placementsAdminCreateUserSchema,
      response: {
        201: userResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema
      }
    }
  }, PlacementsAdminController.createStudent);

  f.put('/v1/admin/placements/students/:userId', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Update student information',
      description: 'Update student information with placement-related fields',
      params: userParamsSchema,
      body: placementsAdminUpdateUserSchema,
      response: {
        200: userResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema
      }
    }
  }, PlacementsAdminController.updateStudent);

  // Placement Analytics
  f.get('/v1/admin/placements/analytics', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get placement analytics',
      description: 'Retrieve comprehensive placement statistics and analytics',
      response: {
        200: placementAnalyticsResponseSchema,
        500: errorResponseSchema
      }
    }
  }, PlacementsAdminController.getPlacementAnalytics);

  // Placement Readiness
  f.get('/v1/admin/placements/students/readiness', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get students by placement readiness',
      description: 'Retrieve students filtered by their placement readiness status',
      querystring: placementReadinessQuerySchema.merge(paginationSchema),
      response: {
        200: usersListResponseSchema,
        500: errorResponseSchema
      }
    }
  }, PlacementsAdminController.getStudentsByReadiness);

  // Department-wise Placement Data
  f.get('/v1/admin/placements/departments', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get department-wise placement data',
      description: 'Retrieve placement statistics broken down by department',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  department: { type: 'string' },
                  totalStudents: { type: 'number' },
                  placementReady: { type: 'number' },
                  placed: { type: 'number' },
                  averagePackage: { type: 'number' },
                  topCompanies: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    // This would be implemented in the controller
    // For now, return a placeholder response
    return reply.send({
      success: true,
      data: []
    });
  });

  // Company and Placement Tracking
  f.get('/v1/admin/placements/companies', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get company placement data',
      description: 'Retrieve information about companies and their placement statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  companyName: { type: 'string' },
                  studentsPlaced: { type: 'number' },
                  averagePackage: { type: 'number' },
                  visitDate: { type: 'string', format: 'date' },
                  departments: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    // This would be implemented in the controller
    // For now, return a placeholder response
    return reply.send({
      success: true,
      data: []
    });
  });

  // Audit Logs (Placement Admin's Actions Only)
  f.get('/v1/admin/placements/audit-logs', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get placement audit logs',
      description: 'Retrieve audit logs for the placement admin\'s own actions',
      querystring: auditLogsQuerySchema,
      response: {
        200: auditLogsResponseSchema,
        500: errorResponseSchema
      }
    }
  }, PlacementsAdminController.getAuditLogs);

  // Data Export (Placement Focused)
  f.get('/v1/admin/placements/export', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Export placement data',
      description: 'Export placement-related data (students, readiness, audit logs) in CSV format',
      querystring: exportQuerySchema.extend({
        readiness: z.enum(['ready', 'not-ready', 'all']).optional()
      }),
      response: {
        200: { type: 'string', description: 'CSV file content' },
        400: errorResponseSchema
      }
    }
  }, PlacementsAdminController.exportData);

  // Placement Reports
  f.get('/v1/admin/placements/reports/summary', {
    schema: {
      tags: ['placements-admin'],
      summary: 'Get placement summary report',
      description: 'Generate a comprehensive placement summary report',
      querystring: z.object({
        year: z.string().optional().transform(val => val ? parseInt(val) : new Date().getFullYear()),
        department: z.string().optional(),
        format: z.enum(['json', 'csv']).optional().default('json')
      }),
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                summary: {
                  type: 'object',
                  properties: {
                    totalStudents: { type: 'number' },
                    studentsPlaced: { type: 'number' },
                    placementPercentage: { type: 'number' },
                    averagePackage: { type: 'number' },
                    highestPackage: { type: 'number' },
                    companiesVisited: { type: 'number' }
                  }
                },
                departmentWise: { type: 'array' },
                topCompanies: { type: 'array' },
                packageDistribution: { type: 'array' }
              }
            }
          }
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    // This would be implemented in the controller
    // For now, return a placeholder response
    return reply.send({
      success: true,
      data: {
        summary: {
          totalStudents: 0,
          studentsPlaced: 0,
          placementPercentage: 0,
          averagePackage: 0,
          highestPackage: 0,
          companiesVisited: 0
        },
        departmentWise: [],
        topCompanies: [],
        packageDistribution: []
      }
    });
  });
}

export default placementsAdminRoutes;
