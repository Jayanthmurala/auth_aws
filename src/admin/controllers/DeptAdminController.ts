import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from '../middleware/adminAuth.js';
import { AdminUserService } from '../services/AdminUserService.js';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService.js';
import { AdminAuditService } from '../services/AdminAuditService.js';
import { logAdminAction } from '../middleware/auditLogger.js';
import { prisma } from '../../db.js';
import { 
  CreateUserRequest, 
  UpdateUserRequest, 
  AdminResponse,
  AdminUserFilters,
  PaginationParams
} from '../types/adminTypes.js';
import { getDepartmentScopedWhere } from '../middleware/collegeScope.js';
import { 
  sanitizeStringInput, // CRITICAL FIX: Add input sanitization
  sanitizeEmailInput,
  sanitizeCodeInput
} from '../utils/inputValidation.js';

// P1: Standardized error response utility
function createStandardErrorResponse(
  code: string,
  message: string,
  statusCode: number = 500,
  details?: any
): { response: AdminResponse; statusCode: number } {
  return {
    response: {
      success: false,
      message: `[${code}] ${message}`,
      errors: [message],
      ...(details && { data: details })
    },
    statusCode
  };
}

export class DeptAdminController {
  /**
   * Get department dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      const departmentAnalytics = await AdminAnalyticsService.getDepartmentAnalytics(
        collegeId, 
        department
      );

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          analytics: departmentAnalytics,
          department
        }
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request, 
        'LOGIN', 
        'DASHBOARD', 
        undefined, 
        undefined, 
        false, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      const { response, statusCode } = createStandardErrorResponse(
        'DASHBOARD_LOAD_FAILED',
        'Unable to load dashboard data',
        500,
        { operation: 'getDashboard' }
      );

      return reply.status(statusCode).send(response);
    }
  }

  /**
   * Get users in department with filtering and pagination
   */
  static async getUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      // Query is now validated by Zod schema
      const validatedQuery = request.query as any;

      const filters: AdminUserFilters = {
        roles: validatedQuery.roles,
        status: validatedQuery.status,
        year: validatedQuery.year,
        search: validatedQuery.search,
        createdAfter: validatedQuery.createdAfter,
        createdBefore: validatedQuery.createdBefore
      };

      // Parse pagination from validated query
      const pagination: PaginationParams = {
        page: validatedQuery.page || 1,
        limit: validatedQuery.limit || 50,
        sortBy: validatedQuery.sortBy || 'createdAt',
        sortOrder: validatedQuery.sortOrder || 'desc'
      };

      // Get department-scoped where clause
      const adminScope = getDepartmentScopedWhere(request);

      const result = await AdminUserService.getUsers(filters, pagination, adminScope);

      // P1: Audit log for viewing users
      await logAdminAction(
        request,
        'VIEW_USERS',
        'USER',
        undefined,
        { 
          filters,
          pagination,
          resultCount: result.users.length
        }
      );

      // Format dates properly for schema validation
      const formattedUsers = result.users.map(user => ({
        ...user,
        emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }));

      const response: AdminResponse = {
        success: true,
        data: formattedUsers,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const { response, statusCode } = createStandardErrorResponse(
        'USERS_FETCH_FAILED',
        'Unable to retrieve department users',
        500,
        { operation: 'getUsers' }
      );

      return reply.status(statusCode).send(response);
    }
  }

  /**
   * Create a new user (STUDENT or FACULTY only)
   */
  static async createUser(request: FastifyRequest, reply: FastifyReply) {
    const adminRequest = request as AdminRequest;
    
    try {
      const userData = request.body as CreateUserRequest;

      // CRITICAL FIX: Sanitize all string inputs to prevent injection attacks
      if (userData.email) {
        userData.email = sanitizeEmailInput(userData.email);
      }
      if (userData.displayName) {
        userData.displayName = sanitizeStringInput(userData.displayName, 100);
      }

      // Ensure DEPT_ADMIN can only create STUDENT or FACULTY
      if (!['STUDENT', 'FACULTY'].includes(userData.roles[0])) {
        const response: AdminResponse = {
          success: false,
          message: 'DEPT_ADMIN can only create STUDENT or FACULTY users'
        };
        return reply.status(403).send(response);
      }

      // Ensure user is created in admin's department
      userData.department = adminRequest.admin.department!;
      userData.collegeId = adminRequest.admin.collegeId;

      // P1: Use transaction for atomic user creation with audit logging
      const result = await prisma.$transaction(async (tx) => {
        const user = await AdminUserService.createUser(
          userData,
          adminRequest.admin.roles,
          adminRequest.admin.collegeId,
          tx
        );

        // Create audit log within the same transaction
        await tx.adminAuditLog.create({
          data: {
            adminId: adminRequest.admin.id,
            action: 'CREATE_USER',
            targetType: 'USER',
            targetId: user.id,
            details: { userData: { ...userData, password: '[REDACTED]' } },
            ipAddress: adminRequest.admin.ipAddress,
            userAgent: adminRequest.admin.userAgent,
            collegeId: adminRequest.admin.collegeId,
            success: true
          }
        });

        return user;
      });

      const user = result;

      // Format dates properly for schema validation
      const formattedUser = {
        ...user,
        emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      };

      const response: AdminResponse = {
        success: true,
        data: formattedUser,
        message: 'User created successfully'
      };

      return reply.status(201).send(response);
    } catch (error) {
      // P1: Log failed creation attempt
      try {
        await prisma.adminAuditLog.create({
          data: {
            adminId: adminRequest.admin.id,
            action: 'CREATE_USER',
            targetType: 'USER',
            targetId: null,
            details: { userData: request.body as any },
            ipAddress: adminRequest.admin.ipAddress,
            userAgent: adminRequest.admin.userAgent,
            collegeId: adminRequest.admin.collegeId,
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      } catch (auditError) {
        console.error('Failed to log audit entry:', auditError);
      }

      const { response, statusCode } = createStandardErrorResponse(
        'USER_CREATION_FAILED',
        error instanceof Error ? error.message : 'Failed to create user',
        400,
        { operation: 'createUser', userData: { ...(request.body as any), password: '[REDACTED]' } }
      );

      return reply.status(statusCode).send(response);
    }
  }

  /**
   * Update a user in department
   */
  static async updateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as UpdateUserRequest;

      // Prevent role changes to admin roles
      if (updateData.roles && updateData.roles.some(role => 
        !['STUDENT', 'FACULTY'].includes(role)
      )) {
        const response: AdminResponse = {
          success: false,
          message: 'DEPT_ADMIN cannot assign admin roles'
        };
        return reply.status(403).send(response);
      }

      const user = await AdminUserService.updateUser(
        userId,
        updateData,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department
      );

      await logAdminAction(
        request, 
        'UPDATE_USER', 
        'USER', 
        userId, 
        { updateData }
      );

      // Format dates properly for schema validation
      const formattedUser = {
        ...user,
        emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      };

      const response: AdminResponse = {
        success: true,
        data: formattedUser,
        message: 'User updated successfully'
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request, 
        'UPDATE_USER', 
        'USER', 
        request.params ? (request.params as any).userId : undefined, 
        { updateData: request.body }, 
        false, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update user'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Suspend/activate a user in department
   */
  static async updateUserStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const { status, confirmationToken, reason } = request.body as { 
        status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'; 
        confirmationToken?: string; 
        reason?: string; 
      };

      // P1: Validate confirmation token for sensitive operations
      if ((status === 'SUSPENDED' || status === 'DELETED') && !confirmationToken) {
        const response: AdminResponse = {
          success: false,
          message: 'Confirmation token required for user suspension or deletion'
        };
        return reply.status(400).send(response);
      }

      // P1: Validate confirmation token format (basic check)
      if (confirmationToken && confirmationToken.length < 32) {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid confirmation token format'
        };
        return reply.status(400).send(response);
      }

      const user = await AdminUserService.updateUser(
        userId,
        { status },
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department
      );

      await logAdminAction(
        request, 
        status === 'SUSPENDED' ? 'SUSPEND_USER' : status === 'DELETED' ? 'DELETE_USER' : 'ACTIVATE_USER', 
        'USER', 
        userId, 
        { 
          status, 
          reason: reason || 'No reason provided',
          confirmationProvided: !!confirmationToken 
        }
      );

      // Format dates properly for schema validation
      const formattedUser = {
        ...user,
        emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      };

      const response: AdminResponse = {
        success: true,
        data: formattedUser,
        message: `User ${status.toLowerCase()} successfully`
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request, 
        'UPDATE_USER', 
        'USER', 
        request.params ? (request.params as any).userId : undefined, 
        { status: request.body }, 
        false, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update user status'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Get department analytics
   */
  static async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      const analyticsData = await AdminAnalyticsService.getDepartmentAnalytics(
        collegeId, 
        department
      );

      // P1: Audit log for viewing analytics
      await logAdminAction(
        request,
        'VIEW_ANALYTICS',
        'ANALYTICS',
        undefined,
        { 
          department,
          dataTypes: Object.keys(analyticsData || {})
        }
      );

      const response: AdminResponse = {
        success: true,
        data: analyticsData
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch analytics'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get department audit logs
   */
  static async getAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      // Query is now validated by Zod schema
      const validatedQuery = request.query as any;

      const auditQuery = {
        collegeId: adminRequest.admin.collegeId,
        adminId: adminRequest.admin.id, // Only show this admin's actions
        page: validatedQuery.page || 1,
        limit: validatedQuery.limit || 50,
        sortBy: validatedQuery.sortBy || 'createdAt',
        sortOrder: validatedQuery.sortOrder || 'desc',
        actions: validatedQuery.actions,
        targetTypes: validatedQuery.targetTypes,
        success: validatedQuery.success,
        startDate: validatedQuery.startDate,
        endDate: validatedQuery.endDate
      };

      const result = await AdminAuditService.getAuditLogs(auditQuery);

      // P1: Audit log for viewing audit logs (meta-audit)
      await logAdminAction(
        request,
        'VIEW_AUDIT_LOGS',
        'AUDIT_LOG',
        undefined,
        { 
          query: auditQuery,
          resultCount: result.auditLogs.length
        }
      );

      const response: AdminResponse = {
        success: true,
        data: result.auditLogs,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch audit logs'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Export department data
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      // Query is now validated by Zod schema
      const validatedQuery = request.query as any;
      const { type } = validatedQuery;
      const collegeId = adminRequest.admin.collegeId;
      const department = adminRequest.admin.department!;

      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'users':
          // Use validated filters from query parameters
          const filters = {
            roles: validatedQuery.roles,
            status: validatedQuery.status,
            search: validatedQuery.search
          };

          csvContent = await AdminAnalyticsService.exportFilteredUsersData(
            collegeId, 
            department,
            filters
          );
          
          // Create descriptive filename based on filters
          const filterSuffix = [];
          if (filters.roles && filters.roles.length > 0) filterSuffix.push(`roles-${filters.roles.join('-')}`);
          if (filters.status && filters.status.length > 0) filterSuffix.push(`status-${filters.status.join('-')}`);
          if (filters.search) filterSuffix.push(`search-${filters.search.replace(/[^a-zA-Z0-9]/g, '-')}`);
          
          const suffix = filterSuffix.length > 0 ? `-${filterSuffix.join('-')}` : '';
          filename = `dept-users-${department}${suffix}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'audit':
          csvContent = await AdminAuditService.exportAuditLogs({ 
            collegeId, 
            adminId: adminRequest.admin.id 
          });
          filename = `dept-audit-${department}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        default:
          throw new Error('Invalid export type');
      }

      await logAdminAction(
        request, 
        'EXPORT_DATA', 
        'DATA', 
        undefined, 
        { type, department }
      );

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(csvContent);
    } catch (error) {
      await logAdminAction(
        request, 
        'EXPORT_DATA', 
        'DATA', 
        undefined, 
        { type: request.query }, 
        false, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to export data'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Get college departments
   */
  static async getCollegeDepartments(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      // Get departments for college

      // Get college with departments using Prisma directly
      const college = await prisma.college.findUnique({
        where: { id: collegeId },
        select: { 
          departments: true,
          name: true,
          isActive: true
        }
      });

      if (!college) {
        const response: AdminResponse = {
          success: false,
          message: 'College not found'
        };
        return reply.status(404).send(response);
      }

      if (!college.isActive) {
        const response: AdminResponse = {
          success: false,
          message: 'College is not active'
        };
        return reply.status(403).send(response);
      }

      const response: AdminResponse = {
        success: true,
        data: college.departments || []
      };

      return reply.send(response);
    } catch (error) {
      console.error('❌ Error getting college departments:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get college departments'
      };

      return reply.status(500).send(response);
    }
  }

}
