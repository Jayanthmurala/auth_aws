import { z } from 'zod';

// Analytics query schemas
export const analyticsQuerySchema = z.object({
  type: z.enum(['growth', 'activity', 'departments', 'overview']).optional().default('overview'),
  months: z.string().optional().transform(val => parseInt(val || '12')).pipe(z.number().int().min(1).max(24)),
  days: z.string().optional().transform(val => parseInt(val || '30')).pipe(z.number().int().min(1).max(365))
});

export const auditLogsQuerySchema = z.object({
  page: z.union([z.string(), z.number()]).optional().transform(val => {
    if (typeof val === 'number') return Math.max(1, val);
    return Math.max(1, parseInt(val || '1'));
  }),
  limit: z.union([z.string(), z.number()]).optional().transform(val => {
    if (typeof val === 'number') return Math.min(100, Math.max(1, val));
    return Math.min(100, Math.max(1, parseInt(val || '50')));
  }),
  sortBy: z.enum(['createdAt', 'action', 'adminId']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  adminId: z.string().cuid().optional(),
  actions: z.string().optional().transform(val => val ? val.split(',') : undefined),
  targetTypes: z.string().optional().transform(val => val ? val.split(',') : undefined),
  success: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  startDate: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  endDate: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined)
});

export const exportQuerySchema = z.object({
  type: z.enum(['users', 'departments', 'activity', 'audit']),
  format: z.enum(['csv', 'excel']).optional().default('csv'),
  encrypted: z.union([z.string(), z.boolean()]).optional().transform(val => {
    if (typeof val === 'boolean') return val;
    return val === 'false' ? false : true; // Default to encrypted for security
  }),
  department: z.string().optional(), // Filter by department
  role: z.enum(['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN']).optional(), // Filter by role
  readiness: z.enum(['ready', 'not-ready', 'all']).optional(), // For placements admin
  // Additional filters for dept admin
  roles: z.string().optional(), // Comma-separated roles for dept admin
  status: z.string().optional(), // Comma-separated statuses for dept admin
  search: z.string().optional(), // Search query for dept admin
  year: z.string().optional(), // Year filter
  hasNeverLoggedIn: z.union([z.string(), z.boolean()]).optional().transform(val => {
    if (typeof val === 'boolean') return val;
    return val === 'true' ? true : val === 'false' ? false : undefined;
  }) // Login status filter
});

// Analytics response schemas
export const collegeAnalyticsResponseSchema = z.object({
  totalUsers: z.number(),
  usersByRole: z.record(z.string(), z.number()),
  usersByDepartment: z.record(z.string(), z.number()),
  usersByStatus: z.record(z.string(), z.number()),
  activeUsersLast30Days: z.number(),
  newUsersThisMonth: z.number()
});

export const departmentAnalyticsResponseSchema = z.object({
  departmentName: z.string(),
  totalUsers: z.number(),
  usersByRole: z.record(z.string(), z.number()),
  usersByYear: z.record(z.string(), z.number()),
  activeUsersLast30Days: z.number(),
  facultyLoad: z.number(),
  studentParticipation: z.number()
});

export const placementAnalyticsResponseSchema = z.object({
  placementStats: z.object({
    totalStudents: z.number(),
    placementReady: z.number(),
    internshipCompleted: z.number(),
    offersReceived: z.number(),
    companiesVisited: z.number(),
    averagePackage: z.number().optional(),
    topRecruiters: z.array(z.string())
  }),
  departmentWiseData: z.array(z.object({
    department: z.string(),
    totalUsers: z.number(),
    studentCount: z.number(),
    placementReadiness: z.number(),
    activityRate: z.number()
  }))
});

export const userGrowthResponseSchema = z.array(z.object({
  month: z.string().or(z.date()),
  new_users: z.number(),
  new_students: z.number(),
  new_faculty: z.number()
}));

export const loginActivityResponseSchema = z.array(z.object({
  date: z.string().or(z.date()),
  unique_logins: z.number(),
  student_logins: z.number(),
  faculty_logins: z.number()
}));

export const departmentComparisonResponseSchema = z.array(z.object({
  department: z.string(),
  totalUsers: z.number(),
  activeUsers: z.number(),
  activityRate: z.number(),
  averageYear: z.number().optional()
}));

export const adminActivityResponseSchema = z.object({
  totalAdmins: z.number(),
  activeAdmins: z.number(),
  recentActions: z.number(),
  adminActivityRate: z.number()
});

// Audit log response schemas
export const auditLogEntryResponseSchema = z.object({
  id: z.string(),
  adminId: z.string(),
  admin: z.object({
    displayName: z.string(),
    email: z.string()
  }),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
  collegeId: z.string(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime().or(z.date())
});

export const auditLogsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(auditLogEntryResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }),
  message: z.string().optional()
});

export const auditStatsResponseSchema = z.object({
  overview: z.object({
    totalActions: z.number(),
    successfulActions: z.number(),
    failedActions: z.number(),
    successRate: z.number()
  }),
  actionsByType: z.array(z.object({
    action: z.string(),
    count: z.number()
  })),
  actionsByAdmin: z.array(z.object({
    adminId: z.string(),
    count: z.number()
  })),
  recentFailures: z.array(z.object({
    id: z.string(),
    action: z.string(),
    adminName: z.string(),
    targetType: z.string(),
    errorMessage: z.string().optional(),
    createdAt: z.date()
  }))
});

// Dashboard response schemas
export const headAdminDashboardResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    analytics: collegeAnalyticsResponseSchema,
    college: z.object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      departments: z.array(z.string()),
      isActive: z.boolean(),
      userCounts: z.object({
        totalUsers: z.number(),
        activeUsers: z.number(),
        usersByRole: z.record(z.string(), z.number()),
        usersByDepartment: z.record(z.string(), z.number())
      })
    }),
    adminActivity: adminActivityResponseSchema
  })
});

export const deptAdminDashboardResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    analytics: departmentAnalyticsResponseSchema,
    department: z.string()
  })
});

export const placementsAdminDashboardResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    placementStats: z.object({
      totalStudents: z.number(),
      placementReady: z.number(),
      internshipCompleted: z.number(),
      offersReceived: z.number(),
      companiesVisited: z.number(),
      averagePackage: z.number().optional(),
      topRecruiters: z.array(z.string())
    }),
    studentOverview: z.object({
      totalStudents: z.number(),
      activeStudents: z.number()
    })
  })
});

// Generic analytics response schema
export const analyticsResponseSchema = z.object({
  success: z.boolean(),
  data: z.union([
    collegeAnalyticsResponseSchema,
    departmentAnalyticsResponseSchema,
    placementAnalyticsResponseSchema,
    userGrowthResponseSchema,
    loginActivityResponseSchema,
    departmentComparisonResponseSchema
  ]),
  message: z.string().optional()
});

// Error response schema
export const analyticsErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
