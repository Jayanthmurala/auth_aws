import { prisma } from '../../db';
import { Role, UserStatus } from '@prisma/client';
import { hashPassword } from '../../utils/crypto';
import { 
  CreateUserRequest, 
  UpdateUserRequest, 
  AdminUserFilters, 
  PaginationParams,
  BulkUserOperation,
  BulkOperationResult,
  ADMIN_LIMITS
} from '../types/adminTypes';
import { checkAdminLimits } from '../middleware/collegeScope';

export class AdminUserService {
  /**
   * Create a new user with admin permissions (with transaction support)
   */
  static async createUser(
    data: CreateUserRequest,
    adminRoles: Role[],
    adminCollegeId: string,
    tx?: any
  ): Promise<any> {
    // Auto-assign college ID from admin's college (for HEAD_ADMIN)
    // SUPER_ADMIN can still specify different college if provided
    const targetCollegeId = data.collegeId || adminCollegeId;
    
    // Validate college scope - only SUPER_ADMIN can create users in different colleges
    if (targetCollegeId !== adminCollegeId && !adminRoles.includes('SUPER_ADMIN' as Role)) {
      throw new Error('Cannot create user in different college');
    }

    // Check admin limits for admin roles
    if (['HEAD_ADMIN', 'DEPT_ADMIN'].includes(data.roles[0])) {
      const limitCheck = await checkAdminLimits(targetCollegeId, data.department, data.roles[0]);
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason);
      }
    }

    // Validate college exists and is active
    const college = await prisma.college.findUnique({
      where: { id: targetCollegeId }
    });

    if (!college || !college.isActive) {
      throw new Error('College not found or inactive');
    }

    // Validate department exists in college
    if (!college.departments.includes(data.department)) {
      throw new Error('Department not found in college');
    }

    // Hash password if provided
    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await hashPassword(data.password);
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email }
    });

    if (existingUser) {
      throw new Error(`User with email '${data.email}' already exists`);
    }

    // Check if collegeMemberId already exists in the same college
    if (data.collegeMemberId) {
      const existingMember = await prisma.user.findUnique({
        where: {
          collegeId_collegeMemberId: {
            collegeId: targetCollegeId,
            collegeMemberId: data.collegeMemberId
          }
        }
      });

      if (existingMember) {
        throw new Error(`College member ID '${data.collegeMemberId}' already exists in this college`);
      }
    }

    // P1: Use transaction for atomic user creation
    const dbClient = tx || prisma;
    
    // Create user
    const user = await dbClient.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        passwordHash,
        roles: data.roles,
        collegeId: targetCollegeId, // Use auto-assigned college ID
        department: data.department,
        year: data.year,
        collegeMemberId: data.collegeMemberId,
        status: data.status || 'ACTIVE',
        emailVerifiedAt: data.emailVerifiedAt || (data.status === 'ACTIVE' ? new Date() : null)
      },
      include: {
        college: {
          select: {
            name: true,
            code: true
          }
        }
      }
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      collegeId: user.collegeId,
      collegeName: user.college?.name,
      department: user.department,
      year: user.year,
      collegeMemberId: user.collegeMemberId,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  /**
   * Update user with admin permissions
   */
  static async updateUser(
    userId: string,
    data: UpdateUserRequest,
    adminRoles: Role[],
    adminCollegeId: string,
    adminDepartment?: string
  ): Promise<any> {
    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        college: {
          select: {
            name: true,
            code: true
          }
        }
      }
    });

    if (!existingUser) {
      throw new Error('User not found');
    }

    // Check permissions to update this user
    const canManage = this.canManageUser(
      adminRoles,
      adminCollegeId,
      adminDepartment,
      {
        roles: existingUser.roles,
        collegeId: existingUser.collegeId,
        department: existingUser.department || null
      }
    );

    if (!canManage) {
      throw new Error('Insufficient permissions to update this user');
    }

    // Validate department if being changed
    if (data.department && existingUser.collegeId) {
      const college = await prisma.college.findUnique({
        where: { id: existingUser.collegeId }
      });

      if (college && !college.departments.includes(data.department)) {
        throw new Error('Department not found in college');
      }
    }

    // Check admin limits if roles are being changed
    if (data.roles && data.roles.length > 0) {
      const newRole = data.roles[0];
      if (['HEAD_ADMIN', 'DEPT_ADMIN'].includes(newRole) && !existingUser.roles.includes(newRole as Role)) {
        const limitCheck = await checkAdminLimits(
          existingUser.collegeId!,
          data.department || existingUser.department || undefined,
          newRole as Role
        );
        if (!limitCheck.allowed) {
          throw new Error(limitCheck.reason);
        }
      }
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.email && { email: data.email }),
        ...(data.roles && { roles: data.roles }),
        ...(data.department && { department: data.department }),
        ...(data.year !== undefined && { year: data.year }),
        ...(data.collegeMemberId && { collegeMemberId: data.collegeMemberId }),
        ...(data.status && { status: data.status })
      },
      include: {
        college: {
          select: {
            name: true,
            code: true
          }
        }
      }
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      roles: updatedUser.roles,
      collegeId: updatedUser.collegeId,
      collegeName: updatedUser.college?.name,
      department: updatedUser.department,
      year: updatedUser.year,
      collegeMemberId: updatedUser.collegeMemberId,
      status: updatedUser.status,
      emailVerifiedAt: updatedUser.emailVerifiedAt,
      lastLoginAt: updatedUser.lastLoginAt,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt
    };
  }

  /**
   * Get users with filtering and pagination
   */
  static async getUsers(
    filters: AdminUserFilters,
    pagination: PaginationParams,
    adminScope: any
  ) {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100);

    // Build where clause
    const where = { ...adminScope };

    if (filters.roles && filters.roles.length > 0) {
      where.roles = { hasSome: filters.roles };
    }

    if (filters.departments && filters.departments.length > 0) {
      where.department = { in: filters.departments };
    }

    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }

    if (filters.year && filters.year.length > 0) {
      where.year = { in: filters.year };
    }

    if (filters.search) {
      where.OR = [
        { displayName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { collegeMemberId: { contains: filters.search, mode: 'insensitive' } }
      ];
    }

    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {};
      if (filters.createdAfter) where.createdAt.gte = filters.createdAfter;
      if (filters.createdBefore) where.createdAt.lte = filters.createdBefore;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          college: {
            select: {
              name: true,
              code: true
            }
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    return {
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        collegeId: user.collegeId,
        collegeName: user.college?.name,
        department: user.department,
        year: user.year,
        collegeMemberId: user.collegeMemberId,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Delete user (soft delete)
   */
  static async deleteUser(
    userId: string,
    adminRoles: Role[],
    adminCollegeId: string,
    adminDepartment?: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check permissions
    const canManage = this.canManageUser(
      adminRoles,
      adminCollegeId,
      adminDepartment,
      {
        roles: user.roles,
        collegeId: user.collegeId,
        department: user.department || null
      }
    );

    if (!canManage) {
      throw new Error('Insufficient permissions to delete this user');
    }

    // Soft delete
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletedAt: new Date()
      }
    });

    return true;
  }

  /**
   * Bulk user operations
   */
  static async bulkOperation(
    operation: BulkUserOperation,
    adminRoles: Role[],
    adminCollegeId: string,
    adminDepartment?: string
  ): Promise<BulkOperationResult> {
    if (operation.users.length > ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE) {
      throw new Error(`Maximum ${ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE} users allowed per bulk operation`);
    }

    const result: BulkOperationResult = {
      totalProcessed: operation.users.length,
      successful: 0,
      failed: 0,
      errors: [],
      preview: operation.preview
    };

    // If preview mode, validate without executing
    if (operation.preview) {
      for (let i = 0; i < operation.users.length; i++) {
        try {
          await this.validateBulkUser(operation.action, operation.users[i], adminRoles, adminCollegeId);
          result.successful++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: operation.users[i]
          });
        }
      }
      return result;
    }

    // Execute bulk operation
    for (let i = 0; i < operation.users.length; i++) {
      try {
        switch (operation.action) {
          case 'CREATE':
            await this.createUser(
              operation.users[i] as CreateUserRequest,
              adminRoles,
              adminCollegeId
            );
            break;
          case 'UPDATE':
            const updateData = operation.users[i] as UpdateUserRequest & { id: string };
            await this.updateUser(
              updateData.id,
              updateData,
              adminRoles,
              adminCollegeId,
              adminDepartment
            );
            break;
          case 'DELETE':
            const deleteData = operation.users[i] as { id: string };
            await this.deleteUser(deleteData.id, adminRoles, adminCollegeId, adminDepartment);
            break;
          case 'SUSPEND':
            const suspendData = operation.users[i] as { id: string };
            await this.updateUser(
              suspendData.id,
              { status: 'SUSPENDED' },
              adminRoles,
              adminCollegeId,
              adminDepartment
            );
            break;
          case 'ACTIVATE':
            const activateData = operation.users[i] as { id: string };
            await this.updateUser(
              activateData.id,
              { status: 'ACTIVE' },
              adminRoles,
              adminCollegeId,
              adminDepartment
            );
            break;
        }
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: operation.users[i]
        });
      }
    }

    return result;
  }

  /**
   * Validate bulk user operation
   */
  private static async validateBulkUser(
    action: string,
    userData: any,
    adminRoles: Role[],
    adminCollegeId: string
  ): Promise<void> {
    switch (action) {
      case 'CREATE':
        // Validate required fields
        if (!userData.email || !userData.displayName || !userData.collegeId) {
          throw new Error('Missing required fields: email, displayName, collegeId');
        }
        
        // Check if email already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: userData.email }
        });
        if (existingUser) {
          throw new Error(`Email ${userData.email} already exists`);
        }
        break;

      case 'UPDATE':
      case 'DELETE':
      case 'SUSPEND':
      case 'ACTIVATE':
        if (!userData.id) {
          throw new Error('Missing required field: id');
        }
        
        const user = await prisma.user.findUnique({
          where: { id: userData.id }
        });
        if (!user) {
          throw new Error(`User with id ${userData.id} not found`);
        }
        break;
    }
  }

  /**
   * Check if admin can manage user
   */
  private static canManageUser(
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
   * Reset user password
   */
  static async resetUserPassword(
    userId: string,
    newPassword: string,
    adminRoles: Role[],
    adminCollegeId: string,
    adminDepartment?: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check permissions
    const canManage = this.canManageUser(
      adminRoles,
      adminCollegeId,
      adminDepartment,
      {
        roles: user.roles,
        collegeId: user.collegeId,
        department: user.department || null
      }
    );

    if (!canManage) {
      throw new Error('Insufficient permissions to reset password for this user');
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 } // Invalidate existing tokens
      }
    });

    return true;
  }

  /**
   * Get college by ID
   */
  static async getCollegeById(collegeId: string) {
    return await prisma.college.findUnique({
      where: { id: collegeId },
      select: {
        id: true,
        name: true,
        code: true,
        departments: true,
        isActive: true
      }
    });
  }
}
