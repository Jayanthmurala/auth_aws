import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminRequest } from './adminAuth.js';
import { AuditAction } from '../types/adminTypes.js';

/**
 * Middleware to automatically log admin actions
 */
export function auditLogger(action: AuditAction, targetType: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const adminRequest = request as AdminRequest;
    
    if (!adminRequest.admin) {
      return;
    }

    // Store admin context for later logging
    (request as any).auditContext = {
      action,
      targetType,
      admin: adminRequest.admin
    };
  };
}

/**
 * Extract target ID from request or response
 */
function extractTargetId(request: FastifyRequest, responseData: any): string | undefined {
  // Try to get ID from URL params first
  const params = request.params as any;
  if (params?.id) {
    return params.id;
  }
  if (params?.userId) {
    return params.userId;
  }

  // Try to get ID from response data
  if (responseData?.data?.id) {
    return responseData.data.id;
  }
  if (responseData?.id) {
    return responseData.id;
  }

  return undefined;
}

/**
 * Extract action details from request and response
 */
function extractActionDetails(
  request: FastifyRequest, 
  responseData: any, 
  action: AuditAction
): Record<string, any> {
  const details: Record<string, any> = {
    method: request.method,
    url: request.url,
    action
  };

  // Add request body for create/update operations
  if (['CREATE_USER', 'UPDATE_USER', 'CREATE_ADMIN', 'UPDATE_ADMIN', 'BULK_IMPORT'].includes(action)) {
    if (request.body) {
      // Sanitize sensitive data
      const sanitizedBody = { ...request.body as any };
      delete sanitizedBody.password;
      delete sanitizedBody.passwordHash;
      details.requestData = sanitizedBody;
    }
  }

  // Add query parameters for list/search operations
  if (request.query && Object.keys(request.query).length > 0) {
    details.queryParams = request.query;
  }

  // Add response summary for bulk operations
  if (action.startsWith('BULK_') && responseData?.data) {
    const { totalProcessed, successful, failed } = responseData.data;
    details.bulkResult = { totalProcessed, successful, failed };
  }

  return details;
}

/**
 * Manual audit logging for custom scenarios
 */
export async function logAdminAction(
  request: FastifyRequest,
  action: AuditAction,
  targetType: string,
  targetId?: string,
  details?: Record<string, any>,
  success: boolean = true,
  errorMessage?: string
) {
  const adminRequest = request as AdminRequest;
  
  if (!adminRequest.admin) {
    return;
  }

  try {
    // Import AdminAuditService dynamically to avoid circular dependency
    const { AdminAuditService } = await import('../services/AdminAuditService.js');
    
    await AdminAuditService.logAction({
      adminId: adminRequest.admin.id,
      action,
      targetType,
      targetId,
      details,
      ipAddress: adminRequest.admin.ipAddress,
      userAgent: adminRequest.admin.userAgent,
      collegeId: adminRequest.admin.collegeId,
      success,
      errorMessage
    });
  } catch (error) {
    request.log.error({ error }, 'Failed to manually log admin action');
  }
}
