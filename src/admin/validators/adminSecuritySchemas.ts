import { z } from 'zod';

// Security and confirmation schemas
export const sensitiveOperationSchema = z.object({
  confirmation: z.literal(true, {
    errorMap: () => ({ message: 'Confirmation required for sensitive operations' })
  }),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long').optional()
});

export const bulkDeleteConfirmationSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1, 'At least one user required').max(100, 'Maximum 100 users per operation'),
  confirmation: z.literal(true, {
    errorMap: () => ({ message: 'Confirmation required for bulk delete operation' })
  }),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long')
});

export const roleChangeConfirmationSchema = z.object({
  userId: z.string().cuid('Invalid user ID'),
  newRoles: z.array(z.enum(['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'])).min(1),
  confirmation: z.literal(true, {
    errorMap: () => ({ message: 'Confirmation required for role change' })
  }),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long')
});

export const bulkImportConfirmationSchema = z.object({
  operation: z.object({
    action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SUSPEND', 'ACTIVATE']),
    users: z.array(z.any()).min(1).max(500),
    preview: z.literal(false) // Must be false for actual execution
  }),
  confirmation: z.literal(true, {
    errorMap: () => ({ message: 'Confirmation required for bulk import operation' })
  }),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long')
});

// Rate limiting schemas
export const rateLimitConfigSchema = z.object({
  maxRequests: z.number().int().min(1).max(1000),
  windowMs: z.number().int().min(1000).max(3600000), // 1 second to 1 hour
  skipSuccessfulRequests: z.boolean().optional().default(false),
  skipFailedRequests: z.boolean().optional().default(false)
});

// IP restriction schemas
export const ipRestrictionSchema = z.object({
  allowedIPs: z.array(z.string().ip()).optional(),
  blockedIPs: z.array(z.string().ip()).optional(),
  allowPrivateNetworks: z.boolean().optional().default(true)
});

// Session management schemas
export const sessionConfigSchema = z.object({
  maxConcurrentSessions: z.number().int().min(1).max(10).optional().default(3),
  sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional().default(60), // 5 minutes to 24 hours
  requireReauthForSensitive: z.boolean().optional().default(true)
});

// Audit configuration schemas
export const auditConfigSchema = z.object({
  retentionDays: z.number().int().min(30).max(2555).optional().default(730), // 30 days to 7 years
  logLevel: z.enum(['BASIC', 'DETAILED', 'VERBOSE']).optional().default('DETAILED'),
  includeRequestBody: z.boolean().optional().default(true),
  includeResponseBody: z.boolean().optional().default(false),
  maskSensitiveData: z.boolean().optional().default(true)
});

// Two-factor authentication schemas
export const twoFactorSetupSchema = z.object({
  method: z.enum(['TOTP', 'SMS', 'EMAIL']),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional()
}).refine(data => {
  if (data.method === 'SMS' && !data.phoneNumber) {
    return false;
  }
  if (data.method === 'EMAIL' && !data.email) {
    return false;
  }
  return true;
}, {
  message: 'Phone number required for SMS or email required for EMAIL method'
});

export const twoFactorVerificationSchema = z.object({
  token: z.string().length(6, 'Token must be 6 digits').regex(/^\d{6}$/, 'Token must contain only digits'),
  method: z.enum(['TOTP', 'SMS', 'EMAIL'])
});

// Security event schemas
export const securityEventSchema = z.object({
  eventType: z.enum([
    'FAILED_LOGIN',
    'SUCCESSFUL_LOGIN',
    'PASSWORD_CHANGE',
    'ROLE_CHANGE',
    'ACCOUNT_LOCKED',
    'ACCOUNT_UNLOCKED',
    'SUSPICIOUS_ACTIVITY',
    'DATA_EXPORT',
    'BULK_OPERATION'
  ]),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  description: z.string().min(1).max(1000),
  metadata: z.record(z.string(), z.any()).optional(),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().optional()
});

// Password policy schemas
export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(128).optional().default(8),
  requireUppercase: z.boolean().optional().default(true),
  requireLowercase: z.boolean().optional().default(true),
  requireNumbers: z.boolean().optional().default(true),
  requireSpecialChars: z.boolean().optional().default(true),
  maxAge: z.number().int().min(30).max(365).optional().default(90), // days
  preventReuse: z.number().int().min(1).max(24).optional().default(5) // last N passwords
});

// Account lockout schemas
export const lockoutPolicySchema = z.object({
  maxFailedAttempts: z.number().int().min(3).max(10).optional().default(5),
  lockoutDurationMinutes: z.number().int().min(5).max(1440).optional().default(30),
  resetOnSuccess: z.boolean().optional().default(true)
});

// Data retention schemas
export const dataRetentionSchema = z.object({
  userDataRetentionDays: z.number().int().min(30).max(2555).optional().default(2555), // 7 years
  auditLogRetentionDays: z.number().int().min(30).max(2555).optional().default(730), // 2 years
  sessionDataRetentionDays: z.number().int().min(1).max(90).optional().default(30),
  autoCleanupEnabled: z.boolean().optional().default(true)
});

// Security response schemas
export const securityConfigResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    rateLimit: rateLimitConfigSchema,
    ipRestriction: ipRestrictionSchema,
    session: sessionConfigSchema,
    audit: auditConfigSchema,
    passwordPolicy: passwordPolicySchema,
    lockoutPolicy: lockoutPolicySchema,
    dataRetention: dataRetentionSchema
  }),
  message: z.string().optional()
});

export const securityEventResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    id: z.string(),
    eventType: z.string(),
    severity: z.string(),
    description: z.string(),
    userId: z.string().optional(),
    adminId: z.string().optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    createdAt: z.date()
  })),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional(),
  message: z.string().optional()
});

// Error response schema
export const securityErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
