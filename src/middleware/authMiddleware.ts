import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../db';
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
  return async function(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
