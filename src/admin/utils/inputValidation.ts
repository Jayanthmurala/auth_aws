import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';

/**
 * Secure input validation utilities for admin operations
 */

// Query parameter validation schemas
export const userFiltersQuerySchema = z.object({
  roles: z.string().optional().transform(val => {
    if (!val) return undefined;
    const roles = val.split(',').map(r => r.trim()).filter(r => r.length > 0);
    // Validate each role is a valid enum value
    const validRoles = roles.filter(role => 
      ['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'].includes(role)
    );
    return validRoles.length > 0 ? validRoles as Role[] : undefined;
  }),
  
  departments: z.string().optional().transform(val => {
    if (!val) return undefined;
    const departments = val.split(',').map(d => d.trim()).filter(d => d.length > 0);
    // Sanitize department names (remove special characters)
    const sanitized = departments.map(dept => 
      dept.replace(/[<>\"'&]/g, '').substring(0, 100)
    ).filter(d => d.length > 0);
    return sanitized.length > 0 ? sanitized : undefined;
  }),
  
  status: z.string().optional().transform(val => {
    if (!val) return undefined;
    const statuses = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
    // Validate each status is a valid enum value
    const validStatuses = statuses.filter(status => 
      ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED'].includes(status)
    );
    return validStatuses.length > 0 ? validStatuses as UserStatus[] : undefined;
  }),
  
  year: z.string().optional().transform(val => {
    if (!val) return undefined;
    const years = val.split(',').map(y => {
      const num = parseInt(y.trim());
      return isNaN(num) ? null : num;
    }).filter(y => y !== null && y >= 1 && y <= 6);
    return years.length > 0 ? years as number[] : undefined;
  }),
  
  search: z.string().optional().transform(val => {
    if (!val) return undefined;
    // Sanitize search query - remove HTML/script tags and limit length
    const sanitized = val
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>\"'&]/g, '') // Remove dangerous characters
      .trim()
      .substring(0, 100); // Limit length
    return sanitized.length > 0 ? sanitized : undefined;
  }),
  
  createdAfter: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      // Validate date is reasonable (not too far in past/future)
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1);
      const oneYearFromNow = new Date(now.getFullYear() + 1, 11, 31);
      
      if (date < tenYearsAgo || date > oneYearFromNow) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }),
  
  createdBefore: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1);
      const oneYearFromNow = new Date(now.getFullYear() + 1, 11, 31);
      
      if (date < tenYearsAgo || date > oneYearFromNow) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }),
  
  lastLoginAfter: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1);
      
      if (date < tenYearsAgo || date > now) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }),
  
  lastLoginBefore: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      const now = new Date();
      const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1);
      
      if (date < tenYearsAgo || date > now) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }),
  
  hasNeverLoggedIn: z.string().optional().transform(val => {
    if (!val) return undefined;
    return val.toLowerCase() === 'true';
  })
});

export const paginationQuerySchema = z.object({
  page: z.string().optional().transform(val => {
    const num = parseInt(val || '1');
    return isNaN(num) || num < 1 ? 1 : Math.min(num, 1000); // Max 1000 pages
  }),
  
  limit: z.string().optional().transform(val => {
    const num = parseInt(val || '50');
    return isNaN(num) || num < 1 ? 50 : Math.min(num, 100); // Max 100 items per page
  }),
  
  sortBy: z.string().optional().transform(val => {
    if (!val) return 'createdAt';
    // Only allow specific sortable fields
    const allowedFields = ['createdAt', 'displayName', 'email', 'status', 'year', 'lastLoginAt'];
    return allowedFields.includes(val) ? val : 'createdAt';
  }),
  
  sortOrder: z.string().optional().transform(val => {
    return val === 'asc' ? 'asc' : 'desc';
  })
});

export const analyticsQuerySchema = z.object({
  type: z.string().optional().transform(val => {
    if (!val) return 'overview';
    const allowedTypes = ['growth', 'activity', 'departments', 'overview'];
    return allowedTypes.includes(val) ? val : 'overview';
  }),
  
  months: z.string().optional().transform(val => {
    const num = parseInt(val || '12');
    return isNaN(num) || num < 1 ? 12 : Math.min(num, 24); // Max 24 months
  }),
  
  days: z.string().optional().transform(val => {
    const num = parseInt(val || '30');
    return isNaN(num) || num < 1 ? 30 : Math.min(num, 365); // Max 365 days
  })
});

export const auditLogsQuerySchema = z.object({
  page: z.string().optional().transform(val => {
    const num = parseInt(val || '1');
    return isNaN(num) || num < 1 ? 1 : Math.min(num, 1000);
  }),
  
  limit: z.string().optional().transform(val => {
    const num = parseInt(val || '50');
    return isNaN(num) || num < 1 ? 50 : Math.min(num, 100);
  }),
  
  sortBy: z.string().optional().transform(val => {
    const allowedFields = ['createdAt', 'action', 'adminId', 'success'];
    return allowedFields.includes(val || '') ? val : 'createdAt';
  }),
  
  sortOrder: z.string().optional().transform(val => {
    return val === 'asc' ? 'asc' : 'desc';
  }),
  
  adminId: z.string().optional().transform(val => {
    if (!val) return undefined;
    // Basic CUID validation
    return /^[a-z0-9]{25}$/.test(val) ? val : undefined;
  }),
  
  actions: z.string().optional().transform(val => {
    if (!val) return undefined;
    const actions = val.split(',').map(a => a.trim()).filter(a => a.length > 0);
    // Validate against known admin actions
    const validActions = [
      'LOGIN', 'LOGOUT', 'CREATE_USER', 'UPDATE_USER', 'DELETE_USER',
      'BULK_IMPORT', 'PASSWORD_RESET', 'UPDATE_COLLEGE', 'EXPORT_DATA'
    ];
    const filtered = actions.filter(action => validActions.includes(action));
    return filtered.length > 0 ? filtered : undefined;
  }),
  
  targetTypes: z.string().optional().transform(val => {
    if (!val) return undefined;
    const types = val.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const validTypes = ['USER', 'COLLEGE', 'DASHBOARD', 'DATA', 'BULK_OPERATION'];
    const filtered = types.filter(type => validTypes.includes(type));
    return filtered.length > 0 ? filtered : undefined;
  }),
  
  success: z.string().optional().transform(val => {
    if (!val) return undefined;
    return val.toLowerCase() === 'true';
  }),
  
  startDate: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      const now = new Date();
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      
      if (date < oneYearAgo || date > now) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  }),
  
  endDate: z.string().datetime().optional().transform(val => {
    if (!val) return undefined;
    try {
      const date = new Date(val);
      const now = new Date();
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      
      if (date < oneYearAgo || date > now) {
        return undefined;
      }
      return date;
    } catch {
      return undefined;
    }
  })
});

export const exportQuerySchema = z.object({
  type: z.string().transform(val => {
    const allowedTypes = ['users', 'departments', 'activity', 'audit'];
    return allowedTypes.includes(val) ? val : 'users';
  }),
  
  format: z.string().optional().transform(val => {
    return val === 'json' ? 'json' : 'csv';
  }),
  
  encrypted: z.string().optional().transform(val => {
    return val === 'false' ? false : true; // Default to encrypted
  }),
  
  department: z.string().optional().transform(val => {
    if (!val) return undefined;
    // Sanitize department name
    return val.replace(/[<>\"'&]/g, '').trim().substring(0, 100) || undefined;
  }),
  
  role: z.string().optional().transform(val => {
    if (!val) return undefined;
    const validRoles = ['STUDENT', 'FACULTY', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'HEAD_ADMIN'];
    return validRoles.includes(val) ? val : undefined;
  })
});

/**
 * Validation error handler
 */
export function handleValidationError(error: z.ZodError) {
  return {
    success: false,
    message: 'Invalid request parameters',
    errors: error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code
    }))
  };
}

/**
 * Safe query parameter parser
 */
export function parseAndValidateQuery<T>(
  query: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: any } {
  try {
    const data = schema.parse(query);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: handleValidationError(error) };
    }
    return { 
      success: false, 
      error: { 
        success: false, 
        message: 'Validation failed', 
        errors: [{ field: 'unknown', message: 'Invalid input format' }] 
      } 
    };
  }
}
