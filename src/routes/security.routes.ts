import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { 
  getSecurityStats,
  AdvancedRateLimit 
} from '../middleware/advancedSecurity';
import { generateCSRFToken } from '../middleware/distributedCSRF';
import { ResponseWrapper } from '../middleware/responseWrapper';
import { AuditLogger } from '../middleware/auditLogger';
import { authenticateUser, requireRoles } from '../middleware/authMiddleware';
import { RateLimiters } from '../middleware/rateLimitMiddleware';
import { DistributedRateLimiters } from '../middleware/distributedRateLimit';

// Define validation schemas for security endpoints
const ipAddressSchema = z.object({
  ip: z.string().ip('Invalid IP address format')
});

const auditLogsQuerySchema = z.object({
  userId: z.string().cuid().optional(),
  action: z.string().min(1).max(100).optional(),
  resource: z.string().min(1).max(200).optional(),
  risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.enum(['auth', 'admin', 'data', 'security', 'system']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0)).optional()
});

/**
 * Security management routes
 */
export default async function securityRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  /**
   * Generate CSRF token
   */
  fastify.get('/security/csrf-token', {
    schema: {
      tags: ['security'],
      summary: 'Generate CSRF token',
      description: 'Generate a CSRF token for the current session',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                token: { type: 'string' },
                expiresIn: { type: 'number' },
                headerName: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    // Get session ID from authenticated user or IP
    const sessionId = (request as any).user?.id || request.ip;
    const token = await generateCSRFToken(sessionId);
    
    return reply.sendSuccess({
      token,
      expiresIn: 30 * 60, // 30 minutes
      headerName: 'X-CSRF-Token'
    }, 'CSRF token generated');
  });

  /**
   * Security statistics (admin only)
   */
  fastify.get('/security/stats', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['HEAD_ADMIN', 'SUPER_ADMIN'])
    ],
    schema: {
      tags: ['security'],
      summary: 'Security statistics',
      description: 'Get security-related statistics (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                csrf: {
                  type: 'object',
                  properties: {
                    active: { type: 'number' },
                    expired: { type: 'number' },
                    used: { type: 'number' },
                    total: { type: 'number' }
                  }
                },
                rateLimit: {
                  type: 'object',
                  properties: {
                    active: { type: 'number' },
                    blocked: { type: 'number' },
                    suspicious: { type: 'number' },
                    total: { type: 'number' }
                  }
                },
                timestamp: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const stats = getSecurityStats();
    
    // Audit log stats access
    AuditLogger.log(request, reply, 'security_stats_accessed', '/security/stats', {
      details: { adminId: request.user?.id },
      risk: 'medium',
      category: 'security'
    });
    
    return reply.sendSuccess(stats, 'Security statistics retrieved');
  });

  /**
   * Unblock IP address (admin only)
   */
  fastify.post('/security/unblock-ip', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['HEAD_ADMIN', 'SUPER_ADMIN'])
    ],
    schema: {
      tags: ['security'],
      summary: 'Unblock IP address',
      description: 'Remove an IP address from the blocked list (admin only)',
      security: [{ bearerAuth: [] }],
      body: ipAddressSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                ip: { type: 'string' },
                unblocked: { type: 'boolean' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { ip } = request.body as { ip: string };
    
    AdvancedRateLimit.unblock(ip);
    
    // Audit log the unblock operation
    AuditLogger.log(request, reply, 'ip_unblocked', '/security/unblock-ip', {
      details: { unlockedIP: ip, adminId: request.user?.id },
      risk: 'high',
      category: 'security'
    });
    
    return reply.sendSuccess({
      ip,
      unblocked: true
    }, `IP ${ip} has been unblocked`);
  });

  /**
   * Security health check
   */
  fastify.get('/security/health', {
    schema: {
      tags: ['security'],
      summary: 'Security health check',
      description: 'Check the health of security systems',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                csrf: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded'] },
                    activeTokens: { type: 'number' }
                  }
                },
                rateLimit: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'critical'] },
                    blockedIPs: { type: 'number' },
                    suspiciousActivity: { type: 'boolean' }
                  }
                },
                overall: { type: 'string', enum: ['healthy', 'degraded', 'critical'] }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const stats = getSecurityStats();
    
    // Assess CSRF health
    const csrfStatus = stats.csrf.active > 1000 ? 'degraded' : 'healthy';
    
    // Assess rate limiting health
    let rateLimitStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (stats.rateLimit.blocked > 10) {
      rateLimitStatus = 'critical';
    } else if (stats.rateLimit.suspicious > 5) {
      rateLimitStatus = 'degraded';
    }
    
    // Overall status
    let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (rateLimitStatus === 'critical') {
      overall = 'critical';
    } else if (csrfStatus === 'degraded' || rateLimitStatus === 'degraded') {
      overall = 'degraded';
    }
    
    const healthData = {
      csrf: {
        status: csrfStatus,
        activeTokens: stats.csrf.active
      },
      rateLimit: {
        status: rateLimitStatus,
        blockedIPs: stats.rateLimit.blocked,
        suspiciousActivity: stats.rateLimit.suspicious > 0
      },
      overall
    };
    
    const httpStatus = overall === 'healthy' ? 200 : 
                      overall === 'degraded' ? 200 : 503;
    
    return reply.status(httpStatus).send(
      ResponseWrapper.success(healthData, `Security systems are ${overall}`)
    );
  });

  /**
   * Security configuration info
   */
  fastify.get('/security/config', {
    schema: {
      tags: ['security'],
      summary: 'Security configuration',
      description: 'Get current security configuration (public info only)',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                rateLimiting: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    defaultWindow: { type: 'string' },
                    authEndpointLimit: { type: 'string' }
                  }
                },
                csrf: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    tokenExpiry: { type: 'string' }
                  }
                },
                headers: {
                  type: 'object',
                  properties: {
                    helmet: { type: 'boolean' },
                    customHeaders: { type: 'boolean' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const config = {
      rateLimiting: {
        enabled: true,
        defaultWindow: '15 minutes',
        authEndpointLimit: '5 requests per 15 minutes'
      },
      csrf: {
        enabled: true,
        tokenExpiry: '30 minutes'
      },
      headers: {
        helmet: true,
        customHeaders: true
      }
    };
    
    return reply.sendSuccess(config, 'Security configuration retrieved');
  });

  /**
   * Get audit logs (admin only)
   */
  fastify.get('/security/audit-logs', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['HEAD_ADMIN', 'SUPER_ADMIN'])
    ],
    schema: {
      tags: ['security'],
      summary: 'Get audit logs',
      description: 'Retrieve audit logs with filtering (admin only)',
      security: [{ bearerAuth: [] }],
      querystring: auditLogsQuerySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                logs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      timestamp: { type: 'string' },
                      userId: { type: 'string' },
                      userEmail: { type: 'string' },
                      action: { type: 'string' },
                      resource: { type: 'string' },
                      success: { type: 'boolean' },
                      risk: { type: 'string' },
                      category: { type: 'string' }
                    }
                  }
                },
                total: { type: 'number' }
              }
            },
            meta: {
              type: 'object',
              properties: {
                pagination: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    limit: { type: 'number' },
                    offset: { type: 'number' },
                    hasNext: { type: 'boolean' },
                    hasPrev: { type: 'boolean' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const query = request.query;
    
    const filters = {
      userId: query.userId,
      action: query.action,
      resource: query.resource,
      risk: query.risk,
      category: query.category,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit || 50,
      offset: query.offset || 0
    };

    const { logs, total } = AuditLogger.getLogs(filters);
    
    // Audit log audit access (meta-audit)
    AuditLogger.log(request, reply, 'audit_logs_accessed', '/security/audit-logs', {
      details: { adminId: request.user?.id, filters },
      risk: 'high',
      category: 'security'
    });
    
    const pagination = ResponseWrapper.createPaginationMeta(
      total,
      filters.limit,
      filters.offset
    );

    return reply.sendPaginated(logs, pagination, 'Audit logs retrieved');
  });

  /**
   * Get audit statistics (admin only)
   */
  fastify.get('/security/audit-stats', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['HEAD_ADMIN', 'SUPER_ADMIN'])
    ],
    schema: {
      tags: ['security'],
      summary: 'Get audit statistics',
      description: 'Get audit log statistics and metrics (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                byRisk: { type: 'object' },
                byCategory: { type: 'object' },
                byAction: { type: 'object' },
                recentActivity: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const stats = AuditLogger.getStats();
    
    // Audit log stats access
    AuditLogger.log(request, reply, 'audit_stats_accessed', '/security/audit-stats', {
      details: { adminId: request.user?.id },
      risk: 'medium',
      category: 'security'
    });
    
    return reply.sendSuccess(stats, 'Audit statistics retrieved');
  });
}
