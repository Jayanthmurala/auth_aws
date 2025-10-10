import { Role } from '@prisma/client';

/**
 * Role Hierarchy and Privilege Escalation Protection
 * Implements strict role hierarchy validation for admin operations
 */

// Role hierarchy levels (higher number = higher privilege)
export const ROLE_HIERARCHY: Record<Role, number> = {
  'STUDENT': 1,
  'FACULTY': 2,
  'PLACEMENTS_ADMIN': 3,
  'DEPT_ADMIN': 4,
  'HEAD_ADMIN': 5,
  'SUPER_ADMIN': 6
};

// Role creation permissions matrix
export const ROLE_CREATION_PERMISSIONS: Record<Role, Role[]> = {
  'STUDENT': [], // Students cannot create any roles
  'FACULTY': [], // Faculty cannot create any roles
  'PLACEMENTS_ADMIN': ['STUDENT'], // Can only create students
  'DEPT_ADMIN': ['STUDENT', 'FACULTY'], // Can create students and faculty
  'HEAD_ADMIN': ['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN'], // Cannot create other HEAD_ADMINs
  'SUPER_ADMIN': ['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'] // Can create all except SUPER_ADMIN
};

/**
 * Get the highest privilege level from a list of roles
 */
export function getMaxPrivilegeLevel(roles: Role[]): number {
  return Math.max(...roles.map(role => ROLE_HIERARCHY[role] || 0));
}

/**
 * Check if admin can assign specific roles to a user
 */
export function canAssignRoles(
  adminRoles: Role[],
  targetRoles: Role[]
): { valid: boolean; reason?: string; invalidRoles?: Role[] } {
  
  const adminMaxPrivilege = getMaxPrivilegeLevel(adminRoles);
  const targetMaxPrivilege = getMaxPrivilegeLevel(targetRoles);
  
  // Admin cannot assign roles equal or higher than their own privilege level
  if (targetMaxPrivilege >= adminMaxPrivilege) {
    const invalidRoles = targetRoles.filter(role => 
      ROLE_HIERARCHY[role] >= adminMaxPrivilege
    );
    
    return {
      valid: false,
      reason: `Cannot assign roles equal or higher than your privilege level (${adminMaxPrivilege})`,
      invalidRoles
    };
  }

  // Check each role against creation permissions
  const adminHighestRole = adminRoles.find(role => 
    ROLE_HIERARCHY[role] === adminMaxPrivilege
  ) as Role;
  
  const allowedRoles = ROLE_CREATION_PERMISSIONS[adminHighestRole] || [];
  const invalidRoles = targetRoles.filter(role => !allowedRoles.includes(role));
  
  if (invalidRoles.length > 0) {
    return {
      valid: false,
      reason: `Your role (${adminHighestRole}) cannot assign these roles: ${invalidRoles.join(', ')}`,
      invalidRoles
    };
  }

  return { valid: true };
}

/**
 * Validate role escalation for user updates
 */
export function validateRoleEscalation(
  adminRoles: Role[],
  adminId: string,
  targetUserId: string,
  currentUserRoles: Role[],
  newRoles: Role[]
): { valid: boolean; reason?: string } {
  
  // Prevent self-role modification
  if (adminId === targetUserId) {
    return { 
      valid: false, 
      reason: 'Cannot modify your own roles. Contact another admin for role changes.' 
    };
  }

  // Check if admin can assign the new roles
  const assignmentCheck = canAssignRoles(adminRoles, newRoles);
  if (!assignmentCheck.valid) {
    return assignmentCheck;
  }

  // Additional check: prevent creating multiple HEAD_ADMINs without SUPER_ADMIN
  const hasHeadAdmin = newRoles.includes('HEAD_ADMIN');
  const isSuperAdmin = adminRoles.includes('SUPER_ADMIN');
  
  if (hasHeadAdmin && !isSuperAdmin) {
    return {
      valid: false,
      reason: 'Only SUPER_ADMIN can create HEAD_ADMIN users'
    };
  }

  // Check if trying to escalate beyond current user's level
  const currentMaxPrivilege = getMaxPrivilegeLevel(currentUserRoles);
  const newMaxPrivilege = getMaxPrivilegeLevel(newRoles);
  const adminMaxPrivilege = getMaxPrivilegeLevel(adminRoles);

  // If escalating privilege, ensure admin has sufficient privilege
  if (newMaxPrivilege > currentMaxPrivilege && newMaxPrivilege >= adminMaxPrivilege) {
    return {
      valid: false,
      reason: 'Cannot escalate user privileges to or above your own level'
    };
  }

  return { valid: true };
}

/**
 * Check if admin can manage a specific user
 */
export function canManageUser(
  adminRoles: Role[],
  adminCollegeId: string,
  adminDepartment: string | undefined,
  targetUser: {
    id: string;
    roles: Role[];
    collegeId: string | null;
    department: string | null;
  }
): { valid: boolean; reason?: string } {
  
  const adminMaxPrivilege = getMaxPrivilegeLevel(adminRoles);
  const targetMaxPrivilege = getMaxPrivilegeLevel(targetUser.roles);
  
  // SUPER_ADMIN can manage anyone
  if (adminRoles.includes('SUPER_ADMIN')) {
    return { valid: true };
  }

  // Must be in same college (except SUPER_ADMIN)
  if (targetUser.collegeId !== adminCollegeId) {
    return {
      valid: false,
      reason: 'Can only manage users within your college'
    };
  }

  // HEAD_ADMIN can manage anyone in their college except other HEAD_ADMINs and SUPER_ADMINs
  if (adminRoles.includes('HEAD_ADMIN')) {
    const hasProtectedRole = targetUser.roles.some(role => 
      ['HEAD_ADMIN', 'SUPER_ADMIN'].includes(role)
    );
    
    if (hasProtectedRole) {
      return {
        valid: false,
        reason: 'Cannot manage other HEAD_ADMIN or SUPER_ADMIN users'
      };
    }
    
    return { valid: true };
  }

  // DEPT_ADMIN can only manage users in their department
  if (adminRoles.includes('DEPT_ADMIN')) {
    if (!adminDepartment) {
      return {
        valid: false,
        reason: 'Department assignment required for DEPT_ADMIN operations'
      };
    }
    
    if (targetUser.department !== adminDepartment) {
      return {
        valid: false,
        reason: 'Can only manage users within your department'
      };
    }
    
    const hasProtectedRole = targetUser.roles.some(role => 
      ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role)
    );
    
    if (hasProtectedRole) {
      return {
        valid: false,
        reason: 'Cannot manage admin users'
      };
    }
    
    return { valid: true };
  }

  // PLACEMENTS_ADMIN can manage students in their college
  if (adminRoles.includes('PLACEMENTS_ADMIN')) {
    const isStudent = targetUser.roles.includes('STUDENT');
    
    if (!isStudent) {
      return {
        valid: false,
        reason: 'PLACEMENTS_ADMIN can only manage students'
      };
    }
    
    return { valid: true };
  }

  return {
    valid: false,
    reason: 'Insufficient privileges to manage this user'
  };
}

/**
 * Get allowed roles for creation based on admin privileges
 */
export function getAllowedRolesForCreation(adminRoles: Role[]): Role[] {
  const adminMaxPrivilege = getMaxPrivilegeLevel(adminRoles);
  const adminHighestRole = adminRoles.find(role => 
    ROLE_HIERARCHY[role] === adminMaxPrivilege
  ) as Role;
  
  return ROLE_CREATION_PERMISSIONS[adminHighestRole] || [];
}

/**
 * Validate bulk operation permissions
 */
export function validateBulkOperationPermissions(
  adminRoles: Role[],
  operation: string,
  users: Array<{ id?: string; roles?: Role[] }>
): { valid: boolean; reason?: string; invalidUsers?: number[] } {
  
  const invalidUsers: number[] = [];
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    if (operation === 'CREATE' && user.roles) {
      const assignmentCheck = canAssignRoles(adminRoles, user.roles);
      if (!assignmentCheck.valid) {
        invalidUsers.push(i);
      }
    }
    
    // Additional validations for UPDATE and DELETE operations would go here
    // when we have access to existing user data
  }
  
  if (invalidUsers.length > 0) {
    return {
      valid: false,
      reason: `Invalid role assignments for users at positions: ${invalidUsers.join(', ')}`,
      invalidUsers
    };
  }
  
  return { valid: true };
}

/**
 * Security audit log for privilege operations
 */
export function logPrivilegeOperation(
  adminId: string,
  operation: string,
  targetUserId: string,
  fromRoles: Role[],
  toRoles: Role[],
  success: boolean,
  reason?: string
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    adminId,
    operation,
    targetUserId,
    privilegeChange: {
      from: fromRoles,
      to: toRoles,
      escalation: getMaxPrivilegeLevel(toRoles) > getMaxPrivilegeLevel(fromRoles)
    },
    success,
    reason,
    riskLevel: getMaxPrivilegeLevel(toRoles) >= 4 ? 'HIGH' : 'MEDIUM'
  };
  
  console.log(`[PRIVILEGE_AUDIT] ${JSON.stringify(logEntry)}`);
  
  // In production, this should be sent to a secure audit logging service
  return logEntry;
}
