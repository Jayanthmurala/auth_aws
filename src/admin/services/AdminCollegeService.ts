import { prisma } from '../../db.js';
import { Role } from '@prisma/client';

export interface UpdateCollegeRequest {
  name?: string;
  code?: string;
  location?: string;
  website?: string;
  departments?: string[];
  isActive?: boolean;
}

export interface CollegeSettings {
  id: string;
  name: string;
  code: string;
  location: string | null;
  website: string | null;
  departments: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  userCounts: {
    totalUsers: number;
    activeUsers: number;
    usersByRole: Record<Role, number>;
    usersByDepartment: Record<string, number>;
  };
}

export class AdminCollegeService {
  /**
   * Get college settings and statistics
   */
  static async getCollegeSettings(collegeId: string): Promise<CollegeSettings> {
    const [college, userCounts] = await Promise.all([
      prisma.college.findUnique({
        where: { id: collegeId }
      }),
      this.getCollegeUserCounts(collegeId)
    ]);

    if (!college) {
      throw new Error('College not found');
    }

    return {
      id: college.id,
      name: college.name,
      code: college.code,
      location: college.location,
      website: college.website,
      departments: college.departments,
      isActive: college.isActive,
      createdAt: college.createdAt,
      updatedAt: college.updatedAt,
      userCounts
    };
  }

  /**
   * Update college settings (HEAD_ADMIN only)
   */
  static async updateCollegeSettings(
    collegeId: string,
    updates: UpdateCollegeRequest,
    adminRoles: Role[]
  ): Promise<CollegeSettings> {
    // Only HEAD_ADMIN and SUPER_ADMIN can update college settings
    const canUpdate = adminRoles.some(role => ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role));
    if (!canUpdate) {
      throw new Error('Only HEAD_ADMIN or SUPER_ADMIN can update college settings');
    }

    // Validate college exists
    const existingCollege = await prisma.college.findUnique({
      where: { id: collegeId }
    });

    if (!existingCollege) {
      throw new Error('College not found');
    }

    // Check for unique constraints
    if (updates.name && updates.name !== existingCollege.name) {
      const nameExists = await prisma.college.findFirst({
        where: { 
          name: updates.name,
          id: { not: collegeId }
        }
      });
      if (nameExists) {
        throw new Error('College name already exists');
      }
    }

    if (updates.code && updates.code !== existingCollege.code) {
      const codeExists = await prisma.college.findFirst({
        where: { 
          code: updates.code,
          id: { not: collegeId }
        }
      });
      if (codeExists) {
        throw new Error('College code already exists');
      }
    }

    // If departments are being updated, validate users won't be orphaned
    if (updates.departments) {
      const removedDepartments = existingCollege.departments.filter(
        dept => !updates.departments!.includes(dept)
      );

      if (removedDepartments.length > 0) {
        const usersInRemovedDepts = await prisma.user.count({
          where: {
            collegeId,
            department: { in: removedDepartments },
            status: { not: 'DELETED' }
          }
        });

        if (usersInRemovedDepts > 0) {
          throw new Error(
            `Cannot remove departments with active users. Found ${usersInRemovedDepts} users in: ${removedDepartments.join(', ')}`
          );
        }
      }
    }

    // Update college
    const updatedCollege = await prisma.college.update({
      where: { id: collegeId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.code && { code: updates.code.toUpperCase() }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.website !== undefined && { website: updates.website }),
        ...(updates.departments && { departments: updates.departments }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive })
      }
    });

    return this.getCollegeSettings(updatedCollege.id);
  }

  /**
   * Add new department to college
   */
  static async addDepartment(
    collegeId: string,
    departmentName: string,
    adminRoles: Role[]
  ): Promise<string[]> {
    const canUpdate = adminRoles.some(role => ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role));
    if (!canUpdate) {
      throw new Error('Only HEAD_ADMIN or SUPER_ADMIN can add departments');
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId }
    });

    if (!college) {
      throw new Error('College not found');
    }

    if (college.departments.includes(departmentName)) {
      throw new Error('Department already exists');
    }

    const updatedCollege = await prisma.college.update({
      where: { id: collegeId },
      data: {
        departments: [...college.departments, departmentName]
      }
    });

    return updatedCollege.departments;
  }

  /**
   * Remove department from college
   */
  static async removeDepartment(
    collegeId: string,
    departmentName: string,
    adminRoles: Role[]
  ): Promise<string[]> {
    const canUpdate = adminRoles.some(role => ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role));
    if (!canUpdate) {
      throw new Error('Only HEAD_ADMIN or SUPER_ADMIN can remove departments');
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId }
    });

    if (!college) {
      throw new Error('College not found');
    }

    if (!college.departments.includes(departmentName)) {
      throw new Error('Department not found');
    }

    // Check if department has active users
    const usersInDept = await prisma.user.count({
      where: {
        collegeId,
        department: departmentName,
        status: { not: 'DELETED' }
      }
    });

    if (usersInDept > 0) {
      throw new Error(`Cannot remove department with ${usersInDept} active users`);
    }

    const updatedCollege = await prisma.college.update({
      where: { id: collegeId },
      data: {
        departments: college.departments.filter(dept => dept !== departmentName)
      }
    });

    return updatedCollege.departments;
  }

  /**
   * Get college user counts and statistics
   */
  private static async getCollegeUserCounts(collegeId: string) {
    const [
      totalUsers,
      activeUsers,
      usersByRole,
      usersByDepartment
    ] = await Promise.all([
      // Total users
      prisma.user.count({
        where: { 
          collegeId,
          status: { not: 'DELETED' }
        }
      }),

      // Active users
      prisma.user.count({
        where: { 
          collegeId,
          status: 'ACTIVE'
        }
      }),

      // Users by role
      prisma.user.groupBy({
        by: ['roles'],
        where: { 
          collegeId,
          status: { not: 'DELETED' }
        },
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

    // Process users by department
    const departmentStats: Record<string, number> = {};
    usersByDepartment.forEach(item => {
      if (item.department) {
        departmentStats[item.department] = item._count.department;
      }
    });

    return {
      totalUsers,
      activeUsers,
      usersByRole: roleStats,
      usersByDepartment: departmentStats
    };
  }

  /**
   * Get department details with user statistics
   */
  static async getDepartmentDetails(collegeId: string, departmentName: string) {
    const [
      college,
      departmentUsers,
      departmentStats
    ] = await Promise.all([
      prisma.college.findUnique({
        where: { id: collegeId },
        select: { departments: true }
      }),

      prisma.user.findMany({
        where: {
          collegeId,
          department: departmentName,
          status: { not: 'DELETED' }
        },
        select: {
          id: true,
          displayName: true,
          email: true,
          roles: true,
          year: true,
          status: true,
          lastLoginAt: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }),

      prisma.user.groupBy({
        by: ['roles', 'status'],
        where: {
          collegeId,
          department: departmentName,
          status: { not: 'DELETED' }
        },
        _count: { id: true }
      })
    ]);

    if (!college || !college.departments.includes(departmentName)) {
      throw new Error('Department not found in college');
    }

    // Process statistics
    const stats = {
      totalUsers: departmentUsers.length,
      activeUsers: departmentUsers.filter(u => u.status === 'ACTIVE').length,
      usersByRole: {} as Record<Role, number>,
      usersByStatus: {} as Record<string, number>
    };

    departmentStats.forEach(item => {
      item.roles.forEach(role => {
        stats.usersByRole[role] = (stats.usersByRole[role] || 0) + item._count.id;
      });
      stats.usersByStatus[item.status] = (stats.usersByStatus[item.status] || 0) + item._count.id;
    });

    return {
      departmentName,
      users: departmentUsers,
      statistics: stats
    };
  }

  /**
   * Transfer users between departments
   */
  static async transferUsersDepartment(
    collegeId: string,
    userIds: string[],
    fromDepartment: string,
    toDepartment: string,
    adminRoles: Role[]
  ): Promise<number> {
    const canTransfer = adminRoles.some(role => ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role));
    if (!canTransfer) {
      throw new Error('Only HEAD_ADMIN or SUPER_ADMIN can transfer users between departments');
    }

    // Validate college and departments
    const college = await prisma.college.findUnique({
      where: { id: collegeId }
    });

    if (!college) {
      throw new Error('College not found');
    }

    if (!college.departments.includes(fromDepartment) || !college.departments.includes(toDepartment)) {
      throw new Error('Invalid department(s)');
    }

    // Validate users exist and are in the source department
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        collegeId,
        department: fromDepartment,
        status: { not: 'DELETED' }
      }
    });

    if (users.length !== userIds.length) {
      throw new Error('Some users not found or not in source department');
    }

    // Perform transfer
    const result = await prisma.user.updateMany({
      where: {
        id: { in: userIds },
        collegeId,
        department: fromDepartment
      },
      data: {
        department: toDepartment
      }
    });

    return result.count;
  }

  /**
   * Get college activity summary
   */
  static async getCollegeActivitySummary(collegeId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      recentLogins,
      newRegistrations,
      adminActions,
      departmentActivity
    ] = await Promise.all([
      // Recent logins
      prisma.user.count({
        where: {
          collegeId,
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo }
        }
      }),

      // New registrations
      prisma.user.count({
        where: {
          collegeId,
          createdAt: { gte: thirtyDaysAgo }
        }
      }),

      // Admin actions
      (prisma as any).adminAuditLog.count({
        where: {
          collegeId,
          createdAt: { gte: thirtyDaysAgo }
        }
      }),

      // Department activity
      prisma.user.groupBy({
        by: ['department'],
        where: {
          collegeId,
          status: 'ACTIVE',
          lastLoginAt: { gte: thirtyDaysAgo },
          department: { not: null }
        },
        _count: { department: true }
      })
    ]);

    const mostActiveDepartment = departmentActivity.length > 0
      ? departmentActivity.reduce((max: any, dept: any) => 
          dept._count.department > max._count.department ? dept : max
        )
      : null;

    return {
      recentLogins,
      newRegistrations,
      adminActions,
      mostActiveDepartment: mostActiveDepartment?.department || null,
      mostActiveDepartmentCount: mostActiveDepartment?._count.department || 0
    };
  }
}
