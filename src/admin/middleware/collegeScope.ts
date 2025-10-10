import { FastifyRequest } from 'fastify';
import { AdminRequest } from './adminAuth';
import { Role } from '@prisma/client';

/**
 * Helper function to get college-scoped where clause
 */
export function getCollegeScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  return {
    ...additionalWhere,
    collegeId: adminRequest.admin.collegeId
  };
}

/**
 * Helper function to get department-scoped where clause for DEPT_ADMIN
 */
export function getDepartmentScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN' as Role);
  
  if (isDeptAdmin && adminRequest.admin.department) {
    return {
      ...additionalWhere,
      collegeId: adminRequest.admin.collegeId,
      department: adminRequest.admin.department
    };
  }
  
  // For HEAD_ADMIN and SUPER_ADMIN, return college-scoped
  return getCollegeScopedWhere(request, additionalWhere);
}

/**
 * Helper function to get placement-scoped where clause for PLACEMENTS_ADMIN
 */
export function getPlacementScopedWhere(request: FastifyRequest, additionalWhere: any = {}) {
  const adminRequest = request as AdminRequest;
  const isPlacementsAdmin = adminRequest.admin.roles.includes('PLACEMENTS_ADMIN' as Role);
  
  if (isPlacementsAdmin) {
    // Placements admin can see all students in their college
    return {
      ...additionalWhere,
      collegeId: adminRequest.admin.collegeId,
      roles: {
        has: 'STUDENT' as Role
      }
    };
  }
  
  // For HEAD_ADMIN and SUPER_ADMIN, return college-scoped
  return getCollegeScopedWhere(request, additionalWhere);
}

/**
 * Check if admin can access resource in their college
 */
export async function canAccessCollegeResource(
  request: FastifyRequest, 
  resourceCollegeId: string
): Promise<boolean> {
  const adminRequest = request as AdminRequest;
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN' as Role);
  
  // SUPER_ADMIN can access any college
  if (isSuperAdmin) {
    return true;
  }
  
  return adminRequest.admin.collegeId === resourceCollegeId;
}

/**
 * Check if admin can access resource in their department
 */
export async function canAccessDepartmentResource(
  request: FastifyRequest, 
  resourceCollegeId: string,
  resourceDepartment: string
): Promise<boolean> {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN' as Role);
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN' as Role);
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN' as Role);
  
  // SUPER_ADMIN can access any department
  if (isSuperAdmin) {
    return true;
  }
  
  // Must be in same college first
  if (!await canAccessCollegeResource(request, resourceCollegeId)) {
    return false;
  }
  
  // HEAD_ADMIN can access any department in their college
  if (isHeadAdmin) {
    return true;
  }
  
  // DEPT_ADMIN can only access their own department
  if (isDeptAdmin) {
    return adminRequest.admin.department === resourceDepartment;
  }
  
  return false;
}

/**
 * Get filtered departments based on admin scope
 */
export function getAccessibleDepartments(request: FastifyRequest, allDepartments: string[]): string[] {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN' as Role);
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN' as Role);
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN' as Role);
  
  // SUPER_ADMIN and HEAD_ADMIN can access all departments
  if (isSuperAdmin || isHeadAdmin) {
    return allDepartments;
  }
  
  // DEPT_ADMIN can only access their own department
  if (isDeptAdmin && adminRequest.admin.department) {
    return allDepartments.filter(dept => dept === adminRequest.admin.department);
  }
  
  return [];
}

/**
 * Apply role-based filtering to user queries
 */
export function applyRoleBasedFiltering(request: FastifyRequest, baseWhere: any) {
  const adminRequest = request as AdminRequest;
  const isDeptAdmin = adminRequest.admin.roles.includes('DEPT_ADMIN' as Role);
  const isPlacementsAdmin = adminRequest.admin.roles.includes('PLACEMENTS_ADMIN' as Role);
  const isHeadAdmin = adminRequest.admin.roles.includes('HEAD_ADMIN' as Role);
  const isSuperAdmin = adminRequest.admin.roles.includes('SUPER_ADMIN' as Role);
  
  // SUPER_ADMIN can see all users (no additional filtering)
  if (isSuperAdmin) {
    return baseWhere;
  }
  
  // HEAD_ADMIN can see all users in their college
  if (isHeadAdmin) {
    return getCollegeScopedWhere(request, baseWhere);
  }
  
  // DEPT_ADMIN can only see users in their department
  if (isDeptAdmin) {
    return getDepartmentScopedWhere(request, baseWhere);
  }
  
  // PLACEMENTS_ADMIN can see all students in their college
  if (isPlacementsAdmin) {
    return getPlacementScopedWhere(request, baseWhere);
  }
  
  // Default: college-scoped
  return getCollegeScopedWhere(request, baseWhere);
}

/**
 * Check admin limits for creating new admins
 */
export async function checkAdminLimits(
  collegeId: string,
  department: string | undefined,
  targetRole: Role
): Promise<{ allowed: boolean; reason?: string }> {
  const { prisma } = await import('../../db');
  
  if (targetRole === 'HEAD_ADMIN') {
    const headAdminCount = await prisma.user.count({
      where: {
        collegeId,
        roles: { has: 'HEAD_ADMIN' as Role },
        status: 'ACTIVE'
      }
    });
    
    if (headAdminCount >= 2) {
      return {
        allowed: false,
        reason: 'Maximum 2 HEAD_ADMINs allowed per college'
      };
    }
  }
  
  if (targetRole === 'DEPT_ADMIN' && department) {
    const deptAdminCount = await prisma.user.count({
      where: {
        collegeId,
        department,
        roles: { has: 'DEPT_ADMIN' as Role },
        status: 'ACTIVE'
      }
    });
    
    if (deptAdminCount >= 1) {
      return {
        allowed: false,
        reason: 'Maximum 1 DEPT_ADMIN allowed per department'
      };
    }
  }
  
  return { allowed: true };
}
