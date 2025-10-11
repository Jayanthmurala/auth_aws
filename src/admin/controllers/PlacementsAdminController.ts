import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from '../middleware/adminAuth.js';
import { AdminUserService } from '../services/AdminUserService.js';
import { AdminAnalyticsService } from '../services/AdminAnalyticsService.js';
import { AdminAuditService } from '../services/AdminAuditService.js';
import { logAdminAction } from '../middleware/auditLogger.js';
import { 
  CreateUserRequest, 
  UpdateUserRequest, 
  AdminResponse,
  AdminUserFilters,
  PaginationParams
} from '../types/adminTypes.js';
import { getPlacementScopedWhere } from '../middleware/collegeScope.js';

export class PlacementsAdminController {
  /**
   * Get placements dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      const [
        placementStats,
        collegeAnalytics
      ] = await Promise.all([
        AdminAnalyticsService.getPlacementStats(collegeId),
        AdminAnalyticsService.getCollegeAnalytics(collegeId)
      ]);

      await logAdminAction(request, 'LOGIN', 'DASHBOARD');

      const response: AdminResponse = {
        success: true,
        data: {
          placementStats,
          studentOverview: {
            totalStudents: collegeAnalytics.usersByRole.STUDENT,
            activeStudents: collegeAnalytics.activeUsersLast30Days
          }
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

      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load dashboard'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get students with placement-focused filtering
   */
  static async getStudents(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      // Parse filters (students only with placement-focused filters)
      const filters: AdminUserFilters = {
        roles: ['STUDENT'], // Only students
        departments: query.departments ? query.departments.split(',') : undefined,
        status: query.status ? query.status.split(',') : undefined,
        year: query.year ? query.year.split(',').map(Number) : undefined,
        search: query.search,
        createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
        createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined
      };

      // Parse pagination
      const pagination: PaginationParams = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 50,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc'
      };

      // Get placement-scoped where clause (students only)
      const adminScope = getPlacementScopedWhere(request);

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
        message: error instanceof Error ? error.message : 'Failed to fetch students'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Create a new student (placement-related)
   */
  static async createStudent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const userData = request.body as CreateUserRequest;

      // Ensure PLACEMENTS_ADMIN can only create STUDENT users
      if (userData.roles[0] !== 'STUDENT') {
        const response: AdminResponse = {
          success: false,
          message: 'PLACEMENTS_ADMIN can only create STUDENT users'
        };
        return reply.status(403).send(response);
      }

      // Ensure student is created in admin's college
      userData.collegeId = adminRequest.admin.collegeId;

      const user = await AdminUserService.createUser(
        userData,
        adminRequest.admin.roles,
        adminRequest.admin.collegeId
      );

      await logAdminAction(
        request, 
        'CREATE_USER', 
        'USER', 
        user.id, 
        { userData: { ...userData, password: '[REDACTED]' } }
      );

      const response: AdminResponse = {
        success: true,
        data: user,
        message: 'Student created successfully'
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
        message: error instanceof Error ? error.message : 'Failed to create student'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Update student information (placement-related fields)
   */
  static async updateStudent(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { userId } = request.params as { userId: string };
      const updateData = request.body as UpdateUserRequest;

      // Prevent role changes
      if (updateData.roles && updateData.roles[0] !== 'STUDENT') {
        const response: AdminResponse = {
          success: false,
          message: 'PLACEMENTS_ADMIN can only manage STUDENT users'
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

      const response: AdminResponse = {
        success: true,
        data: user,
        message: 'Student updated successfully'
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
        message: error instanceof Error ? error.message : 'Failed to update student'
      };

      return reply.status(400).send(response);
    }
  }

  /**
   * Get placement statistics and analytics
   */
  static async getPlacementAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const collegeId = adminRequest.admin.collegeId;

      const [
        placementStats,
        departmentComparison
      ] = await Promise.all([
        AdminAnalyticsService.getPlacementStats(collegeId),
        AdminAnalyticsService.getDepartmentComparison(collegeId)
      ]);

      // Filter department comparison to show only student-related data
      const studentDepartmentData = departmentComparison.map((dept: any) => ({
        ...dept,
        studentCount: dept.totalUsers, // Assuming most users in departments are students
        placementReadiness: Math.round(dept.activityRate * 0.8) // Mock calculation
      }));

      const response: AdminResponse = {
        success: true,
        data: {
          placementStats,
          departmentWiseData: studentDepartmentData
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch placement analytics'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get students by placement readiness criteria
   */
  static async getStudentsByReadiness(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { readiness } = request.query as { readiness: 'ready' | 'not-ready' | 'all' };

      // This is a simplified implementation
      // In a real system, you'd have placement readiness criteria
      const filters: AdminUserFilters = {
        roles: ['STUDENT'],
        status: ['ACTIVE']
      };

      // Add readiness-based filtering logic here
      // For now, we'll filter by year (assuming final year students are more ready)
      if (readiness === 'ready') {
        filters.year = [4, 5, 6]; // Final year students
      } else if (readiness === 'not-ready') {
        filters.year = [1, 2, 3]; // Junior students
      }

      const pagination: PaginationParams = {
        page: 1,
        limit: 100,
        sortBy: 'year',
        sortOrder: 'desc'
      };

      const adminScope = getPlacementScopedWhere(request);
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
        message: error instanceof Error ? error.message : 'Failed to fetch students by readiness'
      };

      return reply.status(500).send(response);
    }
  }

  /**
   * Get placement audit logs
   */
  static async getAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const query = request.query as any;

      const auditQuery = {
        collegeId: adminRequest.admin.collegeId,
        adminId: adminRequest.admin.id, // Only show this admin's actions
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 50,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc',
        actions: query.actions ? query.actions.split(',') : undefined,
        targetTypes: ['USER'], // Only user-related actions
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
   * Export placement data
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminRequest = request as AdminRequest;
      const { type, readiness } = request.query as { type: string; readiness?: string };
      const collegeId = adminRequest.admin.collegeId;

      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'students':
          // Export students with placement focus
          csvContent = await AdminAnalyticsService.exportAnalyticsData(collegeId, 'users');
          filename = `placement-students-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'readiness':
          // Export placement readiness data
          csvContent = await AdminAnalyticsService.exportAnalyticsData(collegeId, 'departments');
          filename = `placement-readiness-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        case 'audit':
          csvContent = await AdminAuditService.exportAuditLogs({ 
            collegeId, 
            adminId: adminRequest.admin.id 
          });
          filename = `placement-audit-${collegeId}-${new Date().toISOString().split('T')[0]}.csv`;
          break;
        default:
          throw new Error('Invalid export type');
      }

      await logAdminAction(
        request, 
        'EXPORT_DATA', 
        'DATA', 
        undefined, 
        { type, readiness }
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
}
