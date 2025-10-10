import { z } from 'zod';

// College management schemas
export const updateCollegeSchema = z.object({
  name: z.string().min(1, 'College name is required').max(200, 'College name too long').optional(),
  code: z.string().min(2, 'College code must be at least 2 characters').max(10, 'College code too long').optional(),
  location: z.string().max(200, 'Location too long').optional(),
  website: z.string().url('Invalid website URL').optional(),
  departments: z.array(z.string().min(1, 'Department name cannot be empty')).min(1, 'At least one department required').optional(),
  isActive: z.boolean().optional()
});

export const addDepartmentSchema = z.object({
  departmentName: z.string().min(1, 'Department name is required').max(100, 'Department name too long')
});

export const removeDepartmentSchema = z.object({
  departmentName: z.string().min(1, 'Department name is required')
});

export const transferUsersSchema = z.object({
  userIds: z.array(z.string().cuid('Invalid user ID')).min(1, 'At least one user required').max(100, 'Maximum 100 users per transfer'),
  fromDepartment: z.string().min(1, 'Source department is required'),
  toDepartment: z.string().min(1, 'Target department is required')
});

// Department details schema
export const departmentParamsSchema = z.object({
  departmentName: z.string().min(1, 'Department name is required')
});

// College settings response schema
export const collegeSettingsResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  location: z.string().nullable(),
  website: z.string().nullable(),
  departments: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string().datetime().or(z.date()),
  updatedAt: z.string().datetime().or(z.date()),
  userCounts: z.object({
    totalUsers: z.number(),
    activeUsers: z.number(),
    usersByRole: z.record(z.string(), z.number()),
    usersByDepartment: z.record(z.string(), z.number())
  })
});

// Department details response schema
export const departmentDetailsResponseSchema = z.object({
  departmentName: z.string(),
  users: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    email: z.string(),
    roles: z.array(z.string()),
    year: z.number().nullable(),
    status: z.string(),
    lastLoginAt: z.string().datetime().nullable().or(z.date().nullable()),
    createdAt: z.string().datetime().or(z.date())
  })),
  statistics: z.object({
    totalUsers: z.number(),
    activeUsers: z.number(),
    usersByRole: z.record(z.string(), z.number()),
    usersByStatus: z.record(z.string(), z.number())
  })
});

// College activity response schema
export const collegeActivityResponseSchema = z.object({
  recentLogins: z.number(),
  newRegistrations: z.number(),
  adminActions: z.number(),
  mostActiveDepartment: z.string().nullable(),
  mostActiveDepartmentCount: z.number()
});

// Success response schemas
export const collegeGetResponseSchema = z.object({
  success: z.boolean(),
  data: collegeSettingsResponseSchema,
  message: z.string().optional()
});

export const collegeUpdateResponseSchema = z.object({
  success: z.boolean(),
  data: collegeSettingsResponseSchema,
  message: z.string().optional()
});

export const departmentUpdateResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(z.string()),
  message: z.string().optional()
});

export const transferResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    transferredCount: z.number()
  }),
  message: z.string().optional()
});

// Error response schema
export const collegeErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
