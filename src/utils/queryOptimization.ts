import { prisma } from '../db';
import { Logger } from './logger';

/**
 * Database query optimization utilities
 * Provides optimized queries for common operations
 */

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface UserSearchOptions extends PaginationOptions {
  q?: string;
  role?: string;
  collegeId?: string;
  department?: string;
  status?: string;
}

/**
 * Optimized user search with proper indexing
 */
export async function searchUsers(options: UserSearchOptions) {
  const {
    q,
    role,
    collegeId,
    department,
    status = 'ACTIVE',
    limit = 50,
    offset = 0
  } = options;

  // Build where clause dynamically for optimal index usage
  const where: any = {
    status: status as any
  };

  if (collegeId) {
    where.collegeId = collegeId;
  }

  if (department) {
    where.department = department;
  }

  if (role) {
    where.roles = {
      has: role
    };
  }

  // Text search using full-text search when available
  if (q) {
    where.OR = [
      {
        displayName: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        email: {
          contains: q,
          mode: 'insensitive'
        }
      }
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        collegeId: true,
        department: true,
        year: true,
        status: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: [
        { lastLoginAt: 'desc' },
        { createdAt: 'desc' }
      ],
      take: Math.min(limit, 100), // Cap at 100 for performance
      skip: offset
    }),
    prisma.user.count({ where })
  ]);

  return {
    users,
    total,
    hasMore: offset + users.length < total
  };
}

/**
 * Optimized user lookup by email (uses index)
 */
export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      roles: true,
      status: true,
      collegeId: true,
      department: true,
      year: true,
      collegeMemberId: true,
      avatarUrl: true,
      lastLoginAt: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

/**
 * Optimized active token lookup
 */
export async function findActiveRefreshToken(tokenId: string) {
  return prisma.securityToken.findFirst({
    where: {
      id: tokenId,
      type: 'REFRESH_TOKEN',
      usedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      expiresAt: true,
      usedAt: true
    }
  });
}

/**
 * Batch cleanup of expired tokens (optimized for large datasets)
 */
export async function cleanupExpiredTokens(batchSize: number = 1000) {
  const startTime = Date.now();
  let totalDeleted = 0;

  try {
    // Delete in batches to avoid long-running transactions
    while (true) {
      const result = await prisma.securityToken.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: new Date()
              }
            },
            {
              AND: [
                { usedAt: { not: null } },
                { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // Used tokens older than 7 days
              ]
            }
          ]
        }
      });

      totalDeleted += result.count;

      if (result.count < batchSize) {
        break; // No more tokens to delete
      }

      // Small delay between batches to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const duration = Date.now() - startTime;
    Logger.performance('Token cleanup completed', {
      operation: 'cleanup_expired_tokens',
      duration,
      tokensDeleted: totalDeleted
    });

    return totalDeleted;
  } catch (error) {
    Logger.error('Token cleanup failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Get user statistics with optimized queries
 */
export async function getUserStatistics(collegeId?: string) {
  const where = collegeId ? { collegeId, status: 'ACTIVE' as any } : { status: 'ACTIVE' as any };

  const [
    totalUsers,
    studentCount,
    facultyCount,
    recentLogins,
    newRegistrations
  ] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({
      where: {
        ...where,
        roles: { has: 'STUDENT' }
      }
    }),
    prisma.user.count({
      where: {
        ...where,
        roles: { has: 'FACULTY' }
      }
    }),
    prisma.user.count({
      where: {
        ...where,
        lastLoginAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    }),
    prisma.user.count({
      where: {
        ...where,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }
    })
  ]);

  return {
    totalUsers,
    studentCount,
    facultyCount,
    recentLogins,
    newRegistrations,
    activeRate: totalUsers > 0 ? (recentLogins / totalUsers) * 100 : 0
  };
}

/**
 * Optimized college lookup with user counts
 */
export async function getCollegesWithStats() {
  const colleges = await prisma.college.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      departments: true,
      isActive: true,
      _count: {
        select: {
          users: {
            where: { status: 'ACTIVE' }
          }
        }
      }
    },
    orderBy: { name: 'asc' }
  });

  return colleges.map(college => ({
    ...college,
    userCount: college._count.users
  }));
}

/**
 * Bulk user operations with transaction safety
 */
export async function bulkUpdateUsers(
  userIds: string[],
  updates: {
    status?: string;
    roles?: string[];
    collegeId?: string;
    department?: string;
  }
) {
  if (userIds.length === 0) return { updated: 0 };

  const startTime = Date.now();

  try {
    // Build update data dynamically to avoid Prisma type issues
    const updateData: any = { updatedAt: new Date() };
    
    if (updates.status) updateData.status = updates.status;
    if (updates.department) updateData.department = updates.department;
    if (updates.collegeId !== undefined) updateData.collegeId = updates.collegeId;
    
    let result;
    if (updates.roles) {
      // Handle roles separately due to array type complexity
      result = await prisma.$executeRaw`
        UPDATE "User" 
        SET roles = ${updates.roles}::text[], "updatedAt" = NOW()
        WHERE id = ANY(${userIds}::text[])
      `;
    } else {
      result = await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: updateData
      });
    }

    const duration = Date.now() - startTime;
    Logger.performance('Bulk user update completed', {
      operation: 'bulk_update_users',
      duration,
      userCount: userIds.length,
      updatedCount: typeof result === 'number' ? result : result.count
    });

    return { updated: typeof result === 'number' ? result : result.count };
  } catch (error) {
    Logger.error('Bulk user update failed', error instanceof Error ? error : new Error(String(error)), {
      userCount: userIds.length
    });
    throw error;
  }
}

/**
 * Database health check with performance metrics
 */
export async function checkDatabasePerformance() {
  const startTime = Date.now();

  try {
    // Test basic connectivity and response time
    const [userCount, tokenCount] = await Promise.all([
      prisma.user.count(),
      prisma.securityToken.count()
    ]);

    const responseTime = Date.now() - startTime;

    // Check for slow queries (this would need database-specific implementation)
    const healthStatus = {
      healthy: responseTime < 1000, // Consider healthy if under 1 second
      responseTime,
      userCount,
      tokenCount,
      timestamp: new Date().toISOString()
    };

    if (responseTime > 2000) {
      Logger.warn('Database performance degraded', {
        responseTime,
        operation: 'health_check'
      });
    }

    return healthStatus;
  } catch (error) {
    Logger.error('Database health check failed', error instanceof Error ? error : new Error(String(error)));
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Query performance monitoring decorator
 */
export function withPerformanceMonitoring<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  operationName: string
) {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;
      
      if (duration > 1000) {
        Logger.performance(`Slow query detected: ${operationName}`, {
          operation: operationName,
          duration,
          threshold: 1000
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error(`Query failed: ${operationName}`, error instanceof Error ? error : new Error(String(error)), {
        operation: operationName,
        duration
      });
      throw error;
    }
  };
}
