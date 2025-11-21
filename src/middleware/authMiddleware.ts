import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../db.js';
import { Role } from '@prisma/client';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      displayName: string;
      roles: Role[];
      collegeId?: string;
      department?: string;
      year?: number;
      collegeMemberId?: string;
    };
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice('Bearer '.length);
}

/**
 * CRITICAL FIX: Get client IP address handling proxies and load balancers
 * Supports X-Forwarded-For, X-Real-IP, and direct connection
 */
function getClientIp(request: FastifyRequest): string {
  // Check X-Forwarded-For header (most common for proxies/load balancers)
  const xForwardedFor = request.headers['x-forwarded-for'];
  if (xForwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one (client IP)
    const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    const clientIp = ips.split(',')[0].trim();
    if (clientIp) return clientIp;
  }

  // Check X-Real-IP header (used by some proxies)
  const xRealIp = request.headers['x-real-ip'];
  if (xRealIp) {
    const clientIp = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
    if (clientIp) return clientIp;
  }

  // Fallback to request.ip (direct connection or Fastify's trustProxy setting)
  return request.ip || '0.0.0.0';
}

/**
 * Authentication middleware - verifies JWT and populates req.user
 */
export async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const token = extractBearerToken(request);
    if (!token) {
      return reply.code(401).send({
        success: false,
        error: {
          message: 'Missing or invalid authorization header',
          code: 'AUTH_TOKEN_MISSING'
        }
      });
    }

    // Verify JWT token
    const payload = await verifyAccessToken(token);
    if (!payload.sub) {
      return reply.code(401).send({
        success: false,
        error: {
          message: 'Invalid token payload',
          code: 'AUTH_TOKEN_INVALID'
        }
      });
    }

    // Fetch user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        collegeId: true,
        department: true,
        year: true,
        collegeMemberId: true,
        status: true,
        deletedAt: true
      }
    });

    if (!user) {
      return reply.code(401).send({
        success: false,
        error: {
          message: 'User not found',
          code: 'AUTH_USER_NOT_FOUND'
        }
      });
    }

    // Check if user is active
    if (user.status !== 'ACTIVE' || user.deletedAt) {
      return reply.code(401).send({
        success: false,
        error: {
          message: 'User account is inactive',
          code: 'AUTH_USER_INACTIVE'
        }
      });
    }

    // CRITICAL FIX: Validate IP for admin sessions (with proxy/load balancer support)
    const ADMIN_ROLES = ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'];
    const isAdmin = user.roles.some(role => ADMIN_ROLES.includes(role));

    if (isAdmin && (payload as any).ip) {
      // CRITICAL FIX: Use proper IP extraction that handles proxies/load balancers
      const currentIp = getClientIp(request);
      const tokenIp = (payload as any).ip;

      // Only validate IP if it's not a private/loopback address (allows load balancer IPs to vary)
      const isPrivateIp = (ip: string) => {
        return /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|::1|fc|fd)/.test(ip);
      };

      // If token IP is from a private network, skip strict validation (load balancer scenario)
      // Otherwise, enforce IP matching for security
      if (!isPrivateIp(tokenIp) && tokenIp !== currentIp) {
        // Import Logger dynamically to avoid circular dependencies if any
        const { Logger } = await import('../utils/logger.js');
        Logger.security('Admin session IP mismatch detected', {
          severity: 'high',
          event: 'admin_ip_mismatch',
          userId: user.id,
          tokenIp,
          requestIp: currentIp
        });

        return reply.code(401).send({
          success: false,
          error: {
            message: 'Session invalid: IP address changed',
            code: 'AUTH_IP_MISMATCH'
          }
        });
      }
    }

    // HIGH SECURITY: Enforce 5-minute idle timeout for admins
    if (isAdmin) {
      // Import dependencies dynamically
      const { RedisManager } = await import('../config/redis.js');
      const { env } = await import('../config/env.js');

      if (!env.REDIS_DISABLED) {
        try {
          const redis = RedisManager.getInstance();
          const lastActiveKey = `admin:last_active:${user.id}`;
          const lastActive = await redis.get(lastActiveKey);

          if (lastActive) {
            const lastActiveTime = parseInt(lastActive);
            const now = Date.now();
            // 5 minutes idle timeout
            if (now - lastActiveTime > 5 * 60 * 1000) {
              const { Logger } = await import('../utils/logger.js');
              Logger.security('Admin session expired due to inactivity', {
                severity: 'medium',
                event: 'admin_idle_timeout',
                userId: user.id
              });

              return reply.code(401).send({
                success: false,
                error: {
                  message: 'Session expired due to inactivity. Please log in again.',
                  code: 'AUTH_SESSION_EXPIRED'
                }
              });
            }
          }

          // Update last active time (set expiry to 15m to match token)
          await redis.setex(lastActiveKey, 15 * 60, Date.now().toString());
        } catch (error) {
          // Fail open if Redis fails, but log it
          console.error('Redis session check failed:', error);
        }
      }
    }

    // Populate request.user
    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      collegeId: user.collegeId || undefined,
      department: user.department || undefined,
      year: user.year || undefined,
      collegeMemberId: user.collegeMemberId || undefined
    };

  } catch (error) {
    // Log error for debugging (without sensitive data)
    console.error('[AUTH_MIDDLEWARE] Token verification failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });

    return reply.code(401).send({
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'AUTH_TOKEN_EXPIRED'
      }
    });
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    return; // No token provided, continue without user
  }

  try {
    const payload = await verifyAccessToken(token);
    if (payload.sub) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          displayName: true,
          roles: true,
          collegeId: true,
          department: true,
          year: true,
          collegeMemberId: true,
          status: true,
          deletedAt: true
        }
      });

      if (user && user.status === 'ACTIVE' && !user.deletedAt) {
        request.user = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roles: user.roles,
          collegeId: user.collegeId || undefined,
          department: user.department || undefined,
          year: user.year || undefined,
          collegeMemberId: user.collegeMemberId || undefined
        };
      }
    }
  } catch (error) {
    // Silently fail for optional auth
    console.warn('[OPTIONAL_AUTH] Token verification failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Role-based authorization middleware
 */
export function requireRoles(allowedRoles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        }
      });
    }

    const hasRequiredRole = request.user.roles.some(role => allowedRoles.includes(role));
    if (!hasRequiredRole) {
      return reply.code(403).send({
        success: false,
        error: {
          message: 'Insufficient permissions',
          code: 'AUTH_INSUFFICIENT_PERMISSIONS',
          requiredRoles: allowedRoles,
          userRoles: request.user.roles
        }
      });
    }
  };
}

/**
 * @deprecated Use apiKeyAuth from apiKeyAuth.ts instead
 * This function uses static API key comparison without rotation support.
 * The new implementation supports automatic key rotation and is more secure.
 * 
 * Migration: Replace with `import { apiKeyAuth } from '../middleware/apiKeyAuth.js'`
 * 
 * API Key authentication for internal/cron endpoints
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error('[API_KEY_AUTH] INTERNAL_API_KEY environment variable not set');
    return reply.code(500).send({
      success: false,
      error: {
        message: 'Internal server configuration error',
        code: 'CONFIG_ERROR'
      }
    });
  }

  if (!apiKey) {
    return reply.code(401).send({
      success: false,
      error: {
        message: 'API key required',
        code: 'API_KEY_MISSING'
      }
    });
  }

  // Use constant-time comparison to prevent timing attacks
  if (!constantTimeCompare(apiKey, expectedKey)) {
    return reply.code(401).send({
      success: false,
      error: {
        message: 'Invalid API key',
        code: 'API_KEY_INVALID'
      }
    });
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
