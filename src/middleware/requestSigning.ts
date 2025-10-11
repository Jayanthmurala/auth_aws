import { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

/**
 * Request signing middleware for internal APIs
 * Verifies HMAC signatures to ensure request integrity
 */
export async function validateRequestSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const signature = request.headers['x-signature'] as string;
  const timestamp = request.headers['x-timestamp'] as string;
  
  if (!signature || !timestamp) {
    return reply.status(401).send({
      success: false,
      message: 'Missing request signature or timestamp',
      code: 'SIGNATURE_MISSING'
    });
  }
  
  // Check timestamp (prevent replay attacks)
  const requestTime = parseInt(timestamp);
  const currentTime = Date.now();
  const timeDiff = Math.abs(currentTime - requestTime);
  
  if (timeDiff > 300000) { // 5 minutes
    return reply.status(401).send({
      success: false,
      message: 'Request timestamp too old',
      code: 'TIMESTAMP_EXPIRED'
    });
  }
  
  // Verify signature
  const payload = JSON.stringify(request.body, Object.keys(request.body || {}).sort()) + timestamp;
  const expectedSignature = createHmac('sha256', env.INTERNAL_API_SECRET!)
    .update(payload)
    .digest('hex');
  
  // Use timing-safe comparison
  const providedSignature = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  
  if (providedSignature.length !== expectedBuffer.length || 
      !timingSafeEqual(providedSignature, expectedBuffer)) {
    return reply.status(401).send({
      success: false,
      message: 'Invalid request signature',
      code: 'SIGNATURE_INVALID'
    });
  }
}

/**
 * Generate signature for outgoing requests
 */
export function generateRequestSignature(body: any, secret: string): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const payload = JSON.stringify(body, Object.keys(body || {}).sort()) + timestamp;
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return { signature, timestamp };
}

/**
 * Middleware factory for request signing validation
 */
export function createRequestSigningMiddleware(options: {
  secret?: string;
  maxAge?: number;
} = {}) {
  const secret = options.secret || env.INTERNAL_API_SECRET;
  const maxAge = options.maxAge || 300000; // 5 minutes
  
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is required for request signing');
  }
  
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['x-signature'] as string;
    const timestamp = request.headers['x-timestamp'] as string;
    
    if (!signature || !timestamp) {
      return reply.status(401).send({
        success: false,
        message: 'Missing request signature or timestamp',
        code: 'SIGNATURE_MISSING'
      });
    }
    
    // Check timestamp
    const requestTime = parseInt(timestamp);
    const currentTime = Date.now();
    
    if (Math.abs(currentTime - requestTime) > maxAge) {
      return reply.status(401).send({
        success: false,
        message: 'Request timestamp expired',
        code: 'TIMESTAMP_EXPIRED'
      });
    }
    
    // Verify signature
    const payload = JSON.stringify(request.body, Object.keys(request.body || {}).sort()) + timestamp;
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    const providedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    
    if (providedBuffer.length !== expectedBuffer.length || 
        !timingSafeEqual(providedBuffer, expectedBuffer)) {
      return reply.status(401).send({
        success: false,
        message: 'Invalid request signature',
        code: 'SIGNATURE_INVALID'
      });
    }
  };
}
