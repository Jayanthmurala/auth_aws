import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdminRequest } from '../middleware/adminAuth.js';
import { AdminUserService } from '../services/AdminUserService.js';
import { AdminCollegeService } from '../services/AdminCollegeService.js';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService.js';
import { AdminAuditService } from '../services/AdminAuditService.js';
import { logAdminAction } from '../middleware/auditLogger.js';
import { AdminConfirmationService } from '../services/AdminConfirmationService.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db.js';
import {
  CreateUserRequest,
  UpdateUserRequest,
  BulkUserOperation,
  AdminResponse,
  AdminUserFilters,
  PaginationParams
} from '../types/adminTypes.js';
import {
  parseAndValidateQuery,
  userFiltersQuerySchema,
  paginationQuerySchema,
  sanitizeStringInput, // CRITICAL FIX: Add input sanitization
  sanitizeEmailInput,
  sanitizeCodeInput
} from '../utils/inputValidation.js';
import {
  analyticsQuerySchema,
  auditLogsQuerySchema,
  exportQuerySchema
} from '../validators/adminAnalyticsSchemas.js';
import {
  userFiltersSchema,
  paginationSchema
} from '../validators/adminUserSchemas.js';
import {
  validateRoleEscalation,
  canManageUser,
  canAssignRoles,
  validateBulkOperationPermissions,
  logPrivilegeOperation
} from '../utils/roleHierarchy.js';
import {
  encryptExportData,
  requiresEncryption,
  generateSecureFilename,
  validateEncryptionKey,
  logEncryptionOperation,
  sanitizeExportData
} from '../utils/dataEncryption.js';
import {
  getCollegeScopedWhere,
  canAccessCollegeResource
} from '../middleware/collegeScope.js';

export class HeadAdminController {
  /**
   * Get college analytics and dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      // MEDIUM PRIORITY: Add caching for dashboard stats
      const { RedisManager } = await import('../../config/redis.js');
      const redis = RedisManager.getInstance();
      const cacheKey = `dashboard:head:${collegeId}`;

      if (!env.REDIS_DISABLED) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return reply.send(JSON.parse(cached));
        }
      }

      const [
        collegeAnalytics,
        collegeSettings,
        adminActivity
      ] = await Promise.all([
        AdminAnalyticsService.getCollegeAnalytics(collegeId),
        AdminCollegeService.getCollegeSettings(collegeId),
        AdminAnalyticsService.getAdminActivitySummary(collegeId)
      ]);

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          analytics: collegeAnalytics,
          college: collegeSettings,
          adminActivity
        }
      };

      if (!env.REDIS_DISABLED) {
        // Cache for 5 minutes
        await redis.setex(cacheKey, 300, JSON.stringify(response));
      }

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

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load dashboard'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get users with filtering and pagination (with secure input validation)
   */
  static async getUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;

      // SECURITY: Validate and sanitize query parameters
      let filters: AdminUserFilters;
      let pagination: PaginationParams;

      try {
        // Use the same schemas as the route
        const mergedSchema = userFiltersSchema.merge(paginationSchema);
        const validatedQuery = mergedSchema.parse(request.query);

        // Extract filters and pagination from merged result
        const { page, limit, sortBy, sortOrder, ...filterFields } = validatedQuery;
        filters = filterFields as AdminUserFilters;
        pagination = { page, limit, sortBy, sortOrder };
      } catch (error) {
        console.error('🚨 [HeadAdminController] Validation error:', error);
        if (error instanceof z.ZodError) {
          console.error('🚨 [HeadAdminController] Zod validation errors:', error.errors);
          const errorResponse = {
            success: false,
            message: 'Invalid query parameters',
            errors: error.errors.map((err: any) => ({
              field: err.path.join('.'),
              message: err.message
            }))
          };
          console.error('🚨 [HeadAdminController] Sending error response:', errorResponse);
          return reply.status(400).send(errorResponse);
        }
        console.error('🚨 [HeadAdminController] Non-Zod error:', error);
        throw error;
      }

      // Get college-scoped where clause
      const adminScope = getCollegeScopedWhere(request);

      const result = await AdminUserService.getUsers(filters, pagination, adminScope);

      const response: AdminResponse = {
        success: true,
        data: result.users,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch users'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get a specific user by ID
   */
  static async getUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };

      // Get college-scoped where clause
      const adminScope = getCollegeScopedWhere(request);

      const user = await AdminUserService.getUserById(userId, adminScope);

      if (!user) {
        const response: AdminResponse = {
          success: false,
          message: 'User not found'
        };
        return reply.status(404).send(response);
      }

      const response: AdminResponse = {
        success: true,
        data: user
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch user'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Create a new user with privilege escalation protection
   */
  static async createUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const userData = request.body as CreateUserRequest;

      // CRITICAL FIX: Sanitize all string inputs to prevent injection attacks
      if (userData.email) {
        userData.email = sanitizeEmailInput(userData.email);
      }
      if (userData.displayName) {
        userData.displayName = sanitizeStringInput(userData.displayName, 100);
      }
      if (userData.department) {
        userData.department = sanitizeCodeInput(userData.department);
      }
      if (userData.collegeId) {
        userData.collegeId = sanitizeCodeInput(userData.collegeId);
      }

      // CRITICAL SECURITY: Validate role assignment permissions
      if (userData.roles && userData.roles.length > 0) {
        const roleCheck = canAssignRoles(adminRequest.admin.roles, userData.roles);
        if (!roleCheck.valid) {
          await logAdminAction(
            request,
            'CREATE_USER',
            'USER',
            undefined,
            {
              userData: { ...userData, password: '[REDACTED]' },
              privilegeViolation: {
                reason: roleCheck.reason,
                invalidRoles: roleCheck.invalidRoles,
                adminRoles: adminRequest.admin.roles
              }
            },
            false,
            `Privilege escalation attempt: ${roleCheck.reason}`
          );

          return reply.status(403).send({
            success: false,
            message: roleCheck.reason,
            details: {
              invalidRoles: roleCheck.invalidRoles,
              allowedRoles: userData.roles.filter(role =>
                !roleCheck.invalidRoles?.includes(role)
              )
            }
          });
        }
      }

      const user = await AdminUserService.createUser(
        userData,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId
      );

      // Log privilege operation for audit
      if (userData.roles) {
        logPrivilegeOperation(
          adminRequest.admin.id,
          'CREATE_USER',
          user.id,
          [], // No previous roles for new user
          userData.roles,
          true
        );
      }

      await logAdminAction(
        request,
        'CREATE_USER',
        'USER',
        user.id,
        {
          userData: { ...userData, password: '[REDACTED]' },
          privilegeValidated: true
        }
      );

      const response: AdminResponse = {
        success: true,
        data: user,
        message: 'User created successfully'
      };

      return reply.status(201).send(response);
    } catch (error) {
      await logAdminAction(
        request,
        'CREATE_USER',
        'USER',
        undefined,
        { userData: request.body },
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create user'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Update a user with privilege escalation protection
   */
  static async updateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as UpdateUserRequest;

      // CRITICAL FIX: Sanitize all string inputs to prevent injection attacks
      if (updateData.email) {
        updateData.email = sanitizeEmailInput(updateData.email);
      }
      if (updateData.displayName) {
        updateData.displayName = sanitizeStringInput(updateData.displayName, 100);
      }
      if (updateData.department) {
        updateData.department = sanitizeCodeInput(updateData.department);
      }

      // CRITICAL SECURITY: Get current user data for privilege validation
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          roles: true,
          collegeId: true,
          department: true
        }
      });

      if (!currentUser) {
        return reply.status(404).send({
          success: false,
          message: 'User not found'
        });
      }

      // CRITICAL SECURITY: Validate management permissions
      const managementCheck = canManageUser(
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department,
        currentUser
      );

      if (!managementCheck.valid) {
        await logAdminAction(
          request,
          'UPDATE_USER',
          'USER',
          userId,
          {
            updateData,
            managementViolation: {
              reason: managementCheck.reason,
              adminRoles: adminRequest.admin.roles,
              targetUserRoles: currentUser.roles
            }
          },
          false,
          `Management permission denied: ${managementCheck.reason}`
        );

        return reply.status(403).send({
          success: false,
          message: managementCheck.reason
        });
      }

      // CRITICAL SECURITY: Validate role escalation if roles are being updated
      if (updateData.roles) {
        const escalationCheck = validateRoleEscalation(
          adminRequest.admin.roles,
          adminRequest.admin.id,
          userId,
          currentUser.roles,
          updateData.roles
        );

        if (!escalationCheck.valid) {
          await logAdminAction(
            request,
            'UPDATE_USER',
            'USER',
            userId,
            {
              updateData,
              escalationViolation: {
                reason: escalationCheck.reason,
                fromRoles: currentUser.roles,
                toRoles: updateData.roles,
                adminRoles: adminRequest.admin.roles
              }
            },
            false,
            `Privilege escalation blocked: ${escalationCheck.reason}`
          );

          return reply.status(403).send({
            success: false,
            message: escalationCheck.reason,
            details: {
              currentRoles: currentUser.roles,
              attemptedRoles: updateData.roles
            }
          });
        }

        // Log privilege operation for audit
        logPrivilegeOperation(
          adminRequest.admin.id,
          'UPDATE_USER',
          userId,
          currentUser.roles,
          updateData.roles,
          true
        );
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
        {
          updateData,
          privilegeValidated: true,
          managementValidated: true
        }
      );

      const response: AdminResponse = {
        success: true,
        data: user,
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
   * Delete a user (soft delete)
   */
  static async deleteUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };

      await AdminUserService.deleteUser(
        userId,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department
      );

      await logAdminAction(request, 'DELETE_USER', 'USER', userId);

      const response: AdminResponse = {
        success: true,
        message: 'User deleted successfully'
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request,
        'DELETE_USER',
        'USER',
        request.params ? (request.params as any).userId : undefined,
        undefined,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete user'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Bulk user operations with limits and confirmation
   */
  static async bulkUserOperation(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const operation = request.body as BulkUserOperation & {
        confirmationToken?: string;
      };

      // CRITICAL SECURITY: Enforce bulk operation limits
      const maxBulkSize = env.MAX_BULK_OPERATION_SIZE;
      if (operation.users.length > maxBulkSize) {
        return reply.status(400).send({
          success: false,
          message: `Maximum ${maxBulkSize} users per bulk operation. Current request: ${operation.users.length} users.`
        });
      }

      // CRITICAL SECURITY: Require confirmation for dangerous operations
      const isDangerous = ['DELETE', 'SUSPEND'].includes(operation.action) ||
        operation.users.length > 50;

      if (isDangerous && !operation.confirmationToken && !operation.preview) {
        const confirmationToken = await AdminConfirmationService.generateConfirmationToken(
          adminRequest.admin.id,
          `bulk_${operation.action}_${operation.users.length}_users`,
          {
            action: operation.action,
            userCount: operation.users.length,
            userIds: operation.users.map((u: any) => u.id).filter(Boolean)
          }
        );

        return reply.status(202).send({
          success: false,
          message: 'Confirmation required for bulk operation',
          data: {
            confirmationToken,
            requiresConfirmation: true,
            operationSummary: {
              action: operation.action,
              userCount: operation.users.length,
              estimatedTime: Math.ceil(operation.users.length / 10) + ' seconds',
              warningMessage: operation.action === 'DELETE'
                ? 'This will permanently delete user accounts. This action cannot be undone.'
                : 'This will suspend user accounts and prevent them from logging in.'
            }
          }
        });
      }

      // Verify confirmation token for dangerous operations
      if (isDangerous && !operation.preview) {
        const tokenValid = await AdminConfirmationService.verifyConfirmationToken(
          adminRequest.admin.id,
          operation.confirmationToken!
        );

        if (!tokenValid) {
          return reply.status(403).send({
            success: false,
            message: 'Invalid or expired confirmation token. Please request a new confirmation.'
          });
        }
      }

      const result = await AdminUserService.bulkOperation(
        operation,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department
      );

      await logAdminAction(
        request,
        'BULK_IMPORT',
        'USER',
        undefined,
        {
          action: operation.action,
          totalUsers: operation.users.length,
          preview: operation.preview,
          confirmed: isDangerous && !operation.preview,
          maxAllowed: maxBulkSize
        }
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: operation.preview
          ? 'Bulk operation preview completed'
          : `Bulk operation completed successfully. ${operation.users.length} users processed.`
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request,
        'BULK_IMPORT',
        'USER',
        undefined,
        { operation: request.body },
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Bulk operation failed'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Reset user password with MFA confirmation
   */
  static async resetUserPassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const { newPassword, confirmationCode } = request.body as {
        newPassword: string;
        confirmationCode?: string;
      };

      // CRITICAL SECURITY: Require MFA confirmation for password reset
      if (!confirmationCode) {
        // Generate and send MFA challenge
        const challengeId = await AdminConfirmationService.generatePasswordResetChallenge(
          adminRequest.admin.id,
          userId
        );

        return reply.status(202).send({
          success: false,
          message: 'MFA confirmation required for password reset',
          data: {
            challengeId,
            requiresMFA: true,
            instructions: 'Use the 6-digit code sent to your registered MFA method'
          }
        });
      }

      // Verify MFA confirmation
      const requestBody = request.body as { challengeId?: string };
      const verification = await AdminConfirmationService.verifyConfirmationCode(
        requestBody.challengeId || '',
        confirmationCode,
        adminRequest.admin.id
      );

      if (!verification.valid) {
        await logAdminAction(
          request,
          'PASSWORD_RESET',
          'USER',
          userId,
          { mfaFailed: true, error: verification.error },
          false,
          `MFA verification failed: ${verification.error}`
        );

        return reply.status(403).send({
          success: false,
          message: verification.error || 'MFA confirmation failed'
        });
      }

      // Proceed with password reset after MFA confirmation
      await AdminUserService.resetUserPassword(
        userId,
        newPassword,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId,
        adminRequest.admin.department
      );

      await logAdminAction(request, 'PASSWORD_RESET', 'USER', userId, {
        mfaConfirmed: true,
        challengeId: verification.challenge?.id
      });

      const response: AdminResponse = {
        success: true,
        message: 'Password reset successfully with MFA confirmation'
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request,
        'PASSWORD_RESET',
        'USER',
        request.params ? (request.params as any).userId : undefined,
        undefined,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to reset password'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Get college settings
   */
  static async getCollegeSettings(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      const settings = await AdminCollegeService.getCollegeSettings(collegeId);

      const response: AdminResponse = {
        success: true,
        data: settings
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch college settings'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Update college settings
   */
  static async updateCollegeSettings(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const updates = request.body as any;

      const settings = await AdminCollegeService.updateCollegeSettings(
        collegeId,
        updates,
        adminRequest.admin.roles
      );

      await logAdminAction(
        request,
        'UPDATE_COLLEGE',
        'COLLEGE',
        collegeId,
        { updates }
      );

      const response: AdminResponse = {
        success: true,
        data: settings,
        message: 'College settings updated successfully'
      };

      return reply.send(response);
    } catch (error) {
      await logAdminAction(
        request,
        'UPDATE_COLLEGE',
        'COLLEGE',
        (request as AdminRequest).admin.collegeId,
        { updates: request.body },
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update college settings'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Get analytics data
   */
  static async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;
      const { type, months, days } = request.query as any;

      let analyticsData;

      switch (type) {
        case 'growth':
          analyticsData = await AdminAnalyticsService.getUserGrowthAnalytics(
            collegeId,
            parseInt(months) || 12
          );
          break;
        case 'activity':
          analyticsData = await AdminAnalyticsService.getLoginActivityAnalytics(
            collegeId,
            parseInt(days) || 30
          );
          break;
        case 'departments':
          analyticsData = await AdminAnalyticsService.getDepartmentComparison(collegeId);
          break;
        default:
          analyticsData = await AdminAnalyticsService.getCollegeAnalytics(collegeId);
      }

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
   * Get audit logs
   */
  static async getAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const auditQuery = {
        collegeId: adminRequest.admin.collegeId,
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 50,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc',
        adminId: query.adminId,
        actions: query.actions ? query.actions.split(',') : undefined,
        targetTypes: query.targetTypes ? query.targetTypes.split(',') : undefined,
        success: query.success !== undefined ? query.success === 'true' : undefined,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined
      };

      const result = await AdminAuditService.getAuditLogs(auditQuery);

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
   * Export data with encryption for sensitive information
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;

      // SECURITY: Validate query parameters
      console.log('🔍 [HeadAdminController] Raw query parameters:', request.query);
      console.log('🔍 [HeadAdminController] Query parameter types:',
        Object.entries(request.query || {}).map(([key, value]) =>
          `${key}: ${typeof value} (${value})`
        )
      );

      let validatedQuery;
      try {
        validatedQuery = exportQuerySchema.parse(request.query);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            message: 'Invalid query parameters',
            errors: error.errors.map((err: any) => ({
              field: err.path.join('.'),
              message: err.message
            }))
          });
        }
        throw error;
      }

      const { type, format, encrypted, department, role, roles, status, search, year, hasNeverLoggedIn } = validatedQuery;
      const collegeId = adminRequest.admin.collegeId;

      // CRITICAL SECURITY: Validate encryption key before proceeding
      const keyValidation = validateEncryptionKey();
      if (!keyValidation.valid && requiresEncryption(type)) {
        return reply.status(500).send({
          success: false,
          message: 'Encryption configuration invalid',
          details: keyValidation.issues
        });
      }

      // SECURITY: Check if admin has permission for sensitive exports
      const sensitiveExports = ['users', 'audit'];
      if (sensitiveExports.includes(type) && !adminRequest.admin.roles.includes('HEAD_ADMIN')) {
        return reply.status(403).send({
          success: false,
          message: 'HEAD_ADMIN role required for sensitive data exports'
        });
      }

      let csvContent: string;
      let baseFilename: string;
      let recordCount = 0;

      switch (type) {
        case 'users':
          csvContent = await AdminAnalyticsService.exportAnalyticsData(
            collegeId,
            'users',
            department,
            role,
            { roles, status, search, year, hasNeverLoggedIn }
          );
          baseFilename = `users-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          recordCount = csvContent.split('\n').length - 1; // Subtract header row
          break;
        case 'departments':
          csvContent = await AdminAnalyticsService.exportAnalyticsData(collegeId, 'departments');
          baseFilename = `departments-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          recordCount = csvContent.split('\n').length - 1;
          break;
        case 'activity':
          csvContent = await AdminAnalyticsService.exportAnalyticsData(collegeId, 'activity');
          baseFilename = `activity-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          recordCount = csvContent.split('\n').length - 1;
          break;
        case 'audit':
          csvContent = await AdminAuditService.exportAuditLogs({ collegeId });
          baseFilename = `audit-logs-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          recordCount = csvContent.split('\n').length - 1;
          break;
        default:
          throw new Error('Invalid export type');
      }

      // SECURITY: Sanitize data before export/encryption
      const sanitizedContent = sanitizeExportData(csvContent, type);

      // SECURITY: Determine if encryption is required
      const shouldEncrypt = encrypted && (requiresEncryption(type) || encrypted === true);

      if (shouldEncrypt) {
        // Encrypt the data
        const encryptionResult = encryptExportData(sanitizedContent, type, recordCount);
        const secureFilename = generateSecureFilename(baseFilename, true, adminRequest.admin.id);

        // Log encryption operation
        logEncryptionOperation(
          adminRequest.admin.id,
          'encrypt',
          type,
          recordCount,
          true
        );

        await logAdminAction(
          request,
          'EXPORT_DATA',
          'DATA',
          undefined,
          {
            type,
            format,
            encrypted: true,
            recordCount,
            filename: secureFilename,
            algorithm: encryptionResult.algorithm
          }
        );

        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${secureFilename}"`);
        reply.header('X-Encryption-Method', encryptionResult.algorithm);
        reply.header('X-Encryption-KeyId', encryptionResult.keyId);
        reply.header('X-Record-Count', recordCount.toString());

        return reply.send(encryptionResult.encryptedData);
      } else {
        // Send unencrypted data
        const filename = generateSecureFilename(baseFilename, false, adminRequest.admin.id);

        await logAdminAction(
          request,
          'EXPORT_DATA',
          'DATA',
          undefined,
          {
            type,
            format,
            encrypted: false,
            recordCount,
            filename
          }
        );

        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Record-Count', recordCount.toString());

        return reply.send(sanitizedContent);
      }
    } catch (error) {
      // Log encryption failure if applicable
      const query = request.query as any;
      if (query.encrypted === 'true') {
        logEncryptionOperation(
          (request as AdminRequest).admin?.id || 'unknown',
          'encrypt',
          query.type || 'unknown',
          0,
          false,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }

      await logAdminAction(
        request,
        'EXPORT_DATA',
        'DATA',
        undefined,
        {
          type: query.type,
          format: query.format,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
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
}
