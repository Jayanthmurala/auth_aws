import type { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { DistributedRateLimiters } from "../middleware/distributedRateLimit.js";
import { emitCollegeEvent } from "../events/collegeEvents.js";

// P1-1: User activity logging for college operations
async function logUserActivity(
  request: any,
  action: string,
  targetType: string,
  targetId?: string,
  details?: Record<string, any>
) {
  try {
    if (!request.user) return;
    
    // Log user activity (not admin audit log)
    console.log('[USER_ACTIVITY]', {
      userId: request.user.id,
      action,
      targetType,
      targetId,
      details,
      timestamp: new Date().toISOString(),
      ip: request.ip,
      userAgent: request.headers['user-agent']
    });
    
    // TODO: Store in user activity log table when implemented
    // await prisma.userActivityLog.create({
    //   data: {
    //     userId: request.user.id,
    //     action,
    //     targetType,
    //     targetId,
    //     details,
    //     ipAddress: request.ip,
    //     userAgent: request.headers['user-agent']
    //   }
    // });
    
  } catch (error) {
    console.error('[USER_ACTIVITY_LOG] Error:', error);
  }
}

// P0-3: Enhanced input validation schemas
const collegeListQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  search: z.string()
    .max(100, 'Search term too long')
    .regex(/^[a-zA-Z0-9\s\-_.]*$/, 'Invalid search characters')
    .optional(),
  location: z.string()
    .max(100, 'Location filter too long')
    .regex(/^[a-zA-Z0-9\s\-_.,]*$/, 'Invalid location characters')
    .optional()
});

const collegeParamsSchema = z.object({
  id: z.string().cuid('Invalid college ID format')
});

// P0-4: Filtered public response schema (no sensitive timestamps)
const publicCollegeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  location: z.string().nullable(),
  website: z.string().nullable(),
  departments: z.array(z.string()),
  isActive: z.boolean()
  // Removed createdAt and updatedAt for security
});

const collegesListSchema = z.object({
  colleges: z.array(publicCollegeResponseSchema),
  total: z.number(),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean()
  })
});

// P0: Standardized error response
const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    timestamp: z.string(),
    requestId: z.string().optional()
  })
});

// Legacy error response for compatibility
const legacyErrorResponseSchema = z.object({
  message: z.string()
});

export async function collegeRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // P0-1: Add authentication and P0-2: Add rate limiting to all college endpoints
  f.addHook('preHandler', authenticateUser);
  f.addHook('preHandler', DistributedRateLimiters.general);

  // GET /v1/colleges - List all colleges (authenticated users only)
  f.get("/v1/colleges", {
    schema: {
      tags: ["colleges"],
      summary: "List colleges with filtering",
      description: "Retrieve a paginated list of colleges with optional filtering",
      security: [{ bearerAuth: [] }],
      querystring: collegeListQuerySchema,
      response: { 
        200: collegesListSchema, 
        400: errorResponseSchema,
        401: errorResponseSchema,
        429: errorResponseSchema,
        500: errorResponseSchema 
      },
    },
  }, async (req, reply) => {
    try {
      // P0-3: Use validated query parameters
      const validatedQuery = collegeListQuerySchema.parse(req.query);
      const { active, limit, offset, search, location } = validatedQuery;
      
      // P0-3: Type-safe where clause construction
      const where: any = {};
      
      if (active !== undefined) {
        where.isActive = active === "true";
      }
      
      // P0-3: Enhanced search functionality
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } }
        ];
      }
      
      if (location) {
        where.location = { contains: location, mode: 'insensitive' };
      }
      
      const [colleges, total] = await Promise.all([
        prisma.college.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { name: "asc" },
          select: {
            // P0-4: Only select public fields
            id: true,
            name: true,
            code: true,
            location: true,
            website: true,
            departments: true,
            isActive: true
            // Exclude createdAt, updatedAt for security
          }
        }),
        prisma.college.count({ where }),
      ]);
      
      // P1-1: Log user activity for college list access
      await logUserActivity(
        req,
        'VIEW_COLLEGES',
        'COLLEGE',
        undefined,
        { 
          filters: { active, search, location },
          resultCount: colleges.length,
          pagination: { limit, offset }
        }
      );
      
      // P1-2: Emit college search event
      emitCollegeEvent('college.searched', {
        searchTerm: search,
        filters: { active, location },
        resultCount: colleges.length,
        searchedBy: req.user!.id,
        timestamp: new Date()
      });
      
      // P0-4: Structured response with pagination info
      const hasMore = offset + limit < total;
      
      return reply.send({ 
        colleges, 
        total,
        pagination: {
          limit,
          offset,
          hasMore
        }
      });
      
    } catch (error) {
      console.error('[COLLEGE_LIST] Error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve colleges',
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    }
  });

  // GET /v1/colleges/:id - Get college by ID (authenticated users only)
  f.get("/v1/colleges/:id", {
    schema: {
      tags: ["colleges"],
      summary: "Get college by ID",
      description: "Retrieve detailed information about a specific college",
      security: [{ bearerAuth: [] }],
      params: collegeParamsSchema,
      response: { 
        200: publicCollegeResponseSchema, 
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        429: errorResponseSchema,
        500: errorResponseSchema 
      },
    },
  }, async (req, reply) => {
    try {
      // P0-3: Use validated parameters
      const validatedParams = collegeParamsSchema.parse(req.params);
      const { id } = validatedParams;
      
      const college = await prisma.college.findUnique({ 
        where: { id },
        select: {
          // P0-4: Only select public fields
          id: true,
          name: true,
          code: true,
          location: true,
          website: true,
          departments: true,
          isActive: true
          // Exclude createdAt, updatedAt for security
        }
      });
      
      if (!college) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COLLEGE_NOT_FOUND',
            message: 'The requested college could not be found',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      // P1-1: Log user activity for college access
      await logUserActivity(
        req,
        'VIEW_COLLEGE',
        'COLLEGE',
        college.id,
        { 
          collegeName: college.name,
          collegeCode: college.code
        }
      );
      
      // P1-2: Emit college viewed event
      emitCollegeEvent('college.viewed', {
        collegeId: college.id,
        collegeName: college.name,
        viewedBy: req.user!.id,
        userRole: req.user!.roles,
        timestamp: new Date(),
        metadata: {
          collegeCode: college.code,
          isActive: college.isActive
        }
      });
      
      return reply.send(college);
      
    } catch (error) {
      console.error('[COLLEGE_GET] Error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid college ID format',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve college',
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    }
  });

  // GET /v1/colleges/:id/departments - Get departments for college (authenticated users only)
  f.get("/v1/colleges/:id/departments", {
    schema: {
      tags: ["colleges"],
      summary: "Get college departments",
      description: "Retrieve the list of departments for a specific college",
      security: [{ bearerAuth: [] }],
      params: collegeParamsSchema,
      response: { 
        200: z.object({ 
          success: z.literal(true),
          data: z.object({
            collegeId: z.string(),
            collegeName: z.string(),
            departments: z.array(z.string())
          })
        }), 
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
        429: errorResponseSchema,
        500: errorResponseSchema 
      },
    },
  }, async (req, reply) => {
    try {
      // P0-3: Use validated parameters
      const validatedParams = collegeParamsSchema.parse(req.params);
      const { id } = validatedParams;
      
      const college = await prisma.college.findUnique({ 
        where: { id },
        select: { 
          id: true,
          name: true,
          departments: true,
          isActive: true
        }
      });
      
      if (!college) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COLLEGE_NOT_FOUND',
            message: 'The requested college could not be found',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      // P0: Only return departments for active colleges
      if (!college.isActive) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'COLLEGE_INACTIVE',
            message: 'College is not currently active',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      // P1-1: Log user activity for department access
      await logUserActivity(
        req,
        'VIEW_COLLEGE_DEPARTMENTS',
        'COLLEGE',
        college.id,
        { 
          collegeName: college.name,
          departmentCount: college.departments.length,
          departments: college.departments
        }
      );
      
      // P1-2: Emit departments accessed event
      emitCollegeEvent('college.departments_accessed', {
        collegeId: college.id,
        collegeName: college.name,
        departmentCount: college.departments.length,
        accessedBy: req.user!.id,
        timestamp: new Date()
      });
      
      return reply.send({ 
        success: true,
        data: {
          collegeId: college.id,
          collegeName: college.name,
          departments: college.departments
        }
      });
      
    } catch (error) {
      console.error('[COLLEGE_DEPARTMENTS] Error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid college ID format',
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve college departments',
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    }
  });
}

export default collegeRoutes;
