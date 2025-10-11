import { Prisma, Role, UserStatus } from "@prisma/client";
import { prisma } from "../db.js";

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function createUser(input: { email: string; passwordHash?: string | null; displayName: string; avatarUrl?: string | null; roles?: Role[]; status?: UserStatus; }) {
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash ?? null,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      roles: input.roles ?? [Role.STUDENT],
      status: input.status ?? UserStatus.PENDING_VERIFICATION,
    },
  });
}

export async function markLogin(userId: string) {
  return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export async function incrementTokenVersion(userId: string) {
  return prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

// P1: Enhanced user service layer with business logic
export async function searchUsers(filters: {
  query?: string;
  role?: Role;
  collegeId?: string;
  department?: string;
  limit: number;
  offset: number;
}) {
  const where: any = {
    status: UserStatus.ACTIVE,
    roles: { hasSome: [Role.STUDENT, Role.FACULTY] }
  };

  if (filters.query) {
    where.OR = [
      { displayName: { contains: filters.query, mode: 'insensitive' } }
    ];
  }

  if (filters.role) {
    where.roles = { has: filters.role };
  }

  if (filters.collegeId) {
    where.collegeId = filters.collegeId;
  }

  if (filters.department) {
    where.department = filters.department;
  }

  return prisma.user.findMany({
    where,
    select: {
      id: true,
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
    take: filters.limit,
    skip: filters.offset,
    orderBy: [
      { displayName: 'asc' }
    ]
  });
}

export async function updateUserProfile(
  userId: string,
  updateData: {
    displayName?: string;
    avatarUrl?: string;
    collegeId?: string;
    department?: string;
    year?: number;
  }
) {
  // Validate college if provided
  if (updateData.collegeId) {
    const college = await prisma.college.findUnique({ 
      where: { id: updateData.collegeId } 
    });
    
    if (!college || !college.isActive) {
      throw new Error('Invalid or inactive college');
    }
    
    // Validate department exists in college
    if (updateData.department && !college.departments.includes(updateData.department)) {
      throw new Error(`Department '${updateData.department}' not available in '${college.name}'`);
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
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
      updatedAt: true,
    },
  });
}

export async function getUsersByIds(userIds: string[]) {
  return prisma.user.findMany({
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
}
