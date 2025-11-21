import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../utils/jwt.js';
import { prisma } from '../../db.js';
import { Role } from '@prisma/client';
import { AdminContext, AdminPermissions, AdminRole } from '../types/adminTypes.js';

export interface AdminRequest extends FastifyRequest {
  admin: AdminContext;
}

/**
 * Base admin authentication middleware
 * Verifies JWT token and ensures user has admin role
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7);
    const payload = await verifyAccessToken(token);

    if (!payload.sub) {
      return reply.status(401).send({
        success: false,
        message: 'Invalid token payload'
      });
    }

    // P1: Check session timeout for admin users
    const sessionTimeoutMinutes = parseInt(process.env.ADMIN_SESSION_TIMEOUT_MINUTES || '30');
    const sessionTimeoutMs = sessionTimeoutMinutes * 60 * 1000;
    const tokenIssuedAt = (payload.iat || 0) * 1000; // Convert to milliseconds
    const now = Date.now();
    
    if (now - tokenIssuedAt > sessionTimeoutMs) {
      return reply.status(401).send({
        success: false,
        message: 'Admin session expired. Please login again.',
        code: 'SESSION_EXPIRED'
      });
    }

    // Fetch user details from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        collegeId: true,
        department: true,
        status: true
      }
    });

    if (!user || user.status !== 'ACTIVE') {
      return reply.status(401).send({
        success: false,
        message: 'User not found or inactive'
      });
    }

    if (!user.collegeId) {
      return reply.status(401).send({
        success: false,
        message: 'User must be associated with a college'
      });
    }

    // Check if user has any admin role
    const hasAdminRole = user.roles.some(role => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
    );

    if (!hasAdminRole) {
      return reply.status(403).send({
        success: false,
        message: 'Admin role required'
      });
    }

    // Attach admin context to request
    (request as AdminRequest).admin = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      collegeId: user.collegeId,
      department: user.department || undefined,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    };

  } catch (error) {
    request.log.error({ error }, 'Admin auth middleware error');
    return reply.status(401).send({
      success: false,
      message: 'Invalid or expired token'
    });
  }
}

/**
 * HEAD_ADMIN specific middleware
 */
export async function requireHeadAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasHeadAdminRole = adminRequest.admin.roles.some(role => 
    ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
  );

  if (!hasHeadAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'HEAD_ADMIN or SUPER_ADMIN role required'
    });
  }
}

/**
 * DEPT_ADMIN specific middleware
 * CRITICAL FIX: Only DEPT_ADMIN and SUPER_ADMIN can access DEPT_ADMIN endpoints
 * HEAD_ADMIN should use HEAD_ADMIN endpoints instead
 */
export async function requireDeptAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasDeptAdminRole = adminRequest.admin.roles.some(role => 
    ['DEPT_ADMIN', 'SUPER_ADMIN'].includes(role) // CRITICAL FIX: Removed HEAD_ADMIN
  );

  if (!hasDeptAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'DEPT_ADMIN or SUPER_ADMIN role required'
    });
  }

  // DEPT_ADMIN must have a department assigned
  if (adminRequest.admin.roles.includes('DEPT_ADMIN' as Role) && !adminRequest.admin.department) {
    return reply.status(403).send({
      success: false,
      message: 'Department assignment required for DEPT_ADMIN'
    });
  }

  // PHASE 2: Enhanced comprehensive department scope validation
  // Check multiple sources: URL params, query, body, and resource ownership
  if (adminRequest.admin.roles.includes('DEPT_ADMIN' as Role)) {
    // Extract department from multiple sources
    const requestDept = 
      (request.params as any)?.department ||
      (request.query as any)?.department ||
      (request.body as any)?.department;
    
    // Validate department matches admin's department
    if (requestDept && requestDept !== adminRequest.admin.department) {
      return reply.status(403).send({
        success: false,
        message: 'Cannot access other departments'
      });
    }

    // PHASE 2: Validate resource ownership for single user operations
    if ((request.params as any)?.userId) {
      try {
        const targetUser = await prisma.user.findUnique({
          where: { id: (request.params as any).userId },
          select: { department: true, collegeId: true, roles: true }
        });
        
        if (!targetUser) {
          return reply.status(404).send({
            success: false,
            message: 'User not found'
          });
        }

        // Verify user is in admin's department
        if (targetUser.department !== adminRequest.admin.department) {
          return reply.status(403).send({
            success: false,
            message: 'User not in your department'
          });
        }

        // Verify admin cannot manage other admins
        const hasAdminRole = targetUser.roles.some(role => 
          ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
        );
        if (hasAdminRole) {
          return reply.status(403).send({
            success: false,
            message: 'Cannot manage admin users'
          });
        }
      } catch (error) {
        console.error('[DEPT_ADMIN_AUTH] Error validating resource ownership:', error);
        return reply.status(500).send({
          success: false,
          message: 'Internal server error'
        });
      }
    }

    // PHASE 2: Validate bulk operations - check all user IDs in request
    if ((request.body as any)?.userIds && Array.isArray((request.body as any).userIds)) {
      try {
        const userIds = (request.body as any).userIds;
        
        // Fetch all target users
        const targetUsers = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, department: true, roles: true }
        });

        // Verify all users are in admin's department
        for (const user of targetUsers) {
          if (user.department !== adminRequest.admin.department) {
            return reply.status(403).send({
              success: false,
              message: `User ${user.id} is not in your department`
            });
          }

          // Verify admin cannot manage other admins
          const hasAdminRole = user.roles.some(role => 
            ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
          );
          if (hasAdminRole) {
            return reply.status(403).send({
              success: false,
              message: `Cannot manage admin user ${user.id}`
            });
          }
        }

        // Verify all requested users were found
        if (targetUsers.length !== userIds.length) {
          return reply.status(404).send({
            success: false,
            message: 'One or more users not found'
          });
        }
      } catch (error) {
        console.error('[DEPT_ADMIN_AUTH] Error validating bulk operation:', error);
        return reply.status(500).send({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }
}

/**
 * PLACEMENTS_ADMIN specific middleware
 */
export async function requirePlacementsAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  const hasPlacementsAdminRole = adminRequest.admin.roles.some(role => 
    ['PLACEMENTS_ADMIN', 'HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
  );

  if (!hasPlacementsAdminRole) {
    return reply.status(403).send({
      success: false,
      message: 'PLACEMENTS_ADMIN, HEAD_ADMIN, or SUPER_ADMIN role required'
    });
  }
}

/**
 * Get admin permissions based on role
 */
export function getAdminPermissions(roles: Role[], department?: string): AdminPermissions {
  const isHeadAdmin = roles.includes('HEAD_ADMIN' as Role);
  const isDeptAdmin = roles.includes('DEPT_ADMIN' as Role);
  const isPlacementsAdmin = roles.includes('PLACEMENTS_ADMIN' as Role);
  const isSuperAdmin = roles.includes('SUPER_ADMIN' as Role);

  if (isSuperAdmin || isHeadAdmin) {
    return {
      canCreateUsers: true,
      canUpdateUsers: true,
      canDeleteUsers: true,
      canCreateAdmins: true,
      canManageCollege: true,
      canViewAnalytics: true,
      canExportData: true,
      canBulkImport: true,
      scope: "COLLEGE"
    };
  }

  if (isDeptAdmin) {
    return {
      canCreateUsers: true,
      canUpdateUsers: true,
      canDeleteUsers: true,
      canCreateAdmins: false,
      canManageCollege: false,
      canViewAnalytics: true,
      canExportData: true,
      canBulkImport: true,
      scope: "DEPARTMENT"
    };
  }

  if (isPlacementsAdmin) {
    return {
      canCreateUsers: true,
      canUpdateUsers: true,
      canDeleteUsers: false, // Placements admin cannot delete users
      canCreateAdmins: false,
      canManageCollege: false,
      canViewAnalytics: true,
      canExportData: true,
      canBulkImport: true,
      scope: "PLACEMENT"
    };
  }

  // Default permissions (no admin role)
  return {
    canCreateUsers: false,
    canUpdateUsers: false,
    canDeleteUsers: false,
    canCreateAdmins: false,
    canManageCollege: false,
    canViewAnalytics: false,
    canExportData: false,
    canBulkImport: false,
    scope: "COLLEGE"
  };
}

/**
 * Check if admin can perform action on target user
 */
export function canManageUser(
  adminRoles: Role[], 
  adminCollegeId: string, 
  adminDepartment: string | undefined,
  targetUser: { roles: Role[], collegeId: string | null, department: string | null }
): boolean {
  const isHeadAdmin = adminRoles.includes('HEAD_ADMIN' as Role);
  const isDeptAdmin = adminRoles.includes('DEPT_ADMIN' as Role);
  const isPlacementsAdmin = adminRoles.includes('PLACEMENTS_ADMIN' as Role);
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN' as Role);

  // SUPER_ADMIN can manage anyone
  if (isSuperAdmin) {
    return true;
  }

  // Must be in same college
  if (targetUser.collegeId !== adminCollegeId) {
    return false;
  }

  // HEAD_ADMIN can manage anyone in their college except other HEAD_ADMINs and SUPER_ADMINs
  if (isHeadAdmin) {
    const hasProtectedRole = targetUser.roles.some(role => 
      ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
    );
    return !hasProtectedRole;
  }

  // DEPT_ADMIN can only manage users in their department
  if (isDeptAdmin) {
    const hasProtectedRole = targetUser.roles.some(role => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
    );
    return !hasProtectedRole && targetUser.department === adminDepartment;
  }

  // PLACEMENTS_ADMIN can manage students in their college
  if (isPlacementsAdmin) {
    const isStudent = targetUser.roles.includes('STUDENT' as Role);
    return isStudent;
  }

  return false;
}

/**
 * Check if admin can create user with specific role
 */
export function canCreateRole(
  adminRoles: Role[], 
  targetRole: Role,
  adminCollegeId: string,
  targetCollegeId: string
): boolean {
  const isHeadAdmin = adminRoles.includes('HEAD_ADMIN' as Role);
  const isDeptAdmin = adminRoles.includes('DEPT_ADMIN' as Role);
  const isPlacementsAdmin = adminRoles.includes('PLACEMENTS_ADMIN' as Role);
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN' as Role);

  // SUPER_ADMIN can create any role
  if (isSuperAdmin) {
    return true;
  }

  // Must be in same college (except SUPER_ADMIN)
  if (adminCollegeId !== targetCollegeId) {
    return false;
  }

  // HEAD_ADMIN can create all roles except HEAD_ADMIN and SUPER_ADMIN
  if (isHeadAdmin) {
    return !['HEAD_ADMIN', 'SUPER_ADMIN'].includes(targetRole);
  }

  // DEPT_ADMIN can only create STUDENT and FACULTY
  if (isDeptAdmin) {
    return ['STUDENT', 'FACULTY'].includes(targetRole);
  }

  // PLACEMENTS_ADMIN can only create STUDENT and FACULTY
  if (isPlacementsAdmin) {
    return ['STUDENT', 'FACULTY'].includes(targetRole);
  }

  return false;
}
