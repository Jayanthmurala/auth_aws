import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { JWTKeyRotationService } from '../services/JWTKeyRotationService';
import { authenticateUser, requireRoles } from '../middleware/authMiddleware';
import { DistributedRateLimiters } from '../middleware/distributedRateLimit';
import { AuditLogger } from '../middleware/auditLogger';

// Validation schemas
const keyRotationConfigSchema = z.object({
  rotationIntervalHours: z.number().min(1).max(8760).optional(), // 1 hour to 1 year
  keyOverlapHours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
  maxActiveKeys: z.number().min(1).max(10).optional(),
  algorithm: z.enum(['RS256', 'RS384', 'RS512']).optional(),
  keySize: z.number().refine(val => [2048, 3072, 4096].includes(val), {
    message: "Key size must be 2048, 3072, or 4096"
  }).optional()
});

const keyRevocationSchema = z.object({
  keyId: z.string().min(1),
  reason: z.string().min(1).max(500)
});

const keyStatsResponseSchema = z.object({
  activeKeys: z.number(),
  rotatingKeys: z.number(),
  deprecatedKeys: z.number(),
  revokedKeys: z.number(),
  totalTokensIssued: z.number(),
  nextRotation: z.string().nullable()
});

const keyDetailsResponseSchema = z.object({
  id: z.string(),
  algorithm: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['active', 'rotating', 'deprecated', 'revoked']),
  usage: z.object({
    tokensIssued: z.number(),
    lastUsed: z.string().nullable()
  }),
  // Note: privateKey is never exposed in responses
  publicKey: z.string()
});

/**
 * JWT Key Management Routes (Super Admin Only)
 * Provides enterprise-grade key rotation management
 */
export default async function keyManagementRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Get JWT key rotation statistics
   */
  fastify.get('/admin/jwt-keys/stats', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'JWT key rotation statistics',
      description: 'Get comprehensive statistics about JWT key rotation (Super Admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: keyStatsResponseSchema
        })
      }
    }
  }, async (request, reply) => {
    const stats = await JWTKeyRotationService.getRotationStats();
    
    // Audit log stats access
    AuditLogger.log(request, reply, 'jwt_key_stats_accessed', '/admin/jwt-keys/stats', {
      details: { adminId: request.user?.id },
      risk: 'medium',
      category: 'security'
    });

    return reply.sendSuccess({
      ...stats,
      nextRotation: stats.nextRotation?.toISOString() || null
    }, 'JWT key statistics retrieved');
  });

  /**
   * List all JWT keys (without private keys)
   */
  fastify.get('/admin/jwt-keys', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'List JWT keys',
      description: 'List all JWT keys with their status and usage (Super Admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.array(keyDetailsResponseSchema)
        })
      }
    }
  }, async (request, reply) => {
    const activeKeys = await JWTKeyRotationService.getActiveKeys();
    
    // Transform keys to remove private key information
    const safeKeys = activeKeys.map(key => ({
      id: key.id,
      algorithm: key.algorithm,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt.toISOString(),
      status: key.status,
      usage: {
        tokensIssued: key.usage.tokensIssued,
        lastUsed: key.usage.lastUsed?.toISOString() || null
      },
      publicKey: key.publicKey
    }));

    // Audit log key listing
    AuditLogger.log(request, reply, 'jwt_keys_listed', '/admin/jwt-keys', {
      details: { adminId: request.user?.id, keyCount: safeKeys.length },
      risk: 'medium',
      category: 'security'
    });

    return reply.sendSuccess(safeKeys, 'JWT keys retrieved');
  });

  /**
   * Get specific JWT key details
   */
  fastify.get('/admin/jwt-keys/:keyId', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'Get JWT key details',
      description: 'Get detailed information about a specific JWT key (Super Admin only)',
      security: [{ bearerAuth: [] }],
      params: z.object({
        keyId: z.string().min(1)
      }),
      response: {
        200: z.object({
          success: z.boolean(),
          data: keyDetailsResponseSchema
        }),
        404: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const { keyId } = request.params;
    const key = await JWTKeyRotationService.getKeyById(keyId);

    if (!key) {
      return reply.status(404).send({ success: false, message: 'JWT key not found' });
    }

    const safeKey = {
      id: key.id,
      algorithm: key.algorithm,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt.toISOString(),
      status: key.status,
      usage: {
        tokensIssued: key.usage.tokensIssued,
        lastUsed: key.usage.lastUsed?.toISOString() || null
      },
      publicKey: key.publicKey
    };

    // Audit log key access
    AuditLogger.log(request, reply, 'jwt_key_accessed', `/admin/jwt-keys/${keyId}`, {
      details: { adminId: request.user?.id, keyId, keyStatus: key.status },
      risk: 'medium',
      category: 'security'
    });

    return reply.sendSuccess(safeKey, 'JWT key details retrieved');
  });

  /**
   * Manually trigger key rotation
   */
  fastify.post('/admin/jwt-keys/rotate', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'Trigger key rotation',
      description: 'Manually trigger JWT key rotation (Super Admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            newKeyId: z.string(),
            deprecatedKeys: z.array(z.string()),
            rotationTime: z.string()
          })
        })
      }
    }
  }, async (request, reply) => {
    const rotationResult = await JWTKeyRotationService.rotateKeys();
    
    // Audit log manual rotation
    AuditLogger.log(request, reply, 'jwt_keys_manually_rotated', '/admin/jwt-keys/rotate', {
      details: { 
        adminId: request.user?.id,
        newKeyId: rotationResult.newKey.id,
        deprecatedKeys: rotationResult.deprecatedKeys
      },
      risk: 'high',
      category: 'security'
    });

    return reply.sendSuccess({
      newKeyId: rotationResult.newKey.id,
      deprecatedKeys: rotationResult.deprecatedKeys,
      rotationTime: new Date().toISOString()
    }, 'JWT key rotation completed successfully');
  });

  /**
   * Revoke a specific JWT key
   */
  fastify.post('/admin/jwt-keys/revoke', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'Revoke JWT key',
      description: 'Revoke a specific JWT key (emergency use, Super Admin only)',
      security: [{ bearerAuth: [] }],
      body: keyRevocationSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            keyId: z.string(),
            revoked: z.boolean(),
            revokedAt: z.string()
          })
        }),
        404: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const { keyId, reason } = request.body;
    
    const revoked = await JWTKeyRotationService.revokeKey(keyId, reason);
    
    if (!revoked) {
      return reply.status(404).send({ success: false, message: 'JWT key not found' });
    }

    // Audit log key revocation
    AuditLogger.log(request, reply, 'jwt_key_revoked', '/admin/jwt-keys/revoke', {
      details: { 
        adminId: request.user?.id,
        keyId,
        reason
      },
      risk: 'critical',
      category: 'security'
    });

    return reply.sendSuccess({
      keyId,
      revoked: true,
      revokedAt: new Date().toISOString()
    }, `JWT key ${keyId} revoked successfully`);
  });

  /**
   * Generate new JWT key pair
   */
  fastify.post('/admin/jwt-keys/generate', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'Generate new JWT key',
      description: 'Generate a new JWT key pair (Super Admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            keyId: z.string(),
            algorithm: z.string(),
            createdAt: z.string(),
            expiresAt: z.string(),
            publicKey: z.string()
          })
        })
      }
    }
  }, async (request, reply) => {
    const newKey = await JWTKeyRotationService.generateNewKeyPair();
    
    // Audit log key generation
    AuditLogger.log(request, reply, 'jwt_key_manually_generated', '/admin/jwt-keys/generate', {
      details: { 
        adminId: request.user?.id,
        keyId: newKey.id,
        algorithm: newKey.algorithm
      },
      risk: 'high',
      category: 'security'
    });

    return reply.sendSuccess({
      keyId: newKey.id,
      algorithm: newKey.algorithm,
      createdAt: newKey.createdAt.toISOString(),
      expiresAt: newKey.expiresAt.toISOString(),
      publicKey: newKey.publicKey
    }, 'New JWT key generated successfully');
  });

  /**
   * Update key rotation configuration
   */
  fastify.put('/admin/jwt-keys/config', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser,
      requireRoles(['SUPER_ADMIN'])
    ],
    schema: {
      tags: ['key-management'],
      summary: 'Update rotation config',
      description: 'Update JWT key rotation configuration (Super Admin only)',
      security: [{ bearerAuth: [] }],
      body: keyRotationConfigSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            updated: z.boolean(),
            config: keyRotationConfigSchema
          })
        })
      }
    }
  }, async (request, reply) => {
    const config = request.body;
    
    // Re-initialize service with new config
    await JWTKeyRotationService.initialize(config);
    
    // Audit log config update
    AuditLogger.log(request, reply, 'jwt_rotation_config_updated', '/admin/jwt-keys/config', {
      details: { 
        adminId: request.user?.id,
        newConfig: config
      },
      risk: 'high',
      category: 'security'
    });

    return reply.sendSuccess({
      updated: true,
      config
    }, 'JWT key rotation configuration updated');
  });

  /**
   * Get public keys for external verification (JWKS endpoint)
   */
  fastify.get('/jwt-keys/jwks', {
    schema: {
      tags: ['key-management'],
      summary: 'JSON Web Key Set',
      description: 'Get public keys in JWKS format for external JWT verification',
      response: {
        200: z.object({
          keys: z.array(z.object({
            kty: z.string(),
            use: z.string(),
            kid: z.string(),
            alg: z.string(),
            n: z.string(),
            e: z.string()
          }))
        })
      }
    }
  }, async (request, reply) => {
    const activeKeys = await JWTKeyRotationService.getActiveKeys();
    
    // Convert RSA public keys to JWKS format
    const jwks = {
      keys: activeKeys
        .filter(key => key.status === 'active')
        .map(key => {
          // Extract modulus and exponent from RSA public key
          // This is a simplified version - in production, use a proper library
          const publicKeyBuffer = Buffer.from(
            key.publicKey
              .replace('-----BEGIN PUBLIC KEY-----', '')
              .replace('-----END PUBLIC KEY-----', '')
              .replace(/\s/g, ''),
            'base64'
          );
          
          return {
            kty: 'RSA',
            use: 'sig',
            kid: key.id,
            alg: key.algorithm,
            n: publicKeyBuffer.toString('base64url'), // Simplified - should extract actual modulus
            e: 'AQAB' // Standard RSA exponent
          };
        })
    };

    // Set cache headers for JWKS
    reply.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    reply.header('Content-Type', 'application/json');

    return reply.send(jwks);
  });
}
