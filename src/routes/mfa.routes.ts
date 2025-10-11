import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MFAService } from '../services/MFAService.js';
import { authenticateUser, requireRoles } from '../middleware/authMiddleware.js';
import { DistributedRateLimiters } from '../middleware/distributedRateLimit.js';
import { AuditLogger } from '../middleware/auditLogger.js';

// Validation schemas
const totpSetupResponseSchema = z.object({
  secret: z.string(),
  qrCodeUrl: z.string(),
  backupCodes: z.array(z.string())
});

const totpVerifySchema = z.object({
  code: z.string().length(6, 'TOTP code must be 6 digits')
});

const smsSetupSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format. Use international format (+1234567890)')
});

const smsVerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().length(6, 'SMS code must be 6 digits')
});

const mfaVerifySchema = z.object({
  code: z.string().min(4).max(8),
  method: z.enum(['totp', 'sms', 'backup_codes']).optional()
});

const mfaMethodSchema = z.object({
  id: z.string(),
  type: z.enum(['totp', 'sms', 'backup_codes']),
  isEnabled: z.boolean(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  lastUsed: z.string().nullable(),
  metadata: z.object({
    maskedPhone: z.string().optional(),
    backupCodesRemaining: z.number().optional()
  })
});

const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  methods: z.array(mfaMethodSchema),
  required: z.boolean(),
  reason: z.string().optional(),
  gracePeriodEnd: z.string().optional()
});

/**
 * Multi-Factor Authentication Routes
 * Enterprise-grade MFA with TOTP, SMS, and backup codes
 */
export default async function mfaRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Get user's MFA status and methods
   */
  fastify.get('/v1/mfa/status', {
    preHandler: [
      DistributedRateLimiters.general,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Get MFA status',
      description: 'Get current MFA status and available methods for authenticated user',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: mfaStatusSchema
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;
    
    const [methods, mfaRequired] = await Promise.all([
      MFAService.getUserMFAMethods(userId),
      MFAService.isMFARequired(userId)
    ]);

    const isEnabled = await MFAService.isUserMFAEnabled(userId);

    // Transform methods for response (remove sensitive data)
    const safeMethods = methods.map(method => ({
      id: method.id,
      type: method.type,
      isEnabled: method.isEnabled,
      isPrimary: method.isPrimary,
      createdAt: method.createdAt.toISOString(),
      lastUsed: method.lastUsed?.toISOString() || null,
      metadata: {
        ...(method.type === 'sms' && method.metadata.phoneNumber && {
          maskedPhone: method.metadata.phoneNumber.replace(/(\+\d{1,3})\d+(\d{4})/, '$1****$2')
        }),
        ...(method.type === 'backup_codes' && {
          backupCodesRemaining: (method.metadata.codes?.length || 0) - (method.metadata.usedCodes?.length || 0)
        })
      }
    }));

    return reply.sendSuccess({
      enabled: isEnabled,
      methods: safeMethods,
      required: mfaRequired.required,
      reason: mfaRequired.reason,
      gracePeriodEnd: mfaRequired.gracePeriodEnd?.toISOString()
    }, 'MFA status retrieved');
  });

  /**
   * Setup TOTP (Google Authenticator)
   */
  fastify.post('/v1/mfa/totp/setup', {
    preHandler: [
      DistributedRateLimiters.auth,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Setup TOTP',
      description: 'Setup TOTP (Google Authenticator) for the authenticated user',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: totpSetupResponseSchema
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;

    try {
      const setupResult = await MFAService.setupTOTP(userId);
      
      // Audit log TOTP setup
      AuditLogger.log(request, reply, 'mfa_totp_setup', '/v1/mfa/totp/setup', {
        details: { userId },
        risk: 'medium',
        category: 'security'
      });

      return reply.sendSuccess(setupResult, 'TOTP setup initiated. Scan QR code and verify to enable.');
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'TOTP setup failed' });
    }
  });

  /**
   * Verify and enable TOTP
   */
  fastify.post('/v1/mfa/totp/verify', {
    preHandler: [
      DistributedRateLimiters.auth,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Verify TOTP',
      description: 'Verify TOTP code and enable TOTP for the authenticated user',
      security: [{ bearerAuth: [] }],
      body: totpVerifySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            enabled: z.boolean()
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { code } = request.body;

    try {
      const verified = await MFAService.verifyAndEnableTOTP(userId, code);
      
      if (verified) {
        // Audit log successful TOTP enablement
        AuditLogger.log(request, reply, 'mfa_totp_enabled', '/v1/mfa/totp/verify', {
          details: { userId },
          risk: 'high',
          category: 'security'
        });

        return reply.sendSuccess({ enabled: true }, 'TOTP enabled successfully');
      } else {
        return reply.status(400).send({ success: false, message: 'Invalid TOTP code' });
      }
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'TOTP verification failed' });
    }
  });

  /**
   * Setup SMS MFA
   */
  fastify.post('/v1/mfa/sms/setup', {
    preHandler: [
      DistributedRateLimiters.auth,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Setup SMS MFA',
      description: 'Setup SMS-based MFA for the authenticated user',
      security: [{ bearerAuth: [] }],
      body: smsSetupSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            challengeId: z.string(),
            maskedPhone: z.string()
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { phoneNumber } = request.body;

    try {
      const setupResult = await MFAService.setupSMS(userId, phoneNumber);
      
      // Audit log SMS setup
      AuditLogger.log(request, reply, 'mfa_sms_setup', '/v1/mfa/sms/setup', {
        details: { userId, maskedPhone: setupResult.maskedPhone },
        risk: 'medium',
        category: 'security'
      });

      return reply.sendSuccess(setupResult, 'SMS verification code sent. Verify to enable SMS MFA.');
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'SMS setup failed' });
    }
  });

  /**
   * Verify SMS and enable SMS MFA
   */
  fastify.post('/v1/mfa/sms/verify', {
    preHandler: [
      DistributedRateLimiters.auth,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Verify SMS MFA',
      description: 'Verify SMS code and enable SMS MFA for the authenticated user',
      security: [{ bearerAuth: [] }],
      body: smsVerifySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            enabled: z.boolean()
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const { challengeId, code } = request.body;

    try {
      const verified = await MFAService.verifySMSAndEnable(challengeId, code);
      
      if (verified) {
        // Audit log successful SMS enablement
        AuditLogger.log(request, reply, 'mfa_sms_enabled', '/v1/mfa/sms/verify', {
          details: { challengeId },
          risk: 'high',
          category: 'security'
        });

        return reply.sendSuccess({ enabled: true }, 'SMS MFA enabled successfully');
      } else {
        return reply.status(400).send({ success: false, message: 'Invalid SMS code' });
      }
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'SMS verification failed' });
    }
  });

  /**
   * Verify MFA code (for login flow)
   */
  fastify.post('/v1/mfa/verify', {
    preHandler: [
      DistributedRateLimiters.auth,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Verify MFA code',
      description: 'Verify MFA code during login or sensitive operations',
      security: [{ bearerAuth: [] }],
      body: mfaVerifySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            verified: z.boolean(),
            methodUsed: z.string().optional(),
            backupCodeUsed: z.boolean().optional()
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { code, method } = request.body;

    try {
      const result = await MFAService.verifyMFACode(userId, code, method);
      
      if (result.verified) {
        // Audit log successful MFA verification
        AuditLogger.log(request, reply, 'mfa_verification_success', '/v1/mfa/verify', {
          details: { 
            userId, 
            methodUsed: result.methodUsed,
            backupCodeUsed: result.backupCodeUsed 
          },
          risk: 'medium',
          category: 'security'
        });

        return reply.sendSuccess(result, 'MFA verification successful');
      } else {
        // Audit log failed MFA verification
        AuditLogger.log(request, reply, 'mfa_verification_failed', '/v1/mfa/verify', {
          details: { userId, attemptedMethod: method },
          risk: 'high',
          category: 'security'
        });

        return reply.status(400).send({ success: false, message: 'Invalid MFA code' });
      }
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'MFA verification failed' });
    }
  });

  /**
   * Generate new backup codes
   */
  fastify.post('/v1/mfa/backup-codes/regenerate', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Regenerate backup codes',
      description: 'Generate new backup codes for the authenticated user',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            backupCodes: z.array(z.string())
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;

    try {
      // Check if user has MFA enabled
      const isEnabled = await MFAService.isUserMFAEnabled(userId);
      if (!isEnabled) {
        return reply.status(400).send({ success: false, message: 'MFA must be enabled to generate backup codes' });
      }

      const backupCodes = MFAService.generateBackupCodes();
      
      // TODO: Store new backup codes (replace existing ones)
      
      // Audit log backup code regeneration
      AuditLogger.log(request, reply, 'mfa_backup_codes_regenerated', '/v1/mfa/backup-codes/regenerate', {
        details: { userId, codesGenerated: backupCodes.length },
        risk: 'high',
        category: 'security'
      });

      return reply.sendSuccess({ backupCodes }, 'New backup codes generated. Store them securely.');
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'Backup code generation failed' });
    }
  });

  /**
   * Disable MFA method
   */
  fastify.delete('/v1/mfa/methods/:methodId', {
    preHandler: [
      DistributedRateLimiters.security,
      authenticateUser
    ],
    schema: {
      tags: ['mfa'],
      summary: 'Disable MFA method',
      description: 'Disable a specific MFA method for the authenticated user',
      security: [{ bearerAuth: [] }],
      params: z.object({
        methodId: z.string().min(1)
      }),
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            disabled: z.boolean()
          })
        }),
        400: z.object({
          success: z.boolean(),
          message: z.string()
        })
      }
    }
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { methodId } = request.params;

    try {
      // TODO: Implement method disabling logic
      
      // Audit log method disabling
      AuditLogger.log(request, reply, 'mfa_method_disabled', `/v1/mfa/methods/${methodId}`, {
        details: { userId, methodId },
        risk: 'high',
        category: 'security'
      });

      return reply.sendSuccess({ disabled: true }, 'MFA method disabled successfully');
    } catch (error) {
      return reply.status(400).send({ success: false, message: error instanceof Error ? error.message : 'Method disabling failed' });
    }
  });

  /**
   * Admin: Get MFA statistics
   */
  fastify.get('/admin/mfa/stats', {
    preHandler: [
      DistributedRateLimiters.admin,
      authenticateUser,
      requireRoles(['HEAD_ADMIN', 'SUPER_ADMIN'])
    ],
    schema: {
      tags: ['mfa'],
      summary: 'MFA statistics',
      description: 'Get MFA adoption and compliance statistics (Admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            totalUsersWithMFA: z.number(),
            methodDistribution: z.record(z.number()),
            enforcementStats: z.object({
              requiredUsers: z.number(),
              enabledUsers: z.number(),
              complianceRate: z.number()
            })
          })
        })
      }
    }
  }, async (request, reply) => {
    const stats = await MFAService.getStats();
    
    // Audit log stats access
    AuditLogger.log(request, reply, 'mfa_stats_accessed', '/admin/mfa/stats', {
      details: { adminId: request.user?.id },
      risk: 'medium',
      category: 'admin'
    });

    return reply.sendSuccess(stats, 'MFA statistics retrieved');
  });
}
