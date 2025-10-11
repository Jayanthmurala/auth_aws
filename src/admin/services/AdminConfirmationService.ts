import { randomBytes, createHash } from 'crypto';
import { RedisManager, RedisKeys } from '../../config/redis.js';
import { env } from '../../config/env.js';

/**
 * Admin Confirmation Service
 * Handles MFA confirmation for sensitive admin operations
 */

export interface ConfirmationChallenge {
  id: string;
  adminId: string;
  operation: string;
  targetId?: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
  metadata?: any;
}

export class AdminConfirmationService {
  private static readonly CONFIRMATION_TIMEOUT_MINUTES = parseInt(
    env.CONFIRMATION_TOKEN_TIMEOUT_MINUTES || '10'
  );
  private static readonly MAX_ATTEMPTS = 3;

  /**
   * Generate confirmation challenge for password reset
   */
  static async generatePasswordResetChallenge(
    adminId: string,
    targetUserId: string
  ): Promise<string> {
    const challengeId = randomBytes(16).toString('hex');
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
    
    const challenge: ConfirmationChallenge = {
      id: challengeId,
      adminId,
      operation: 'PASSWORD_RESET',
      targetId: targetUserId,
      code,
      expiresAt: new Date(Date.now() + this.CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000),
      attempts: 0,
      maxAttempts: this.MAX_ATTEMPTS,
      verified: false,
      metadata: { targetUserId }
    };

    // Store in Redis
    const redis = RedisManager.getInstance();
    const key = `admin_confirmation:${challengeId}`;
    await redis.setex(
      key,
      this.CONFIRMATION_TIMEOUT_MINUTES * 60,
      JSON.stringify(challenge)
    );

    // Log challenge generation (simplified for now)
    console.log(`[AUDIT] MFA Challenge generated for admin ${adminId}, operation: PASSWORD_RESET, target: ${targetUserId}`);

    // In a real implementation, send the code via admin's preferred MFA method
    // For now, we'll log it (remove in production)
    console.log(`[DEV] Admin MFA Code for ${adminId}: ${code}`);

    return challengeId;
  }

  /**
   * Generate confirmation challenge for bulk operations
   */
  static async generateBulkOperationChallenge(
    adminId: string,
    operation: string,
    userCount: number,
    metadata?: any
  ): Promise<string> {
    const challengeId = randomBytes(16).toString('hex');
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    const challenge: ConfirmationChallenge = {
      id: challengeId,
      adminId,
      operation: `BULK_${operation}`,
      code,
      expiresAt: new Date(Date.now() + this.CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000),
      attempts: 0,
      maxAttempts: this.MAX_ATTEMPTS,
      verified: false,
      metadata: { operation, userCount, ...metadata }
    };

    const redis = RedisManager.getInstance();
    const key = `admin_confirmation:${challengeId}`;
    await redis.setex(
      key,
      this.CONFIRMATION_TIMEOUT_MINUTES * 60,
      JSON.stringify(challenge)
    );

    console.log(`[AUDIT] Bulk operation confirmation generated for admin ${adminId}, operation: ${operation}, userCount: ${userCount}`);

    console.log(`[DEV] Admin Bulk Operation Code for ${adminId}: ${code}`);

    return challengeId;
  }

  /**
   * Verify confirmation code
   */
  static async verifyConfirmationCode(
    challengeId: string,
    code: string,
    adminId: string
  ): Promise<{ valid: boolean; challenge?: ConfirmationChallenge; error?: string }> {
    const redis = RedisManager.getInstance();
    const key = `admin_confirmation:${challengeId}`;
    
    try {
      const challengeData = await redis.get(key);
      if (!challengeData) {
        return { valid: false, error: 'Challenge not found or expired' };
      }

      const challenge: ConfirmationChallenge = JSON.parse(challengeData);

      // Verify admin ID matches
      if (challenge.adminId !== adminId) {
        console.log(`[AUDIT] MFA verification failed for admin ${adminId}: Admin ID mismatch`);
        return { valid: false, error: 'Invalid challenge' };
      }

      // Check if already verified
      if (challenge.verified) {
        return { valid: false, error: 'Challenge already used' };
      }

      // Check expiration
      if (new Date() > challenge.expiresAt) {
        await redis.del(key);
        return { valid: false, error: 'Challenge expired' };
      }

      // Check max attempts
      if (challenge.attempts >= challenge.maxAttempts) {
        await redis.del(key);
        console.log(`[AUDIT] MFA verification failed for admin ${adminId}: Max attempts exceeded`);
        return { valid: false, error: 'Maximum attempts exceeded' };
      }

      // Increment attempts
      challenge.attempts++;

      // Verify code
      if (challenge.code !== code) {
        // Update attempts in Redis
        await redis.setex(
          key,
          Math.floor((challenge.expiresAt.getTime() - Date.now()) / 1000),
          JSON.stringify(challenge)
        );

        console.log(`[AUDIT] MFA verification failed for admin ${adminId}: Invalid code, attempts: ${challenge.attempts}`);

        return { valid: false, error: 'Invalid confirmation code' };
      }

      // Mark as verified and remove from Redis
      challenge.verified = true;
      await redis.del(key);

      console.log(`[AUDIT] MFA verification successful for admin ${adminId}, operation: ${challenge.operation}`);

      return { valid: true, challenge };
    } catch (error) {
      console.log(`[AUDIT] MFA verification error for admin ${adminId}: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return { valid: false, error: 'Verification failed' };
    }
  }

  /**
   * Generate simple confirmation token (for less sensitive operations)
   */
  static async generateConfirmationToken(
    adminId: string,
    operation: string,
    metadata?: any
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    
    const confirmation = {
      adminId,
      operation,
      metadata,
      expiresAt: new Date(Date.now() + this.CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000),
      created: new Date()
    };

    const redis = RedisManager.getInstance();
    const key = `admin_token:${hash}`;
    await redis.setex(
      key,
      this.CONFIRMATION_TIMEOUT_MINUTES * 60,
      JSON.stringify(confirmation)
    );

    return token;
  }

  /**
   * Verify confirmation token
   */
  static async verifyConfirmationToken(
    adminId: string,
    token: string
  ): Promise<boolean> {
    const hash = createHash('sha256').update(token).digest('hex');
    const redis = RedisManager.getInstance();
    const key = `admin_token:${hash}`;
    
    try {
      const confirmationData = await redis.get(key);
      if (!confirmationData) {
        return false;
      }

      const confirmation = JSON.parse(confirmationData);
      
      // Verify admin ID and expiration
      if (confirmation.adminId !== adminId || new Date() > new Date(confirmation.expiresAt)) {
        await redis.del(key);
        return false;
      }

      // Remove token after successful verification (single use)
      await redis.del(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up expired challenges (called by cron job)
   */
  static async cleanupExpiredChallenges(): Promise<number> {
    const redis = RedisManager.getInstance();
    const pattern = 'admin_confirmation:*';
    const keys = await redis.keys(pattern);
    
    let cleaned = 0;
    for (const key of keys) {
      const challengeData = await redis.get(key);
      if (challengeData) {
        const challenge: ConfirmationChallenge = JSON.parse(challengeData);
        if (new Date() > challenge.expiresAt) {
          await redis.del(key);
          cleaned++;
        }
      }
    }

    return cleaned;
  }
}
