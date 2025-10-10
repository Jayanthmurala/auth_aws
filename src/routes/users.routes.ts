import type { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../db";
import { Role, UserStatus } from "@prisma/client";
import { authenticateUser, optionalAuth } from "../middleware/authMiddleware";
import { 
  errorResponseSchema, 
  userUpdateBodySchema, 
  userSearchQuerySchema, 
  userBatchBodySchema,
  UserUpdateBody 
} from "../schemas/auth.schemas";
import { RateLimiters } from "../middleware/rateLimitMiddleware";
import * as userService from "../services/user.service";
import { csrfProtection } from "../middleware/distributedCSRF";
import { redis } from "../config/redis";

// SECURITY: Input sanitization utility
function sanitizeInput(input: string): string {
  return input
    .replace(/[<>\"'&]/g, '') // Remove dangerous characters
    .replace(/[^\w\s\-_.@]/g, '') // Only allow alphanumeric, spaces, and safe chars
    .trim()
    .substring(0, 100); // Limit length
}

// SECURITY: Pagination limits to prevent DoS
function enforcePaginationLimits(limit?: string, offset?: string) {
  const parsedLimit = parseInt(limit || '20');
  const parsedOffset = parseInt(offset || '0');
  
  return {
    limit: Math.min(Math.max(parsedLimit, 1), 50), // Min 1, Max 50
    offset: Math.max(parsedOffset, 0) // Min 0
  };
}

// SECURITY: Standardized error response utility
function sendErrorResponse(reply: any, code: number, message: string, details?: any) {
  return reply.code(code).send({
    success: false,
    error: {
      message,
      code: getErrorCode(code),
      timestamp: new Date().toISOString(),
      ...(details && { details })
    }
  });
}

function getErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 429: return 'RATE_LIMITED';
    case 500: return 'INTERNAL_ERROR';
    default: return 'UNKNOWN_ERROR';
  }
}

// P1: Comprehensive audit logging utility
async function logUserAudit(
  adminId: string,
  action: string,
  targetId: string | null,
  details: any,
  request: any,
  success: boolean = true,
  errorMessage?: string
) {
  try {
    // Get admin's college for audit scope
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { collegeId: true }
    });

    if (!admin?.collegeId) {
      console.warn('[AUDIT] Admin has no college association, skipping audit log');
      return;
    }

    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: 'User',
        targetId,
        details,
        ipAddress: request.ip || 'unknown',
        userAgent: request.headers['user-agent'] || 'unknown',
        collegeId: admin.collegeId,
        success,
        errorMessage
      }
    });

    console.log(`[AUDIT] ${action} by ${adminId} on ${targetId || 'N/A'}: ${success ? 'SUCCESS' : 'FAILED'}`);
  } catch (error) {
    console.error('[AUDIT] Failed to log audit entry:', error);
  }
}

// P1: Response caching utilities
async function getCachedResponse(key: string): Promise<any | null> {
  try {
    if (!redis) return null;
    
    const cached = await redis.get(key);
    if (cached) {
      console.log(`[CACHE] Hit for key: ${key}`);
      return JSON.parse(cached);
    }
    
    console.log(`[CACHE] Miss for key: ${key}`);
    return null;
  } catch (error) {
    console.error('[CACHE] Error getting cached response:', error);
    return null;
  }
}

async function setCachedResponse(key: string, data: any, ttlSeconds: number = 300): Promise<void> {
  try {
    if (!redis) return;
    
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
    console.log(`[CACHE] Set key: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error('[CACHE] Error setting cached response:', error);
  }
}

function generateCacheKey(prefix: string, params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}:${params[key]}`)
    .join('|');
  return `users:${prefix}:${sortedParams}`;
}

async function invalidateUserCaches(userId?: string, collegeId?: string): Promise<void> {
  try {
    if (!redis) return;
    
    // Invalidate search caches that might contain this user
    const patterns = [
      'users:search:*',
      'users:college:*',
      'users:discovery:*'
    ];
    
    if (collegeId) {
      patterns.push(`users:college:*collegeId:${collegeId}*`);
    }
    
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[CACHE] Invalidated ${keys.length} keys matching pattern: ${pattern}`);
      }
    }
  } catch (error) {
    console.error('[CACHE] Error invalidating caches:', error);
  }
}

const usersQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  q: z.string().optional(),
  role: z.enum(["STUDENT", "FACULTY"]).optional(),
});

async function usersRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Public: List users directory with optional filters
  f.get("/v1/users", {
    preHandler: [RateLimiters.general],
    schema: {
      tags: ["users"],
      querystring: usersQuerySchema,
      response: { 200: z.any() },
    },
  }, async (req, reply) => {
    const { limit, offset, q, role } = req.query as z.infer<typeof usersQuerySchema>;
    
    // SECURITY: Enforce pagination limits
    const { limit: safeLimit, offset: safeOffset } = enforcePaginationLimits(limit, offset);
    
    const where: any = {
      status: UserStatus.ACTIVE,
      roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
    };
    if (q) {
      // SECURITY: Sanitize search input to prevent injection attacks
      const sanitizedQuery = sanitizeInput(q);
      if (sanitizedQuery.length > 0) {
        where.OR = [
          { displayName: { contains: sanitizedQuery, mode: "insensitive" } },
          { email: { contains: sanitizedQuery, mode: "insensitive" } },
        ];
      }
    }
    if (role) {
      where.roles = { has: role };
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: safeLimit,
      skip: safeOffset,
    });

    // Transform the response to only include safe fields (NO EMAIL for public endpoint)
    const safeUsers = users.map(user => ({
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      roles: user.roles.filter(role => ['STUDENT', 'FACULTY'].includes(role)), // Only show non-admin roles
      collegeId: (user as any).collegeId,
      department: (user as any).department,
      year: (user as any).year,
      createdAt: user.createdAt,
    }));

    return reply.send({ users: safeUsers });
  });

  // Protected: Get user by ID (for inter-service communication)
  f.get("/v1/users/:userId", {
    preHandler: [authenticateUser],
    schema: {
      tags: ["users"],
      params: z.object({ userId: z.string().cuid() }),
      response: { 200: z.any(), 404: errorResponseSchema },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        avatarUrl: true,
        roles: true,
        collegeId: true,
        department: true,
        year: true,
        collegeMemberId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    return reply.send({ user });
  });

  // Protected: Update user displayName (for inter-service communication)
  f.put("/v1/users/:userId", {
    preHandler: [authenticateUser, csrfProtection],
    schema: {
      tags: ["users"],
      params: z.object({ userId: z.string().cuid() }),
      body: userUpdateBodySchema,
      response: { 
        200: z.object({ success: z.boolean(), user: z.any() }), 
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema 
      },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const { displayName, avatarUrl, collegeId, department, year } = req.body as UserUpdateBody;
    
    // CRITICAL SECURITY: Verify ownership or admin privileges
    const currentUser = (req as any).user;
    if (!currentUser) {
      return sendErrorResponse(reply, 401, "Authentication required");
    }
    
    // Only allow users to update their own profile, or admins to update any profile
    const isOwner = currentUser.id === userId;
    const isAdmin = currentUser.roles.some((role: string) => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'SUPER_ADMIN'].includes(role)
    );
    
    if (!isOwner && !isAdmin) {
      return sendErrorResponse(reply, 403, "You can only update your own profile", {
        userId,
        currentUserId: currentUser.id,
        userRoles: currentUser.roles
      });
    }
    
    const user = await userService.findUserById(userId);
    if (!user) {
      return sendErrorResponse(reply, 404, "User not found", { userId });
    }

    // Build update data object
    const updateData: any = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (collegeId !== undefined) updateData.collegeId = collegeId;
    if (department !== undefined) updateData.department = department;
    if (year !== undefined) updateData.year = year;

    try {
      const updatedUser = await userService.updateUserProfile(userId, updateData);
      
      // P1: Audit log user profile update
      await logUserAudit(
        currentUser.id,
        'UPDATE_USER_PROFILE',
        userId,
        {
          changes: updateData,
          isOwner,
          isAdmin,
          originalData: {
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            collegeId: user.collegeId,
            department: user.department,
            year: user.year
          }
        },
        req,
        true
      );

      // P1: Invalidate relevant caches
      await invalidateUserCaches(userId, updateData.collegeId || user.collegeId);

      return reply.send({ 
        success: true,
        user: updatedUser 
      });
    } catch (error) {
      // P1: Audit log failed update
      await logUserAudit(
        currentUser.id,
        'UPDATE_USER_PROFILE',
        userId,
        { changes: updateData, error: error instanceof Error ? error.message : 'Unknown error' },
        req,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      if (error instanceof Error) {
        return sendErrorResponse(reply, 400, error.message, { updateData });
      }
      
      return sendErrorResponse(reply, 500, 'Failed to update user profile');
    }
  });

  // POST /v1/users/batch - Get multiple users by IDs
  f.post('/v1/users/batch', {
    preHandler: [authenticateUser, csrfProtection],
    schema: {
      tags: ["users"],
      body: userBatchBodySchema,
      response: { 
        200: z.object({ success: z.boolean(), data: z.any() }), 
        400: errorResponseSchema 
      }
    }
  }, async (request: any, reply: any) => {
    try {
      const { userIds } = request.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return sendErrorResponse(reply, 400, 'Invalid userIds array', {
          received: typeof userIds,
          length: Array.isArray(userIds) ? userIds.length : 0
        });
      }

      const users = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          status: UserStatus.ACTIVE
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          roles: true,
          status: true,
          collegeId: true,
          department: true,
          year: true,
          collegeMemberId: true,
          createdAt: true,
          updatedAt: true,
          college: {
            select: {
              id: true,
              name: true,
              code: true
            }
          }
        }
      });

      return reply.send({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('[USERS_BATCH] Error:', error);
      return sendErrorResponse(reply, 500, 'Failed to fetch users', {
        operation: 'batch_fetch',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /v1/users/search - Search users with filters
  f.get('/v1/users/search', {
    preHandler: [RateLimiters.general],
    schema: {
      tags: ["users"],
      querystring: z.object({
        q: z.string().optional(),
        role: z.string().optional(),
        collegeId: z.string().optional(),
        department: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional()
      }),
      response: { 200: z.any(), 500: errorResponseSchema }
    }
  }, async (request: any, reply: any) => {
    try {
      const {
        q: query,
        role,
        collegeId,
        department,
        limit,
        offset
      } = request.query;

      // SECURITY: Enforce pagination limits
      const { limit: safeLimit, offset: safeOffset } = enforcePaginationLimits(limit, offset);

      // P1: Check cache first (only for non-sensitive searches)
      const cacheKey = generateCacheKey('search', {
        query: query || '',
        role: role || '',
        collegeId: collegeId || '',
        department: department || '',
        limit: safeLimit,
        offset: safeOffset
      });

      const cachedResult = await getCachedResponse(cacheKey);
      if (cachedResult) {
        return reply.send(cachedResult);
      }

      const where: any = {
        status: UserStatus.ACTIVE,
        roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
      };

      if (query) {
        // SECURITY: Sanitize and validate search input
        const sanitizedQuery = sanitizeInput(query);
        if (sanitizedQuery.length > 0) {
          // SECURITY: Only search by displayName in public endpoint (no email search)
          where.OR = [
            { displayName: { contains: sanitizedQuery, mode: 'insensitive' } }
          ];
        }
      }

      if (role) {
        where.roles = { has: role };
      }

      if (collegeId) {
        where.collegeId = collegeId;
      }

      if (department) {
        where.department = department;
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          // SECURITY: Remove email from public search endpoint
          displayName: true,
          avatarUrl: true,
          roles: true,
          status: true,
          collegeId: true,
          department: true,
          year: true,
          collegeMemberId: true,
          createdAt: true,
          updatedAt: true,
          college: {
            select: {
              id: true,
              name: true,
              code: true
            }
          }
        },
        take: safeLimit,
        skip: safeOffset,
        orderBy: [
          { displayName: 'asc' }
        ]
      });

      const response = {
        success: true,
        data: {
          users,
          pagination: {
            limit: safeLimit,
            offset: safeOffset,
            total: users.length
          }
        }
      };

      // P1: Cache the response for 5 minutes (300 seconds)
      await setCachedResponse(cacheKey, response, 300);

      return reply.send(response);
    } catch (error) {
      console.error('User search error:', error);
      return reply.code(500).send({
        message: 'Failed to search users'
      });
    }
  });

  // GET /v1/users/college/:collegeId - Get users by college
  f.get('/v1/users/college/:collegeId', {
    preHandler: [optionalAuth, RateLimiters.general],
    schema: {
      tags: ["users"],
      params: z.object({
        collegeId: z.string().cuid()
      }),
      querystring: z.object({
        department: z.string().optional(),
        role: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional()
      }),
      response: { 200: z.any(), 500: errorResponseSchema }
    }
  }, async (request: any, reply: any) => {
    try {
      const { collegeId } = request.params;
      const {
        department,
        role,
        limit,
        offset
      } = request.query;

      // SECURITY: Enforce pagination limits
      const { limit: safeLimit, offset: safeOffset } = enforcePaginationLimits(limit, offset);

      const where: any = {
        collegeId,
        status: UserStatus.ACTIVE,
        roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
      };

      if (department) {
        where.department = department;
      }

      if (role) {
        where.roles = { has: role };
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          // SECURITY: Remove email from public college endpoint
          displayName: true,
          avatarUrl: true,
          roles: true,
          status: true,
          collegeId: true,
          department: true,
          year: true,
          collegeMemberId: true,
          createdAt: true,
          updatedAt: true,
          college: {
            select: {
              id: true,
              name: true,
              code: true
            }
          }
        },
        take: safeLimit,
        skip: safeOffset,
        orderBy: [
          { department: 'asc' },
          { year: 'asc' },
          { displayName: 'asc' }
        ]
      });

      return reply.send({
        success: true,
        data: {
          users,
          collegeId,
          pagination: {
            limit: safeLimit,
            offset: safeOffset,
            total: users.length
          }
        }
      });
    } catch (error) {
      console.error('College users fetch error:', error);
      return reply.code(500).send({
        message: 'Failed to fetch college users'
      });
    }
  });

  // GET /v1/users/discovery - Instagram-like user discovery
  f.get('/v1/users/discovery', {
    preHandler: [authenticateUser, RateLimiters.general],
    schema: {
      tags: ["users"],
      querystring: z.object({
        scope: z.enum(['college', 'global', 'mixed']).optional(),
        limit: z.string().optional(),
        seed: z.string().optional()
      }),
      response: { 200: z.any(), 500: errorResponseSchema }
    }
  }, async (request: any, reply: any) => {
    try {
      const currentUserId = request.user.id;
      const {
        scope = 'mixed',
        limit = '20',
        seed
      } = request.query;

      // Get current user's college info
      const currentUser = await prisma.user.findUnique({
        where: { id: currentUserId },
        select: { collegeId: true }
      });

      let users: any[] = [];

      if (scope === 'college' && currentUser?.collegeId) {
        // College-only scope
        users = await prisma.user.findMany({
          where: {
            collegeId: currentUser.collegeId,
            id: { not: currentUserId },
            status: UserStatus.ACTIVE,
            roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            roles: true,
            status: true,
            collegeId: true,
            department: true,
            year: true,
            collegeMemberId: true,
            createdAt: true,
            updatedAt: true,
            college: {
              select: {
                id: true,
                name: true,
                code: true
              }
            }
          },
          orderBy: [
            { createdAt: 'desc' }
          ]
        });
      } else if (scope === 'global') {
        // Global scope - exclude college users
        users = await prisma.user.findMany({
          where: {
            id: { not: currentUserId },
            collegeId: currentUser?.collegeId ? { not: currentUser.collegeId } : undefined,
            status: UserStatus.ACTIVE,
            roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            roles: true,
            status: true,
            collegeId: true,
            department: true,
            year: true,
            collegeMemberId: true,
            createdAt: true,
            updatedAt: true,
            college: {
              select: {
                id: true,
                name: true,
                code: true
              }
            }
          },
          orderBy: [
            { createdAt: 'desc' }
          ]
        });
      } else {
        // Mixed scope (Instagram-like): prioritize college users, then global - only students and faculty
        const collegeUsers = currentUser?.collegeId ? await prisma.user.findMany({
          where: {
            collegeId: currentUser.collegeId,
            id: { not: currentUserId },
            status: UserStatus.ACTIVE,
            roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            roles: true,
            status: true,
            collegeId: true,
            department: true,
            year: true,
            collegeMemberId: true,
            createdAt: true,
            updatedAt: true,
            college: {
              select: {
                id: true,
                name: true,
                code: true
              }
            }
          },
          take: Math.floor(parseInt(limit) * 0.7) // 70% college users
        }) : [];

        const globalUsers = await prisma.user.findMany({
          where: {
            id: { not: currentUserId },
            collegeId: currentUser?.collegeId ? { not: currentUser.collegeId } : undefined,
            status: UserStatus.ACTIVE,
            roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            roles: true,
            status: true,
            collegeId: true,
            department: true,
            year: true,
            collegeMemberId: true,
            createdAt: true,
            updatedAt: true,
            college: {
              select: {
                id: true,
                name: true,
                code: true
              }
            }
          },
          take: parseInt(limit) - collegeUsers.length
        });

        users = [...collegeUsers, ...globalUsers];
      }

      // Shuffle users for variety (Instagram-like)
      if (seed) {
        const seedNum = parseInt(seed) || Date.now();
        users = shuffleArray(users, seedNum);
      } else {
        users = shuffleArray(users);
      }

      // Limit results
      users = users.slice(0, parseInt(limit));

      return reply.send({
        success: true,
        data: {
          users,
          scope,
          total: users.length
        }
      });
    } catch (error) {
      console.error('Discovery error:', error);
      return reply.code(500).send({
        message: 'Failed to fetch user discovery'
      });
    }
  });
}

// Utility function to shuffle array with optional seed
function shuffleArray<T>(array: T[], seed?: number): T[] {
  const shuffled = [...array];
  
  if (seed !== undefined) {
    // Seeded random shuffle for consistent results
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      const j = Math.floor((currentSeed / 233280) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } else {
    // Regular random shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  
  return shuffled;
}

export default usersRoutes;
