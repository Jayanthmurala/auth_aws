import { prisma } from '../../db';
import { Role, UserStatus } from '@prisma/client';
import { CollegeAnalytics, DepartmentAnalytics } from '../types/adminTypes';

export class AdminAnalyticsService {
  /**
   * Get college-wide analytics for HEAD_ADMIN
   */
  static async getCollegeAnalytics(collegeId: string): Promise<CollegeAnalytics> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      usersByRole,
      usersByDepartment,
      usersByStatus,
      activeUsersLast30Days,
      newUsersThisMonth,
      college
    ] = await Promise.all([
      // Total users
      prisma.user.count({
        where: { collegeId, status: { not: 'DELETED' } }
      }),

      // Users by role
      prisma.user.groupBy({
        by: ['roles'],
        where: { collegeId, status: { not: 'DELETED' } },
        _count: { roles: true }
      }),

      // Users by department
      prisma.user.groupBy({
        by: ['department'],
        where: { 
          collegeId, 
          status: { not: 'DELETED' },
          department: { not: null }
        },
        _count: { department: true }
      }),

      // Users by status
      prisma.user.groupBy({
        by: ['status'],
        where: { collegeId },
        _count: { status: true }
      }),

      // Active users in last 30 days
      prisma.user.count({
        where: {
          collegeId,
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo }
        }
      }),

      // New users this month
      prisma.user.count({
        where: {
          collegeId,
          createdAt: { gte: startOfMonth }
        }
      }),

      // College info
      prisma.college.findUnique({
        where: { id: collegeId },
        select: { departments: true }
      })
    ]);

    // Process users by role (flatten the array structure)
    // Note: SUPER_ADMIN is excluded as they manage all colleges, not college-specific
    const roleStats: Record<string, number> = {
      STUDENT: 0,
      FACULTY: 0,
      DEPT_ADMIN: 0,
      PLACEMENTS_ADMIN: 0,
      HEAD_ADMIN: 0
    };

    usersByRole.forEach(item => {
      item.roles.forEach(role => {
        // Exclude SUPER_ADMIN from college-specific analytics
        if (role !== 'SUPER_ADMIN') {
          roleStats[role] = (roleStats[role] || 0) + item._count.roles;
        }
      });
    });

    // Process users by department
    const departmentStats: Record<string, number> = {};
    usersByDepartment.forEach(item => {
      if (item.department) {
        departmentStats[item.department] = item._count.department;
      }
    });

    // Process users by status
    const statusStats: Record<UserStatus, number> = {
      PENDING_VERIFICATION: 0,
      ACTIVE: 0,
      SUSPENDED: 0,
      DELETED: 0
    };

    usersByStatus.forEach(item => {
      statusStats[item.status] = item._count.status;
    });

    return {
      totalUsers,
      usersByRole: roleStats,
      usersByDepartment: departmentStats,
      usersByStatus: statusStats,
      activeUsersLast30Days,
      newUsersThisMonth
    };
  }

  /**
   * Get placement-specific analytics for PLACEMENTS_ADMIN
   */
  static async getPlacementStats(collegeId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalStudents,
      graduatingStudents,
      activeStudents,
      studentsByDepartment
    ] = await Promise.all([
      // Total students in college
      prisma.user.count({
        where: {
          collegeId,
          roles: { has: 'STUDENT' as Role },
          status: 'ACTIVE'
        }
      }),

      // Final year students (assuming year 4 is final year)
      prisma.user.count({
        where: {
          collegeId,
          roles: { has: 'STUDENT' as Role },
          status: 'ACTIVE',
          year: 4
        }
      }),

      // Active students (logged in last 30 days)
      prisma.user.count({
        where: {
          collegeId,
          roles: { has: 'STUDENT' as Role },
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo }
        }
      }),

      // Students by department
      prisma.user.groupBy({
        by: ['department'],
        where: {
          collegeId,
          roles: { has: 'STUDENT' as Role },
          status: 'ACTIVE',
          department: { not: null }
        },
        _count: { department: true }
      })
    ]);

    const departmentStats: Record<string, number> = {};
    studentsByDepartment.forEach(item => {
      if (item.department) {
        departmentStats[item.department] = item._count.department;
      }
    });

    return {
      totalStudents,
      graduatingStudents,
      activeStudents,
      studentsByDepartment: departmentStats,
      placementReadiness: graduatingStudents > 0 ? Math.round((activeStudents / graduatingStudents) * 100) : 0
    };
  }

  /**
   * Get department-specific analytics for DEPT_ADMIN
   */
  static async getDepartmentAnalytics(
    collegeId: string, 
    department: string
  ): Promise<DepartmentAnalytics> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalUsers,
      usersByRole,
      usersByYear,
      activeUsersLast30Days,
      facultyCount,
      studentCount
    ] = await Promise.all([
      // Total users in department
      prisma.user.count({
        where: { 
          collegeId, 
          department,
          status: { not: 'DELETED' }
        }
      }),

      // Users by role in department
      prisma.user.groupBy({
        by: ['roles'],
        where: { 
          collegeId, 
          department,
          status: { not: 'DELETED' }
        },
        _count: { roles: true }
      }),

      // Students by year
      prisma.user.groupBy({
        by: ['year'],
        where: { 
          collegeId, 
          department,
          roles: { has: 'STUDENT' as Role },
          status: { not: 'DELETED' },
          year: { not: null }
        },
        _count: { year: true }
      }),

      // Active users in last 30 days
      prisma.user.count({
        where: {
          collegeId,
          department,
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo }
        }
      }),

      // Faculty count
      prisma.user.count({
        where: {
          collegeId,
          department,
          roles: { has: 'FACULTY' as Role },
          status: 'ACTIVE'
        }
      }),

      // Student count
      prisma.user.count({
        where: {
          collegeId,
          department,
          roles: { has: 'STUDENT' as Role },
          status: 'ACTIVE'
        }
      })
    ]);

    // Process users by role
    const roleStats: Record<Role, number> = {
      STUDENT: 0,
      FACULTY: 0,
      DEPT_ADMIN: 0,
      PLACEMENTS_ADMIN: 0,
      HEAD_ADMIN: 0,
      SUPER_ADMIN: 0
    };

    usersByRole.forEach(item => {
      item.roles.forEach(role => {
        roleStats[role] = (roleStats[role] || 0) + item._count.roles;
      });
    });

    // Process students by year
    const yearStats: Record<number, number> = {};
    usersByYear.forEach(item => {
      if (item.year) {
        yearStats[item.year] = item._count.year;
      }
    });

    // Calculate faculty load (students per faculty)
    const facultyLoad = facultyCount > 0 ? Math.round(studentCount / facultyCount) : 0;

    // Calculate student participation (active vs total)
    const studentParticipation = studentCount > 0 
      ? Math.round((activeUsersLast30Days / studentCount) * 100) 
      : 0;

    return {
      departmentName: department,
      totalUsers,
      usersByRole: roleStats,
      usersByYear: yearStats,
      activeUsersLast30Days,
      facultyLoad,
      studentParticipation
    };
  }


  /**
   * Get user growth analytics
   */
  static async getUserGrowthAnalytics(collegeId: string, months: number = 12) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const userGrowth = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', "createdAt") as month,
        COUNT(*) as new_users,
        COUNT(*) FILTER (WHERE 'STUDENT' = ANY(roles)) as new_students,
        COUNT(*) FILTER (WHERE 'FACULTY' = ANY(roles)) as new_faculty
      FROM authsvc."User" 
      WHERE "collegeId" = ${collegeId} 
        AND "createdAt" >= ${startDate}
        AND status != 'DELETED'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY month ASC
    `;

    // Convert BigInt to number for JSON serialization
    return (userGrowth as any[]).map(row => ({
      ...row,
      new_users: Number(row.new_users),
      new_students: Number(row.new_students),
      new_faculty: Number(row.new_faculty)
    }));
  }

  /**
   * Get login activity analytics
   */
  static async getLoginActivityAnalytics(collegeId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const loginActivity = await prisma.$queryRaw`
      SELECT 
        DATE("lastLoginAt") as date,
        COUNT(DISTINCT id) as unique_logins,
        COUNT(DISTINCT id) FILTER (WHERE 'STUDENT' = ANY(roles)) as student_logins,
        COUNT(DISTINCT id) FILTER (WHERE 'FACULTY' = ANY(roles)) as faculty_logins
      FROM authsvc."User" 
      WHERE "collegeId" = ${collegeId} 
        AND "lastLoginAt" >= ${startDate}
        AND status = 'ACTIVE'
      GROUP BY DATE("lastLoginAt")
      ORDER BY date ASC
    `;

    // Convert BigInt to number for JSON serialization
    return (loginActivity as any[]).map(row => ({
      ...row,
      unique_logins: Number(row.unique_logins),
      student_logins: Number(row.student_logins),
      faculty_logins: Number(row.faculty_logins)
    }));
  }

  /**
   * Get department comparison analytics
   */
  static async getDepartmentComparison(collegeId: string) {
    const departmentStats = await prisma.user.groupBy({
      by: ['department'],
      where: {
        collegeId,
        status: { not: 'DELETED' },
        department: { not: null }
      },
      _count: {
        id: true
      },
      _avg: {
        year: true
      }
    });

    const departmentActivity = await Promise.all(
      departmentStats.map(async (dept) => {
        const activeUsers = await prisma.user.count({
          where: {
            collegeId,
            department: dept.department,
            status: 'ACTIVE',
            lastLoginAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
          }
        });

        return {
          department: dept.department || 'Unknown',
          totalUsers: dept._count.id,
          activeUsers,
          activityRate: activeUsers / dept._count.id, // Return as decimal (0-1), not percentage
          averageYear: dept._avg.year || undefined
        };
      })
    );

    return departmentActivity;
  }

  /**
   * Get admin activity summary for specific college
   * Excludes SUPER_ADMIN as they manage all colleges, not college-specific
   */
  static async getAdminActivitySummary(collegeId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalAdmins,
      activeAdmins,
      recentActions
    ] = await Promise.all([
      // Total admins in this college (excluding SUPER_ADMIN)
      prisma.user.count({
        where: {
          collegeId,
          roles: {
            hasSome: ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN']
          },
          status: 'ACTIVE'
        }
      }),

      // Active admins in this college (logged in last 30 days, excluding SUPER_ADMIN)
      prisma.user.count({
        where: {
          collegeId,
          roles: {
            hasSome: ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN']
          },
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo }
        }
      }),

      // Recent admin actions in this college only
      (prisma as any).adminAuditLog.count({
        where: {
          collegeId,
          createdAt: { gte: thirtyDaysAgo }
        }
      })
    ]);

    return {
      totalAdmins,
      activeAdmins,
      recentActions,
      adminActivityRate: totalAdmins > 0 ? Math.round((activeAdmins / totalAdmins) * 100) : 0
    };
  }

  /**
   * Export analytics data to CSV
   */
  static async exportAnalyticsData(
    collegeId: string,
    type: 'users' | 'departments' | 'activity',
    department?: string,
    role?: string
  ): Promise<string> {
    let data: any[] = [];
    let headers: string[] = [];

    switch (type) {
      case 'users':
        // Build scope with optional department and role filtering
        const scope: any = { 
          collegeId, 
          status: { not: 'DELETED' as UserStatus } 
        };
        
        if (department) {
          scope.department = department;
        }
        
        if (role) {
          scope.roles = { has: role };
        }

        const users = await prisma.user.findMany({
          where: scope,
          select: {
            displayName: true,
            email: true,
            collegeMemberId: true,
            roles: true,
            department: true,
            year: true,
            status: true,
            lastLoginAt: true,
            createdAt: true
          }
        });

        headers = ['Name', 'Email', 'Registration Number', 'Roles', 'Department', 'Year', 'Status', 'Last Login', 'Created At'];
        data = users.map(user => [
          user.displayName,
          user.email,
          user.collegeMemberId || '',
          user.roles.join(', '),
          user.department || '',
          user.year || '',
          user.status,
          user.lastLoginAt?.toISOString() || '',
          user.createdAt.toISOString()
        ]);
        break;

      case 'departments':
        const deptComparison = await this.getDepartmentComparison(collegeId);
        headers = ['Department', 'Total Users', 'Active Users', 'Activity Rate %', 'Average Year'];
        data = deptComparison.map(dept => [
          dept.department,
          dept.totalUsers,
          dept.activeUsers,
          Math.round(dept.activityRate * 100), // Convert back to percentage for export
          dept.averageYear?.toFixed(1) || ''
        ]);
        break;

      case 'activity':
        const loginActivity = await this.getLoginActivityAnalytics(collegeId, 30);
        headers = ['Date', 'Total Logins', 'Student Logins', 'Faculty Logins'];
        data = (loginActivity as any[]).map(activity => [
          activity.date,
          activity.unique_logins,
          activity.student_logins,
          activity.faculty_logins
        ]);
        break;
    }

    const csvContent = [
      headers.join(','),
      ...data.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  /**
   * Export filtered users data to CSV for dept admin
   */
  static async exportFilteredUsersData(
    collegeId: string,
    department: string,
    filters: {
      roles?: string[];
      status?: string[];
      search?: string;
    }
  ): Promise<string> {
    // Build where clause with filters
    const where: any = { 
      collegeId, 
      department,
      status: { not: 'DELETED' as UserStatus } 
    };
    
    // Apply role filter
    if (filters.roles && filters.roles.length > 0) {
      where.roles = { hasSome: filters.roles };
    }
    
    // Apply status filter
    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }
    
    // Apply search filter
    if (filters.search) {
      where.OR = [
        { displayName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { collegeMemberId: { contains: filters.search, mode: 'insensitive' } }
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        displayName: true,
        email: true,
        collegeMemberId: true,
        roles: true,
        department: true,
        year: true,
        status: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const headers = ['Name', 'Email', 'Registration Number', 'Roles', 'Department', 'Year', 'Status', 'Last Login', 'Created At'];
    const data = users.map(user => [
      user.displayName,
      user.email,
      user.collegeMemberId || '',
      user.roles.join(', '),
      user.department || '',
      user.year || '',
      user.status,
      user.lastLoginAt?.toISOString() || '',
      user.createdAt.toISOString()
    ]);

    const csvContent = [
      headers.join(','),
      ...data.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }
}
