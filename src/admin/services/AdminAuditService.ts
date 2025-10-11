import { prisma } from '../../db.js';
import { AuditAction, AuditLogEntry, ADMIN_LIMITS } from '../types/adminTypes.js';

export interface CreateAuditLogParams {
  adminId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  collegeId: string;
  success?: boolean;
  errorMessage?: string;
}

export interface AuditLogFilters {
  adminId?: string;
  actions?: AuditAction[];
  targetTypes?: string[];
  targetId?: string;
  collegeId?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
}

export interface AuditLogQuery extends AuditLogFilters {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'action' | 'adminId';
  sortOrder?: 'asc' | 'desc';
}

export class AdminAuditService {
  /**
   * Log an admin action
   */
  static async logAction(params: CreateAuditLogParams): Promise<AuditLogEntry> {
    // TODO: Uncomment after Prisma regeneration
    // const auditLog = await (prisma as any).adminAuditLog.create({
    const auditLog = await (prisma as any).adminAuditLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        details: params.details,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        collegeId: params.collegeId,
        success: params.success ?? true,
        errorMessage: params.errorMessage
      },
      include: {
        admin: {
          select: {
            displayName: true,
            email: true,
            roles: true
          }
        }
      }
    });

    return {
      id: auditLog.id,
      adminId: auditLog.adminId,
      admin: {
        displayName: auditLog.admin?.displayName || 'Unknown Admin',
        email: auditLog.admin?.email || 'unknown@example.com'
      },
      action: auditLog.action as AuditAction,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details as Record<string, any>,
      collegeId: auditLog.collegeId,
      success: auditLog.success,
      errorMessage: auditLog.errorMessage,
      createdAt: auditLog.createdAt
    };
  }

  /**
   * Get audit logs with filtering and pagination
   */
  static async getAuditLogs(query: AuditLogQuery) {
    const {
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      ...filters
    } = query;

    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100); // Max 100 per page

    // Build where clause
    const where: any = {};

    if (filters.adminId) {
      where.adminId = filters.adminId;
    }

    if (filters.actions && filters.actions.length > 0) {
      where.action = { in: filters.actions };
    }

    if (filters.targetTypes && filters.targetTypes.length > 0) {
      where.targetType = { in: filters.targetTypes };
    }

    if (filters.targetId) {
      where.targetId = filters.targetId;
    }

    if (filters.collegeId) {
      where.collegeId = filters.collegeId;
    }

    if (filters.success !== undefined) {
      where.success = filters.success;
    }

    if (filters.ipAddress) {
      where.ipAddress = filters.ipAddress;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.createdAt.lte = filters.endDate;
      }
    }

    const [auditLogs, total] = await Promise.all([
      (prisma as any).adminAuditLog.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          admin: {
            select: {
              displayName: true,
              email: true,
              roles: true
            }
          }
        }
      }),
      (prisma as any).adminAuditLog.count({ where })
    ]);

    return {
      auditLogs: auditLogs.map((log: any) => ({
        id: log.id,
        adminId: log.adminId,
        admin: {
          displayName: log.admin?.displayName || 'Unknown Admin',
          email: log.admin?.email || 'unknown@example.com'
        },
        action: log.action as AuditAction,
        targetType: log.targetType || 'UNKNOWN',
        targetId: log.targetId || undefined,
        details: log.details as Record<string, any> || undefined,
        collegeId: log.collegeId,
        success: log.success,
        errorMessage: log.errorMessage || undefined,
        createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : new Date(log.createdAt).toISOString()
      })),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Get audit log statistics
   */
  static async getAuditStats(collegeId: string, startDate?: Date, endDate?: Date) {
    const where: any = { collegeId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [
      totalActions,
      successfulActions,
      failedActions,
      actionsByType,
      actionsByAdmin,
      recentFailures
    ] = await Promise.all([
      // Total actions
      (prisma as any).adminAuditLog.count({ where }),

      // Successful actions
      (prisma as any).adminAuditLog.count({ 
        where: { ...where, success: true } 
      }),

      // Failed actions
      (prisma as any).adminAuditLog.count({ 
        where: { ...where, success: false } 
      }),

      // Actions by type
      (prisma as any).adminAuditLog.groupBy({
        by: ['action'],
        where,
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } }
      }),

      // Actions by admin
      (prisma as any).adminAuditLog.groupBy({
        by: ['adminId'],
        where,
        _count: { adminId: true },
        orderBy: { _count: { adminId: 'desc' } }
      }),

      // Recent failures
      (prisma as any).adminAuditLog.findMany({
        where: { ...where, success: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          admin: {
            select: {
              displayName: true,
              email: true
            }
          }
        }
      })
    ]);

    return {
      overview: {
        totalActions,
        successfulActions,
        failedActions,
        successRate: totalActions > 0 ? (successfulActions / totalActions) * 100 : 0
      },
      actionsByType: actionsByType.map((item: any) => ({
        action: item.action,
        count: item._count.action
      })),
      actionsByAdmin: actionsByAdmin.map((item: any) => ({
        adminId: item.adminId,
        count: item._count.adminId
      })),
      recentFailures: recentFailures.map((failure: any) => ({
        id: failure.id,
        action: failure.action,
        adminName: failure.admin.displayName,
        targetType: failure.targetType,
        errorMessage: failure.errorMessage,
        createdAt: failure.createdAt
      }))
    };
  }

  /**
   * Get admin activity summary
   */
  static async getAdminActivity(adminId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [
      totalActions,
      actionsByDay,
      actionsByType,
      recentActions
    ] = await Promise.all([
      // Total actions in period
      (prisma as any).adminAuditLog.count({
        where: {
          adminId,
          createdAt: { gte: startDate }
        }
      }),

      // Actions by day
      prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM admin_audit_log 
        WHERE admin_id = ${adminId} 
          AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `,

      // Actions by type
      (prisma as any).adminAuditLog.groupBy({
        by: ['action'],
        where: {
          adminId,
          createdAt: { gte: startDate }
        },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } }
      }),

      // Recent actions
      (prisma as any).adminAuditLog.findMany({
        where: { adminId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          action: true,
          targetType: true,
          success: true,
          createdAt: true
        }
      })
    ]);

    return {
      summary: {
        totalActions,
        period: `${days} days`
      },
      actionsByDay,
      actionsByType: actionsByType.map((item: any) => ({
        action: item.action,
        count: item._count.action
      })),
      recentActions
    };
  }

  /**
   * Clean up old audit logs based on retention policy
   */
  static async cleanupOldLogs(): Promise<number> {
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - ADMIN_LIMITS.AUDIT_LOG_RETENTION_DAYS);

    const result = await (prisma as any).adminAuditLog.deleteMany({
      where: {
        createdAt: {
          lt: retentionDate
        }
      }
    });

    return result.count;
  }

  /**
   * Export audit logs to CSV format
   */
  static async exportAuditLogs(filters: AuditLogFilters): Promise<string> {
    const auditLogs = await (prisma as any).adminAuditLog.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
      include: {
        admin: {
          select: {
            displayName: true,
            email: true,
            roles: true
          }
        }
      }
    });

    const headers = [
      'Date',
      'Admin Name',
      'Admin Email',
      'Action',
      'Target Type',
      'Target ID',
      'Success',
      'IP Address',
      'Error Message'
    ];

    const rows = auditLogs.map((log: any) => [
      log.createdAt.toISOString(),
      log.admin.displayName,
      log.admin.email,
      log.action,
      log.targetType,
      log.targetId || '',
      log.success ? 'Yes' : 'No',
      log.ipAddress || '',
      log.errorMessage || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }
}
