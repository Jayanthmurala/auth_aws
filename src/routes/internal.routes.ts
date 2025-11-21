import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { RateLimiters } from '../middleware/rateLimitMiddleware.js';
import { DistributedRateLimiters } from '../middleware/distributedRateLimit.js';
import { validateRequestSignature } from '../middleware/requestSigning.js';

// Define validation schemas
const userIdParamsSchema = z.object({
  userId: z.string().cuid('Invalid user ID format')
});

const batchRequestSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1, 'At least one user ID required').max(100, 'Maximum 100 users per batch')
});

const searchRequestSchema = z.object({
  collegeId: z.string().cuid().optional(),
  department: z.string().min(1).max(100).optional(),
  roles: z.array(z.enum(['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN', 'SUPER_ADMIN'])).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0)
});

const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  collegeMemberId: z.string().nullable(),
  department: z.string().nullable(),
  year: z.number().nullable(),
  collegeId: z.string().nullable(),
  roles: z.array(z.string()),
  status: z.string()
});

export async function internalRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();
  
  // Secure API key authentication and rate limiting for internal services
  f.addHook('preHandler', DistributedRateLimiters.internal);
  f.addHook('preHandler', apiKeyAuth);
  
  // Optional request signing for production environments
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_REQUEST_SIGNING === 'true') {
    f.addHook('preHandler', validateRequestSignature);
  }

  // PHASE 2: Get single user by ID with college scoping
  f.get('/api/internal/users/:userId', {
    schema: {
      params: userIdParamsSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: userResponseSchema
        }),
        404: z.object({
          success: z.boolean(),
          message: z.string()
        }),
        403: z.object({
          success: z.boolean(),
          message: z.string()
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          code: z.string()
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          collegeMemberId: true,
          department: true,
          year: true,
          collegeId: true,
          roles: true,
          status: true
        }
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          message: 'User not found'
        });
      }

      // PHASE 2: Validate requesting service has permission to access this user
      // For now, allow all authenticated internal services (API key validated by middleware)
      // In future, can add service-specific scoping via X-Service-Name header
      const requestingService = (request.headers as any)['x-service-name'] || 'unknown';
      
      // Log access for audit purposes
      console.log('[Internal API] User access:', {
        userId,
        userCollegeId: user.collegeId,
        requestingService,
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: user
      });
    } catch (error) {
      // Secure error logging without sensitive data
      console.error('[Internal API] Operation failed:', {
        endpoint: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
        // Don't log the actual error message or stack trace
      });
      
      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // PHASE 2: Get multiple users by IDs (batch request) with audit logging
  f.post('/api/internal/users/batch', {
    schema: {
      body: batchRequestSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.array(userResponseSchema)
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          code: z.string()
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { userIds } = request.body;
      const requestingService = (request.headers as any)['x-service-name'] || 'unknown';

      const users = await prisma.user.findMany({
        where: {
          id: { in: userIds }
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          collegeMemberId: true,
          department: true,
          year: true,
          collegeId: true,
          roles: true,
          status: true
        }
      });

      // PHASE 2: Log batch access for audit purposes
      console.log('[Internal API] Batch user access:', {
        requestedUserIds: userIds,
        returnedUserCount: users.length,
        requestingService,
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: users
      });
    } catch (error) {
      // Secure error logging without sensitive data
      console.error('[Internal API] Operation failed:', {
        endpoint: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
      });
      
      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // Search users by college and optional filters
  f.post('/api/internal/users/search', {
    schema: {
      body: searchRequestSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            users: z.array(userResponseSchema),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean()
            })
          })
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          code: z.string()
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { 
        collegeId, 
        department, 
        roles, 
        status,
        limit,
        offset 
      } = request.body;

      const where: {
        collegeId?: string;
        department?: string;
        roles?: { hasSome: Role[] };
        status?: UserStatus;
      } = {};
      
      if (collegeId) where.collegeId = collegeId;
      if (department) where.department = department;
      if (roles && roles.length > 0) {
        where.roles = { hasSome: roles as Role[] };
      }
      if (status) where.status = status as UserStatus;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            displayName: true,
            collegeMemberId: true,
            department: true,
            year: true,
            collegeId: true,
            roles: true,
            status: true
          },
          take: Math.min(limit, 100),
          skip: offset,
          orderBy: { displayName: 'asc' }
        }),
        prisma.user.count({ where })
      ]);

      return reply.send({
        success: true,
        data: {
          users,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + users.length < total
          }
        }
      });
    } catch (error) {
      // Secure error logging without sensitive data
      console.error('[Internal API] Operation failed:', {
        endpoint: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
      });
      
      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });
}

export default internalRoutes;
