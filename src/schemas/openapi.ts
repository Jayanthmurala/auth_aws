import { z } from 'zod';

/**
 * Common OpenAPI schemas for consistent documentation
 */

// Base response schemas
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  message: z.string().optional(),
  meta: z.object({
    timestamp: z.string(),
    requestId: z.string().optional(),
    version: z.string(),
    pagination: z.object({
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
      hasNext: z.boolean(),
      hasPrev: z.boolean()
    }).optional()
  }).optional()
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    code: z.string(),
    details: z.any().optional(),
    timestamp: z.string(),
    path: z.string(),
    requestId: z.string().optional()
  })
});

export const ValidationErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    code: z.literal('VALIDATION_ERROR'),
    details: z.any().optional(),
    validationErrors: z.array(z.object({
      field: z.string(),
      message: z.string(),
      value: z.any().optional()
    })),
    timestamp: z.string(),
    path: z.string(),
    requestId: z.string().optional()
  })
});

// User schemas
export const UserSchema = z.object({
  id: z.string().describe('Unique user identifier'),
  email: z.string().email().describe('User email address'),
  displayName: z.string().describe('User display name'),
  roles: z.array(z.enum(['STUDENT', 'FACULTY', 'HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN'])).describe('User roles'),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION']).describe('User account status'),
  collegeId: z.string().optional().describe('Associated college ID'),
  department: z.string().optional().describe('User department'),
  year: z.number().min(1).max(6).optional().describe('Academic year (for students)'),
  emailVerifiedAt: z.string().nullable().describe('Email verification timestamp'),
  createdAt: z.string().describe('Account creation timestamp'),
  lastLoginAt: z.string().nullable().describe('Last login timestamp')
});

export const CreateUserSchema = z.object({
  displayName: z.string().min(2).max(100).describe('User display name'),
  email: z.string().email().describe('User email address'),
  password: z.string().min(8).max(128).describe('User password (min 8 characters)'),
  role: z.enum(['STUDENT', 'FACULTY']).describe('User role'),
  collegeId: z.string().describe('College identifier'),
  department: z.string().min(1).max(100).describe('Department name'),
  year: z.number().min(1).max(6).optional().describe('Academic year (required for students)'),
  collegeMemberId: z.string().max(50).optional().describe('College-specific member ID')
});

export const LoginSchema = z.object({
  email: z.string().email().describe('User email address'),
  password: z.string().describe('User password')
});

// Auth response schemas
export const AuthResponseSchema = z.object({
  user: UserSchema,
  accessToken: z.string().describe('JWT access token'),
  expiresIn: z.number().describe('Token expiration time in seconds')
});

export const TokenResponseSchema = z.object({
  accessToken: z.string().describe('JWT access token'),
  expiresIn: z.number().describe('Token expiration time in seconds')
});

// College schemas
export const CollegeSchema = z.object({
  id: z.string().describe('Unique college identifier'),
  name: z.string().describe('College name'),
  code: z.string().describe('College code'),
  address: z.string().optional().describe('College address'),
  website: z.string().url().optional().describe('College website'),
  isActive: z.boolean().describe('Whether college is active'),
  departments: z.array(z.string()).describe('List of departments'),
  createdAt: z.string().describe('College creation timestamp')
});

// Admin schemas
export const AdminUserSchema = UserSchema.extend({
  adminLevel: z.enum(['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN']).describe('Admin level'),
  permissions: z.array(z.string()).describe('Admin permissions'),
  managedColleges: z.array(z.string()).optional().describe('Colleges managed by this admin')
});

// Monitoring schemas
export const HealthStatusSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']).describe('Overall health status'),
  timestamp: z.string().describe('Health check timestamp'),
  uptime: z.number().describe('Service uptime in milliseconds'),
  version: z.string().describe('Service version'),
  environment: z.string().describe('Environment (development/production)'),
  checks: z.object({
    database: z.object({
      status: z.enum(['pass', 'warn', 'fail']),
      responseTime: z.number().optional(),
      message: z.string().optional()
    }),
    redis: z.object({
      status: z.enum(['pass', 'warn', 'fail']),
      responseTime: z.number().optional(),
      message: z.string().optional()
    }).optional(),
    memory: z.object({
      status: z.enum(['pass', 'warn', 'fail']),
      message: z.string().optional(),
      details: z.object({
        used: z.number(),
        total: z.number(),
        percentage: z.number()
      }).optional()
    }),
    disk: z.object({
      status: z.enum(['pass', 'warn', 'fail']),
      message: z.string().optional()
    })
  })
});

export const SystemMetricsSchema = z.object({
  uptime: z.number().describe('Service uptime in milliseconds'),
  memory: z.object({
    used: z.number().describe('Used memory in MB'),
    total: z.number().describe('Total memory in MB'),
    percentage: z.number().describe('Memory usage percentage')
  }),
  cpu: z.object({
    usage: z.number().describe('CPU usage percentage')
  }),
  requests: z.object({
    total: z.number().describe('Total requests processed'),
    successful: z.number().describe('Successful requests'),
    failed: z.number().describe('Failed requests'),
    averageResponseTime: z.number().describe('Average response time in milliseconds')
  }),
  database: z.object({
    connected: z.boolean().describe('Database connection status'),
    responseTime: z.number().describe('Database response time in milliseconds')
  }),
  redis: z.object({
    connected: z.boolean().describe('Redis connection status'),
    responseTime: z.number().describe('Redis response time in milliseconds')
  }).optional()
});

// Common parameter schemas
export const PaginationQuerySchema = z.object({
  limit: z.string().optional().describe('Number of items to return (1-100)'),
  offset: z.string().optional().describe('Number of items to skip'),
  search: z.string().optional().describe('Search query'),
  sortBy: z.string().optional().describe('Field to sort by'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort order')
});

export const IdParamSchema = z.object({
  id: z.string().describe('Resource identifier')
});

// Security schemas
export const ForgotPasswordSchema = z.object({
  email: z.string().email().describe('User email address')
});

export const ResetPasswordSchema = z.object({
  token: z.string().describe('Password reset token'),
  password: z.string().min(8).max(128).describe('New password')
});

export const VerifyEmailSchema = z.object({
  token: z.string().describe('Email verification token')
});

// OpenAPI examples
export const OpenAPIExamples = {
  user: {
    id: 'cm123abc456def789',
    email: 'john.doe@university.edu',
    displayName: 'John Doe',
    roles: ['STUDENT'],
    status: 'ACTIVE',
    collegeId: 'college_123',
    department: 'Computer Science',
    year: 3,
    emailVerifiedAt: '2024-01-15T10:30:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    lastLoginAt: '2024-01-15T10:30:00Z'
  },
  
  createUser: {
    displayName: 'Jane Smith',
    email: 'jane.smith@university.edu',
    password: 'SecureP@ssw0rd123',
    role: 'STUDENT',
    collegeId: 'college_123',
    department: 'Computer Science',
    year: 2,
    collegeMemberId: 'CS2024001'
  },
  
  login: {
    email: 'john.doe@university.edu',
    password: 'SecureP@ssw0rd123'
  },
  
  authResponse: {
    user: {
      id: 'cm123abc456def789',
      email: 'john.doe@university.edu',
      displayName: 'John Doe',
      roles: ['STUDENT'],
      status: 'ACTIVE'
    },
    accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    expiresIn: 1800
  },
  
  successResponse: {
    success: true,
    data: { message: 'Operation completed successfully' },
    meta: {
      timestamp: '2024-01-15T10:30:00Z',
      requestId: 'req_abc123',
      version: '1.0'
    }
  },
  
  errorResponse: {
    success: false,
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      timestamp: '2024-01-15T10:30:00Z',
      path: '/v1/auth/register',
      requestId: 'req_abc123'
    }
  },
  
  validationError: {
    success: false,
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      validationErrors: [
        {
          field: 'email',
          message: 'Invalid email format',
          value: 'invalid-email'
        },
        {
          field: 'password',
          message: 'Password must be at least 8 characters',
          value: 'short'
        }
      ],
      timestamp: '2024-01-15T10:30:00Z',
      path: '/v1/auth/register',
      requestId: 'req_abc123'
    }
  },
  
  healthStatus: {
    status: 'healthy',
    timestamp: '2024-01-15T10:30:00Z',
    uptime: 86400000,
    version: '0.1.0',
    environment: 'production',
    checks: {
      database: {
        status: 'pass',
        responseTime: 25,
        message: 'Database responsive'
      },
      memory: {
        status: 'pass',
        message: 'Memory usage normal',
        details: {
          used: 128,
          total: 512,
          percentage: 25.0
        }
      },
      disk: {
        status: 'pass',
        message: 'Disk space sufficient'
      }
    }
  }
};
