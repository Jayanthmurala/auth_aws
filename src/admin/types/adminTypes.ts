import { Role, UserStatus } from "@prisma/client";

// Admin permission levels
export type AdminRole = "HEAD_ADMIN" | "DEPT_ADMIN" | "PLACEMENTS_ADMIN";

// Admin context for requests
export interface AdminContext {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  collegeId: string;
  department?: string;
  ipAddress?: string;
  userAgent?: string;
}

// Admin limits and constraints
export interface AdminLimits {
  MAX_HEAD_ADMINS_PER_COLLEGE: number;
  MAX_DEPT_ADMINS_PER_DEPARTMENT: number;
  MAX_BULK_OPERATION_SIZE: number;
  AUDIT_LOG_RETENTION_DAYS: number;
}

export const ADMIN_LIMITS: AdminLimits = {
  MAX_HEAD_ADMINS_PER_COLLEGE: 2,
  MAX_DEPT_ADMINS_PER_DEPARTMENT: 1,
  MAX_BULK_OPERATION_SIZE: 500,
  AUDIT_LOG_RETENTION_DAYS: 730, // 2 years
};

// Permission matrix
export interface AdminPermissions {
  canCreateUsers: boolean;
  canUpdateUsers: boolean;
  canDeleteUsers: boolean;
  canCreateAdmins: boolean;
  canManageCollege: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  canBulkImport: boolean;
  scope: "COLLEGE" | "DEPARTMENT" | "PLACEMENT";
}

// User creation/update interfaces
export interface CreateUserRequest {
  displayName: string;
  email: string;
  password?: string;
  roles: Role[];
  collegeId?: string; // Optional - auto-assigned from admin's college for HEAD_ADMIN
  department: string;
  year?: number;
  collegeMemberId?: string;
  status?: UserStatus;
  emailVerifiedAt?: Date;
}

export interface UpdateUserRequest {
  displayName?: string;
  email?: string;
  roles?: Role[];
  department?: string;
  year?: number;
  collegeMemberId?: string;
  status?: UserStatus;
}

export interface BulkUserOperation {
  action: "CREATE" | "UPDATE" | "DELETE" | "SUSPEND" | "ACTIVATE";
  users: Array<CreateUserRequest | (UpdateUserRequest & { id: string })>;
  preview?: boolean;
}

// Filtering and pagination
export interface AdminUserFilters {
  roles?: Role[];
  departments?: string[];
  status?: UserStatus[];
  year?: number[];
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
  hasNeverLoggedIn?: boolean;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// Analytics interfaces
export interface CollegeAnalytics {
  totalUsers: number;
  usersByRole: Record<string, number>; // Excludes SUPER_ADMIN (college-specific only)
  usersByDepartment: Record<string, number>;
  usersByStatus: Record<UserStatus, number>;
  activeUsersLast30Days: number;
  newUsersThisMonth: number;
}

export interface DepartmentAnalytics {
  departmentName: string;
  totalUsers: number;
  usersByRole: Record<Role, number>;
  usersByYear: Record<number, number>;
  activeUsersLast30Days: number;
  facultyLoad: number;
  studentParticipation: number;
}


export type AuditAction = 
  | "CREATE_USER" | "UPDATE_USER" | "DELETE_USER" | "SUSPEND_USER" | "ACTIVATE_USER"
  | "CREATE_ADMIN" | "UPDATE_ADMIN" | "DELETE_ADMIN"
  | "UPDATE_COLLEGE" | "UPDATE_DEPARTMENT"
  | "BULK_IMPORT" | "BULK_UPDATE" | "BULK_DELETE"
  | "EXPORT_DATA" | "LOGIN" | "LOGOUT" | "PASSWORD_RESET"
  | "VIEW_USERS" | "VIEW_ANALYTICS" | "VIEW_AUDIT_LOGS"
  | "VIEW_COLLEGES" | "VIEW_COLLEGE" | "VIEW_COLLEGE_DEPARTMENTS";

export interface AuditLogEntry {
  id: string;
  adminId: string;
  admin: {
    displayName: string;
    email: string;
  };
  action: AuditAction;
  targetType: string;
  targetId?: string;
  details?: Record<string, any>;
  collegeId: string;
  success: boolean;
  errorMessage?: string;
  createdAt: Date;
}

// Response interfaces
export interface AdminResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface BulkOperationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    data?: any;
  }>;
  preview?: boolean;
}

// Confirmation requirements for sensitive operations
export interface SensitiveOperation {
  requiresConfirmation: boolean;
  confirmationMessage: string;
  operationType: "DELETE" | "ROLE_CHANGE" | "BULK_IMPORT" | "BULK_DELETE";
}
