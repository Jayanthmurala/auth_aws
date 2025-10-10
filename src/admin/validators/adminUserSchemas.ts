import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';

// Base user schemas
export const createUserSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(100, 'Display name too long'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  roles: z.array(z.enum(['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'])).min(1, 'At least one role required'),
  collegeId: z.string().cuid('Invalid college ID'),
  department: z.string().min(1, 'Department is required'),
  year: z.number().int().min(1).max(6).optional(),
  collegeMemberId: z.string().optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED']).optional().default('ACTIVE'),
  emailVerifiedAt: z.string().datetime().optional().or(z.date().optional())
});

export const updateUserSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  roles: z.array(z.enum(['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'])).min(1).optional(),
  department: z.string().min(1).optional(),
  year: z.number().int().min(1).max(6).optional(),
  collegeMemberId: z.string().optional(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED']).optional()
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED']),
  confirmationToken: z.string().min(32, 'Confirmation token required for sensitive operations').optional(),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long').optional()
}).refine((data) => {
  // Require confirmation token and reason for suspension/deletion
  if (data.status === 'SUSPENDED' || data.status === 'DELETED') {
    return data.confirmationToken && data.reason;
  }
  return true;
}, {
  message: 'Confirmation token and reason required for suspension or deletion',
  path: ['confirmationToken']
});

export const bulkUserOperationSchema = z.object({
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SUSPEND', 'ACTIVATE']),
  users: z.array(z.union([
    createUserSchema.extend({ id: z.string().cuid() }),
    createUserSchema,
    updateUserSchema.extend({ id: z.string().cuid() })
  ])).min(1, 'At least one user required').max(parseInt(process.env.MAX_BULK_OPERATION_SIZE || '100'), `Maximum ${process.env.MAX_BULK_OPERATION_SIZE || 100} users per operation`),
  preview: z.boolean().optional().default(false),
  confirmationToken: z.string().optional()
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmationCode: z.string().optional(),
  challengeId: z.string().optional()
});

// Query parameter schemas with security validation
export const userFiltersSchema = z.object({
  roles: z.string().optional().transform(val => {
    if (!val) return undefined;
    const roles = val.split(',').filter(role => ['STUDENT', 'FACULTY'].includes(role));
    return roles.length > 0 ? roles : undefined;
  }),
  departments: z.string().optional().transform(val => {
    if (!val) return undefined;
    const depts = val.split(',').map(d => d.trim()).filter(d => d.length > 0 && d.length <= 100);
    return depts.length > 0 ? depts : undefined;
  }),
  status: z.string().optional().transform(val => {
    if (!val) return undefined;
    const statuses = val.split(',').filter(status => 
      ['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].includes(status)
    );
    return statuses.length > 0 ? statuses : undefined;
  }),
  year: z.string().optional().transform(val => {
    if (!val) return undefined;
    const years = val.split(',').map(Number).filter(y => y >= 1 && y <= 6);
    return years.length > 0 ? years : undefined;
  }),
  search: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.@]*$/, 'Invalid search characters').optional(),
  createdAfter: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  createdBefore: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined)
});

export const paginationSchema = z.object({
  page: z.string().optional().transform(val => Math.max(1, parseInt(val || '1'))),
  limit: z.string().optional().transform(val => Math.min(100, Math.max(1, parseInt(val || '50')))),
  sortBy: z.enum(['createdAt', 'displayName', 'email', 'status', 'year']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

// Department admin specific validation schemas
export const deptAdminQuerySchema = z.object({
  roles: z.string().optional().transform(val => {
    if (!val) return undefined;
    const roles = val.split(',').filter(role => ['STUDENT', 'FACULTY'].includes(role));
    return roles.length > 0 ? roles : undefined;
  }),
  status: z.string().optional().transform(val => {
    if (!val) return undefined;
    const statuses = val.split(',').filter(status => 
      ['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].includes(status)
    );
    return statuses.length > 0 ? statuses : undefined;
  }),
  year: z.string().optional().transform(val => {
    if (!val) return undefined;
    const years = val.split(',').map(Number).filter(y => Number.isInteger(y) && y >= 1 && y <= 6);
    return years.length > 0 ? years : undefined;
  }),
  search: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.@]*$/, 'Search contains invalid characters').optional(),
  createdAfter: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  createdBefore: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  page: z.string().optional().transform(val => Math.max(1, parseInt(val || '1'))),
  limit: z.string().optional().transform(val => Math.min(100, Math.max(1, parseInt(val || '50')))),
  sortBy: z.enum(['createdAt', 'displayName', 'email', 'status', 'year']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

// Export query schema for audit logs
export const auditLogsQuerySchema = z.object({
  page: z.string().optional().transform(val => Math.max(1, parseInt(val || '1'))),
  limit: z.string().optional().transform(val => Math.min(100, Math.max(1, parseInt(val || '50')))),
  sortBy: z.enum(['createdAt', 'action', 'targetType']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  actions: z.string().optional().transform(val => {
    if (!val) return undefined;
    const validActions = ['CREATE_USER', 'UPDATE_USER', 'SUSPEND_USER', 'ACTIVATE_USER', 'EXPORT_DATA'];
    const actions = val.split(',').filter(action => validActions.includes(action));
    return actions.length > 0 ? actions : undefined;
  }),
  targetTypes: z.string().optional().transform(val => {
    if (!val) return undefined;
    const validTypes = ['USER', 'DATA'];
    const types = val.split(',').filter(type => validTypes.includes(type));
    return types.length > 0 ? types : undefined;
  }),
  success: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  startDate: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  endDate: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined)
});

// Export query schema
export const exportQuerySchema = z.object({
  type: z.enum(['users', 'audit'], { message: 'Export type must be users or audit' }),
  roles: z.string().optional().transform(val => {
    if (!val) return undefined;
    const roles = val.split(',').filter(role => ['STUDENT', 'FACULTY'].includes(role));
    return roles.length > 0 ? roles : undefined;
  }),
  status: z.string().optional().transform(val => {
    if (!val) return undefined;
    const statuses = val.split(',').filter(status => 
      ['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].includes(status)
    );
    return statuses.length > 0 ? statuses : undefined;
  }),
  search: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.@]*$/, 'Search contains invalid characters').optional()
});

// Route parameter schemas
export const userParamsSchema = z.object({
  userId: z.string().min(1, 'User ID is required')
});

// HEAD_ADMIN specific schemas - collegeId is auto-assigned from admin's college
export const headAdminCreateUserSchema = createUserSchema.omit({ collegeId: true });

export const headAdminUpdateUserSchema = updateUserSchema;

// DEPT_ADMIN specific schemas (restricted roles) - collegeId and department auto-assigned from admin's context
export const deptAdminCreateUserSchema = createUserSchema.omit({ collegeId: true, department: true }).extend({
  roles: z.array(z.enum(['STUDENT', 'FACULTY'])).min(1, 'DEPT_ADMIN can only create STUDENT or FACULTY users')
});

export const deptAdminUpdateUserSchema = updateUserSchema.extend({
  roles: z.array(z.enum(['STUDENT', 'FACULTY'])).min(1).optional()
});

// PLACEMENTS_ADMIN specific schemas (students only)
export const placementsAdminCreateUserSchema = createUserSchema.extend({
  roles: z.array(z.literal('STUDENT')).min(1, 'PLACEMENTS_ADMIN can only create STUDENT users')
});

export const placementsAdminUpdateUserSchema = updateUserSchema.extend({
  roles: z.array(z.literal('STUDENT')).min(1).optional()
});


// Response schemas
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(z.string()),
  collegeId: z.string(),
  collegeName: z.string().optional(),
  department: z.string().optional().nullable(),
  year: z.number().optional().nullable(),
  collegeMemberId: z.string().optional().nullable(),
  status: z.string(),
  emailVerifiedAt: z.string().datetime().optional().nullable().or(z.date().optional().nullable()),
  lastLoginAt: z.string().datetime().optional().nullable().or(z.date().optional().nullable()),
  createdAt: z.string().datetime().or(z.date()),
  updatedAt: z.string().datetime().or(z.date())
});

// Single user response (wrapped in AdminResponse format)
export const createUserResponseSchema = z.object({
  success: z.boolean(),
  data: userResponseSchema,
  message: z.string().optional()
});

export const usersListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(userResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional(),
  message: z.string().optional()
});

export const bulkOperationResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    totalProcessed: z.number(),
    successful: z.number(),
    failed: z.number(),
    errors: z.array(z.object({
      index: z.number(),
      error: z.string(),
      data: z.any().optional()
    })),
    preview: z.boolean().optional()
  }),
  message: z.string().optional()
});

// Error response schema
export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
