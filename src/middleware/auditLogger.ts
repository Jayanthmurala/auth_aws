import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Audit log entry interface
 */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId?: string;
  userEmail?: string;
  userRole?: string[];
  action: string;
  resource: string;
  resourceId?: string;
  method: string;
  path: string;
  ip: string;
  userAgent?: string;
  success: boolean;
  statusCode: number;
  duration: number;
  details?: Record<string, any>;
  risk: 'low' | 'medium' | 'high' | 'critical';
  category: 'auth' | 'admin' | 'data' | 'security' | 'system';
}

/**
 * In-memory audit log storage
 * In production, this should be replaced with a persistent storage solution
 */
class AuditLogStorage {
  private static instance: AuditLogStorage;
  private logs: AuditLogEntry[] = [];
  private maxLogs = 10000; // Keep last 10k logs in memory

  static getInstance(): AuditLogStorage {
    if (!AuditLogStorage.instance) {
      AuditLogStorage.instance = new AuditLogStorage();
    }
    return AuditLogStorage.instance;
  }

  /**
   * Add audit log entry
   */
  addLog(entry: AuditLogEntry): void {
    this.logs.push(entry);
    
    // Keep only the most recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Log to console in development
    if (env.NODE_ENV === 'development') {
      console.log(`[AUDIT] ${entry.risk.toUpperCase()} - ${entry.action} by ${entry.userEmail || 'anonymous'} on ${entry.resource}`);
    }

    // In production, you would send this to a logging service
    if (env.NODE_ENV === 'production' && (entry.risk === 'high' || entry.risk === 'critical')) {
      // TODO: Send to external logging service (e.g., Elasticsearch, CloudWatch, etc.)
      console.warn(`[AUDIT ALERT] ${entry.risk.toUpperCase()} risk action:`, entry);
    }
  }

  /**
   * Get audit logs with filtering
   */
  getLogs(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    risk?: string;
    category?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}): { logs: AuditLogEntry[]; total: number } {
    let filteredLogs = [...this.logs];

    // Apply filters
    if (filters.userId) {
      filteredLogs = filteredLogs.filter(log => log.userId === filters.userId);
    }
    if (filters.action) {
      filteredLogs = filteredLogs.filter(log => log.action.includes(filters.action!));
    }
    if (filters.resource) {
      filteredLogs = filteredLogs.filter(log => log.resource.includes(filters.resource!));
    }
    if (filters.risk) {
      filteredLogs = filteredLogs.filter(log => log.risk === filters.risk);
    }
    if (filters.category) {
      filteredLogs = filteredLogs.filter(log => log.category === filters.category);
    }
    if (filters.startDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= filters.startDate!);
    }
    if (filters.endDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= filters.endDate!);
    }

    const total = filteredLogs.length;

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    filteredLogs = filteredLogs.slice(offset, offset + limit);

    return { logs: filteredLogs, total };
  }

  /**
   * Get audit statistics
   */
  getStats(): {
    total: number;
    byRisk: Record<string, number>;
    byCategory: Record<string, number>;
    byAction: Record<string, number>;
    recentActivity: number;
  } {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const stats = {
      total: this.logs.length,
      byRisk: { low: 0, medium: 0, high: 0, critical: 0 },
      byCategory: { auth: 0, admin: 0, data: 0, security: 0, system: 0 },
      byAction: {} as Record<string, number>,
      recentActivity: 0
    };

    for (const log of this.logs) {
      // Count by risk
      stats.byRisk[log.risk]++;
      
      // Count by category
      stats.byCategory[log.category]++;
      
      // Count by action
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
      
      // Count recent activity (last hour)
      if (new Date(log.timestamp).getTime() > oneHourAgo) {
        stats.recentActivity++;
      }
    }

    return stats;
  }
}

/**
 * Audit logger utility class
 */
export class AuditLogger {
  private static storage = AuditLogStorage.getInstance();

  /**
   * Log an audit event
   */
  static log(
    request: FastifyRequest,
    reply: FastifyReply,
    action: string,
    resource: string,
    options: {
      resourceId?: string;
      details?: Record<string, any>;
      risk?: AuditLogEntry['risk'];
      category?: AuditLogEntry['category'];
    } = {}
  ): void {
    const user = (request as any).user;
    const startTime = (request as any).startTime || Date.now();
    
    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      userId: user?.id,
      userEmail: user?.email,
      userRole: user?.roles,
      action,
      resource,
      resourceId: options.resourceId,
      method: request.method,
      path: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string || undefined,
      success: reply.statusCode < 400,
      statusCode: reply.statusCode,
      duration: Date.now() - startTime,
      details: options.details,
      risk: options.risk || this.determineRisk(action, resource, reply.statusCode),
      category: options.category || this.determineCategory(resource)
    };

    this.storage.addLog(entry);
  }

  /**
   * Get audit logs
   */
  static getLogs(filters: Parameters<typeof AuditLogStorage.prototype.getLogs>[0]) {
    return this.storage.getLogs(filters);
  }

  /**
   * Log system events (for automated processes)
   */
  static logSystem(
    action: string,
    resource: string,
    details: {
      details?: any;
      risk?: 'low' | 'medium' | 'high' | 'critical';
      category?: 'auth' | 'admin' | 'data' | 'security' | 'system';
    }
  ): void {
    const logEntry: AuditLogEntry = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      userId: 'system',
      userEmail: 'system@nexus.internal',
      userRole: ['SYSTEM'],
      action,
      resource,
      method: 'SYSTEM',
      path: resource,
      ip: '127.0.0.1',
      userAgent: 'System Process',
      success: true,
      statusCode: 200,
      duration: 0,
      details: details.details || {},
      risk: details.risk || 'medium',
      category: details.category || 'system'
    };

    this.storage.addLog(logEntry);

    // Log to console for system events
    console.log(`[AUDIT] System: ${action} on ${resource}`, {
      risk: logEntry.risk,
      category: logEntry.category,
      details: logEntry.details
    });
  }

  /**
   * Get audit statistics
   */
  static getStats() {
    return this.storage.getStats();
  }

  /**
   * Determine risk level based on action and resource
   */
  private static determineRisk(action: string, resource: string, statusCode: number): AuditLogEntry['risk'] {
    // Failed operations are higher risk
    if (statusCode >= 400) {
      if (action.includes('login') || action.includes('auth')) {
        return 'high'; // Failed authentication attempts
      }
      return 'medium';
    }

    // Critical operations
    if (action.includes('delete') || action.includes('suspend') || action.includes('promote')) {
      return 'critical';
    }

    // High risk operations
    if (action.includes('admin') || action.includes('role') || action.includes('permission')) {
      return 'high';
    }

    // Medium risk operations
    if (action.includes('create') || action.includes('update') || action.includes('modify')) {
      return 'medium';
    }

    // Low risk operations
    return 'low';
  }

  /**
   * Determine category based on resource
   */
  private static determineCategory(resource: string): AuditLogEntry['category'] {
    if (resource.includes('auth') || resource.includes('login') || resource.includes('token')) {
      return 'auth';
    }
    if (resource.includes('admin') || resource.includes('role') || resource.includes('permission')) {
      return 'admin';
    }
    if (resource.includes('user') || resource.includes('college') || resource.includes('profile')) {
      return 'data';
    }
    if (resource.includes('security') || resource.includes('csrf') || resource.includes('rate-limit')) {
      return 'security';
    }
    return 'system';
  }
}

/**
 * Audit logging middleware
 */
export function auditLoggingMiddleware(options: {
  excludePaths?: string[];
  includeBody?: boolean;
  sensitiveFields?: string[];
} = {}) {
  const {
    excludePaths = ['/health', '/metrics', '/docs'],
    includeBody = false,
    sensitiveFields = ['password', 'token', 'secret', 'key']
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip audit logging for excluded paths
    if (excludePaths.some(path => request.url.includes(path))) {
      return;
    }

    // Store start time for duration calculation
    (request as any).startTime = Date.now();

    // Hook into response to log the audit event
    reply.raw.on('finish', () => {
      const action = `${request.method.toLowerCase()}_${request.url.split('/').pop() || 'unknown'}`;
      const resource = request.url.split('?')[0]; // Remove query parameters
      
      let details: Record<string, any> | undefined;
      
      if (includeBody && request.body) {
        // Sanitize sensitive fields from body
        details = { ...request.body as any };
        for (const field of sensitiveFields) {
          if (details && details[field]) {
            details[field] = '[REDACTED]';
          }
        }
      }

      AuditLogger.log(request, reply, action, resource, { details });
    });
  };
}

/**
 * Specific audit logging functions for common operations
 */
export const AuditActions = {
  /**
   * Log authentication events
   */
  auth: {
    login: (request: FastifyRequest, reply: FastifyReply, email: string, success: boolean) => {
      AuditLogger.log(request, reply, 'user_login', '/auth/login', {
        details: { email, success },
        risk: success ? 'low' : 'high',
        category: 'auth'
      });
    },

    logout: (request: FastifyRequest, reply: FastifyReply) => {
      AuditLogger.log(request, reply, 'user_logout', '/auth/logout', {
        risk: 'low',
        category: 'auth'
      });
    },

    register: (request: FastifyRequest, reply: FastifyReply, email: string) => {
      AuditLogger.log(request, reply, 'user_register', '/auth/register', {
        details: { email },
        risk: 'medium',
        category: 'auth'
      });
    },

    passwordReset: (request: FastifyRequest, reply: FastifyReply, email: string) => {
      AuditLogger.log(request, reply, 'password_reset_request', '/auth/forgot-password', {
        details: { email },
        risk: 'medium',
        category: 'auth'
      });
    }
  },

  /**
   * Log admin operations
   */
  admin: {
    userSuspend: (request: FastifyRequest, reply: FastifyReply, targetUserId: string) => {
      AuditLogger.log(request, reply, 'admin_suspend_user', '/admin/users', {
        resourceId: targetUserId,
        risk: 'critical',
        category: 'admin'
      });
    },

    roleChange: (request: FastifyRequest, reply: FastifyReply, targetUserId: string, newRole: string) => {
      AuditLogger.log(request, reply, 'admin_change_role', '/admin/users', {
        resourceId: targetUserId,
        details: { newRole },
        risk: 'critical',
        category: 'admin'
      });
    },

    dataExport: (request: FastifyRequest, reply: FastifyReply, dataType: string) => {
      AuditLogger.log(request, reply, 'admin_data_export', '/admin/export', {
        details: { dataType },
        risk: 'high',
        category: 'admin'
      });
    }
  },

  /**
   * Log security events
   */
  security: {
    csrfTokenGenerated: (request: FastifyRequest, reply: FastifyReply) => {
      AuditLogger.log(request, reply, 'csrf_token_generated', '/security/csrf-token', {
        risk: 'low',
        category: 'security'
      });
    },

    ipBlocked: (request: FastifyRequest, reply: FastifyReply, blockedIP: string) => {
      AuditLogger.log(request, reply, 'ip_blocked', '/security/rate-limit', {
        details: { blockedIP },
        risk: 'high',
        category: 'security'
      });
    },

    suspiciousActivity: (request: FastifyRequest, reply: FastifyReply, reason: string) => {
      AuditLogger.log(request, reply, 'suspicious_activity_detected', request.url, {
        details: { reason },
        risk: 'critical',
        category: 'security'
      });
    }
  }
};
