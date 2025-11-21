import { FastifyRequest, FastifyReply } from 'fastify';
import { APIKeyRotationService } from '../services/APIKeyRotationService.js';
import { Logger } from '../utils/logger.js';

/**
 * CRITICAL FIX: API Key Authentication Middleware
 * Validates internal service requests using rotated API keys
 */
export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey) {
    Logger.security('[API Key Auth] Missing API key in request', {
      severity: 'medium',
      ip: request.ip,
      path: request.url,
      event: 'missing_api_key'
    });

    return reply.status(401).send({
      success: false,
      message: 'API key required'
    });
  }

  try {
    const result = await APIKeyRotationService.verifyKey(apiKey);

    if (!result.valid) {
      Logger.security('[API Key Auth] Invalid API key provided', {
        severity: 'high',
        ip: request.ip,
        path: request.url,
        event: 'invalid_api_key'
      });

      return reply.status(401).send({
        success: false,
        message: 'Invalid API key'
      });
    }

    // Attach key ID to request for audit logging
    (request as any).apiKeyId = result.keyId;

    Logger.debug('[API Key Auth] API key verified', {
      keyId: result.keyId,
      path: request.url,
      event: 'api_key_verified'
    });
  } catch (error) {
    Logger.security('[API Key Auth] Error verifying API key', {
      severity: 'high',
      message: error instanceof Error ? error.message : String(error),
      event: 'verification_error'
    });

    return reply.status(500).send({
      success: false,
      message: 'Internal server error'
    });
  }
}

/**
 * Optional: Get current API key statistics
 */
export async function getAPIKeyStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const stats = await APIKeyRotationService.getStatistics();
    
    return reply.send({
      success: true,
      data: stats
    });
  } catch (error) {
    Logger.security('[API Key Stats] Error retrieving statistics', {
      severity: 'medium',
      message: error instanceof Error ? error.message : String(error),
      event: 'stats_error'
    });

    return reply.status(500).send({
      success: false,
      message: 'Failed to retrieve statistics'
    });
  }
}
