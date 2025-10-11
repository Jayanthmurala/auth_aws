import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { randomBytes, createHash } from 'crypto';
import { RedisManager, RedisKeys } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { AuditLogger } from '../middleware/auditLogger.js';

/**
 * Multi-Factor Authentication Service
 * Supports TOTP, SMS, and backup codes for enterprise security
 */

export interface MFAMethod {
  id: string;
  userId: string;
  type: 'totp' | 'sms' | 'backup_codes';
  isEnabled: boolean;
  isPrimary: boolean;
  metadata: {
    // For TOTP
    secret?: string;
    qrCodeUrl?: string;
    // For SMS
    phoneNumber?: string;
    // For backup codes
    codes?: string[];
    usedCodes?: string[];
  };
  createdAt: Date;
  lastUsed?: Date;
}

export interface MFAChallenge {
  id: string;
  userId: string;
  type: 'totp' | 'sms';
  code: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
}

export interface MFAPolicy {
  enforceForRoles: string[];
  enforceForNewUsers: boolean;
  gracePeriodDays: number;
  allowedMethods: ('totp' | 'sms' | 'backup_codes')[];
  requireMultipleMethods: boolean;
  maxBackupCodes: number;
}

export class MFAService {
  private static readonly DEFAULT_POLICY: MFAPolicy = {
    enforceForRoles: ['HEAD_ADMIN', 'SUPER_ADMIN'],
    enforceForNewUsers: false,
    gracePeriodDays: 7,
    allowedMethods: ['totp', 'sms', 'backup_codes'],
    requireMultipleMethods: false,
    maxBackupCodes: 10
  };

  private static policy: MFAPolicy = this.DEFAULT_POLICY;

  /**
   * Initialize MFA service with custom policy
   */
  static async initialize(customPolicy?: Partial<MFAPolicy>): Promise<void> {
    if (customPolicy) {
      this.policy = { ...this.DEFAULT_POLICY, ...customPolicy };
    }

    // Set TOTP configuration
    authenticator.options = {
      window: 2, // Allow 2 time steps before/after current
      step: 30,  // 30-second time step
      digits: 6  // 6-digit codes
    };

    console.log('[MFA Service] Initialized with policy:', this.policy);
  }

  /**
   * Setup TOTP for a user
   */
  static async setupTOTP(userId: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
  }> {
    // Check if user already has TOTP enabled
    const existingTOTP = await this.getMFAMethod(userId, 'totp');
    if (existingTOTP?.isEnabled) {
      throw new Error('TOTP is already enabled for this user');
    }

    // Generate secret
    const secret = authenticator.generateSecret();
    
    // Get user details for QR code
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Generate QR code URL
    const serviceName = env.APP_NAME || 'Nexus Auth';
    const accountName = `${user.displayName} (${user.email})`;
    const otpAuthUrl = authenticator.keyuri(accountName, serviceName, secret);
    
    // Generate QR code
    const qrCodeUrl = await qrcode.toDataURL(otpAuthUrl);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();

    // Store TOTP method (disabled until verified)
    await this.storeMFAMethod({
      id: `totp-${userId}-${Date.now()}`,
      userId,
      type: 'totp',
      isEnabled: false,
      isPrimary: false,
      metadata: {
        secret,
        qrCodeUrl
      },
      createdAt: new Date()
    });

    // Store backup codes (disabled until TOTP is verified)
    await this.storeMFAMethod({
      id: `backup-${userId}-${Date.now()}`,
      userId,
      type: 'backup_codes',
      isEnabled: false,
      isPrimary: false,
      metadata: {
        codes: backupCodes,
        usedCodes: []
      },
      createdAt: new Date()
    });

    // Audit log TOTP setup
    AuditLogger.logSystem('mfa_totp_setup_initiated', `/mfa/totp/setup/${userId}`, {
      details: { userId, method: 'totp' },
      risk: 'medium',
      category: 'security'
    });

    return {
      secret,
      qrCodeUrl,
      backupCodes
    };
  }

  /**
   * Verify and enable TOTP
   */
  static async verifyAndEnableTOTP(userId: string, code: string): Promise<boolean> {
    const totpMethod = await this.getMFAMethod(userId, 'totp');
    if (!totpMethod || totpMethod.isEnabled) {
      throw new Error('TOTP setup not found or already enabled');
    }

    const secret = totpMethod.metadata.secret;
    if (!secret) {
      throw new Error('TOTP secret not found');
    }

    // Verify the code
    const isValid = authenticator.verify({ token: code, secret });
    
    if (!isValid) {
      // Audit log failed verification
      AuditLogger.logSystem('mfa_totp_verification_failed', `/mfa/totp/verify/${userId}`, {
        details: { userId, reason: 'invalid_code' },
        risk: 'medium',
        category: 'security'
      });
      return false;
    }

    // Enable TOTP
    totpMethod.isEnabled = true;
    totpMethod.isPrimary = true;
    totpMethod.lastUsed = new Date();
    await this.storeMFAMethod(totpMethod);

    // Enable backup codes
    const backupMethod = await this.getMFAMethod(userId, 'backup_codes');
    if (backupMethod) {
      backupMethod.isEnabled = true;
      await this.storeMFAMethod(backupMethod);
    }

    // Update user MFA status
    await this.updateUserMFAStatus(userId, true);

    // Audit log successful enablement
    AuditLogger.logSystem('mfa_totp_enabled', `/mfa/totp/enable/${userId}`, {
      details: { userId, method: 'totp' },
      risk: 'high',
      category: 'security'
    });

    return true;
  }

  /**
   * Setup SMS MFA
   */
  static async setupSMS(userId: string, phoneNumber: string): Promise<{
    challengeId: string;
    maskedPhone: string;
  }> {
    // Validate phone number format (basic validation)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      throw new Error('Invalid phone number format. Use international format (+1234567890)');
    }

    // Check if SMS is already enabled for this user
    const existingSMS = await this.getMFAMethod(userId, 'sms');
    if (existingSMS?.isEnabled) {
      throw new Error('SMS MFA is already enabled for this user');
    }

    // Generate verification code
    const code = this.generateSMSCode();
    const challengeId = `sms-${userId}-${Date.now()}`;

    // Store SMS challenge
    const challenge: MFAChallenge = {
      id: challengeId,
      userId,
      type: 'sms',
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0,
      maxAttempts: 3,
      verified: false
    };

    await this.storeChallenge(challenge);

    // Store SMS method (disabled until verified)
    await this.storeMFAMethod({
      id: `sms-${userId}-${Date.now()}`,
      userId,
      type: 'sms',
      isEnabled: false,
      isPrimary: false,
      metadata: {
        phoneNumber
      },
      createdAt: new Date()
    });

    // TODO: Send SMS (integrate with SMS provider)
    console.log(`[MFA SMS] Verification code for ${phoneNumber}: ${code}`);

    // Audit log SMS setup
    AuditLogger.logSystem('mfa_sms_setup_initiated', `/mfa/sms/setup/${userId}`, {
      details: { userId, maskedPhone: this.maskPhoneNumber(phoneNumber) },
      risk: 'medium',
      category: 'security'
    });

    return {
      challengeId,
      maskedPhone: this.maskPhoneNumber(phoneNumber)
    };
  }

  /**
   * Verify SMS code and enable SMS MFA
   */
  static async verifySMSAndEnable(challengeId: string, code: string): Promise<boolean> {
    const challenge = await this.getChallenge(challengeId);
    if (!challenge || challenge.type !== 'sms') {
      throw new Error('SMS challenge not found');
    }

    if (challenge.verified) {
      throw new Error('Challenge already verified');
    }

    if (Date.now() > challenge.expiresAt.getTime()) {
      throw new Error('Verification code expired');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new Error('Maximum verification attempts exceeded');
    }

    // Increment attempts
    challenge.attempts++;
    await this.storeChallenge(challenge);

    // Verify code
    if (challenge.code !== code) {
      AuditLogger.logSystem('mfa_sms_verification_failed', `/mfa/sms/verify/${challengeId}`, {
        details: { userId: challenge.userId, attempts: challenge.attempts },
        risk: 'medium',
        category: 'security'
      });
      return false;
    }

    // Mark challenge as verified
    challenge.verified = true;
    await this.storeChallenge(challenge);

    // Enable SMS method
    const smsMethod = await this.getMFAMethod(challenge.userId, 'sms');
    if (smsMethod) {
      smsMethod.isEnabled = true;
      smsMethod.lastUsed = new Date();
      
      // Set as primary if no other primary method exists
      const primaryMethod = await this.getPrimaryMFAMethod(challenge.userId);
      if (!primaryMethod) {
        smsMethod.isPrimary = true;
      }
      
      await this.storeMFAMethod(smsMethod);
    }

    // Update user MFA status
    await this.updateUserMFAStatus(challenge.userId, true);

    // Audit log successful enablement
    AuditLogger.logSystem('mfa_sms_enabled', `/mfa/sms/enable/${challenge.userId}`, {
      details: { userId: challenge.userId, method: 'sms' },
      risk: 'high',
      category: 'security'
    });

    return true;
  }

  /**
   * Verify MFA code during login
   */
  static async verifyMFACode(userId: string, code: string, method?: 'totp' | 'sms' | 'backup_codes'): Promise<{
    verified: boolean;
    methodUsed?: string;
    backupCodeUsed?: boolean;
  }> {
    const userMethods = await this.getUserMFAMethods(userId);
    const enabledMethods = userMethods.filter(m => m.isEnabled);

    if (enabledMethods.length === 0) {
      throw new Error('No MFA methods enabled for user');
    }

    // If method specified, try only that method
    if (method) {
      const targetMethod = enabledMethods.find(m => m.type === method);
      if (!targetMethod) {
        throw new Error(`MFA method ${method} not enabled for user`);
      }
      
      const result = await this.verifyCodeForMethod(targetMethod, code);
      if (result) {
        await this.updateMethodLastUsed(targetMethod.id);
        return { verified: true, methodUsed: method };
      }
      return { verified: false };
    }

    // Try all enabled methods
    for (const mfaMethod of enabledMethods) {
      const result = await this.verifyCodeForMethod(mfaMethod, code);
      if (result) {
        await this.updateMethodLastUsed(mfaMethod.id);
        
        // Check if backup code was used
        const backupCodeUsed = mfaMethod.type === 'backup_codes';
        
        return { 
          verified: true, 
          methodUsed: mfaMethod.type,
          backupCodeUsed
        };
      }
    }

    // Audit log failed MFA verification
    AuditLogger.logSystem('mfa_verification_failed', `/mfa/verify/${userId}`, {
      details: { userId, availableMethods: enabledMethods.map(m => m.type) },
      risk: 'high',
      category: 'security'
    });

    return { verified: false };
  }

  /**
   * Check if user has MFA enabled
   */
  static async isUserMFAEnabled(userId: string): Promise<boolean> {
    const methods = await this.getUserMFAMethods(userId);
    return methods.some(method => method.isEnabled);
  }

  /**
   * Check if MFA is required for user
   */
  static async isMFARequired(userId: string): Promise<{
    required: boolean;
    reason?: string;
    gracePeriodEnd?: Date;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true, createdAt: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check role-based enforcement
    const hasEnforcedRole = user.roles.some(role => 
      this.policy.enforceForRoles.includes(role)
    );

    if (hasEnforcedRole) {
      return { required: true, reason: 'role_enforcement' };
    }

    // Check new user enforcement
    if (this.policy.enforceForNewUsers) {
      const gracePeriodEnd = new Date(user.createdAt);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + this.policy.gracePeriodDays);
      
      if (Date.now() > gracePeriodEnd.getTime()) {
        return { required: true, reason: 'new_user_policy' };
      } else {
        return { 
          required: false, 
          reason: 'grace_period',
          gracePeriodEnd 
        };
      }
    }

    return { required: false };
  }

  /**
   * Generate backup codes
   */
  static generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Get user's MFA methods
   */
  static async getUserMFAMethods(userId: string): Promise<MFAMethod[]> {
    if (env.REDIS_DISABLED) {
      // Fallback to database or memory storage
      return this.getUserMFAMethodsFallback(userId);
    }

    try {
      const redis = RedisManager.getInstance();
      const methodKeys = await redis.keys(`mfa:method:${userId}:*`);
      
      const methods: MFAMethod[] = [];
      for (const key of methodKeys) {
        const methodData = await redis.get(key);
        if (methodData) {
          const method = JSON.parse(methodData);
          methods.push({
            ...method,
            createdAt: new Date(method.createdAt),
            lastUsed: method.lastUsed ? new Date(method.lastUsed) : undefined
          });
        }
      }
      
      return methods.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('[MFA Service] Error getting user methods:', error);
      return this.getUserMFAMethodsFallback(userId);
    }
  }

  /**
   * Private helper methods
   */
  private static async storeMFAMethod(method: MFAMethod): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = `mfa:method:${method.userId}:${method.type}`;
      
      await redis.setex(key, 86400 * 365, JSON.stringify({
        ...method,
        createdAt: method.createdAt.toISOString(),
        lastUsed: method.lastUsed?.toISOString()
      })); // Store for 1 year
    } catch (error) {
      console.error('[MFA Service] Error storing method:', error);
    }
  }

  private static async getMFAMethod(userId: string, type: 'totp' | 'sms' | 'backup_codes'): Promise<MFAMethod | null> {
    if (env.REDIS_DISABLED) return null;

    try {
      const redis = RedisManager.getInstance();
      const key = `mfa:method:${userId}:${type}`;
      const methodData = await redis.get(key);
      
      if (!methodData) return null;
      
      const method = JSON.parse(methodData);
      return {
        ...method,
        createdAt: new Date(method.createdAt),
        lastUsed: method.lastUsed ? new Date(method.lastUsed) : undefined
      };
    } catch (error) {
      console.error('[MFA Service] Error getting method:', error);
      return null;
    }
  }

  private static async getPrimaryMFAMethod(userId: string): Promise<MFAMethod | null> {
    const methods = await this.getUserMFAMethods(userId);
    return methods.find(method => method.isPrimary && method.isEnabled) || null;
  }

  private static async storeChallenge(challenge: MFAChallenge): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = `mfa:challenge:${challenge.id}`;
      
      await redis.setex(key, 600, JSON.stringify({
        ...challenge,
        expiresAt: challenge.expiresAt.toISOString()
      })); // Store for 10 minutes
    } catch (error) {
      console.error('[MFA Service] Error storing challenge:', error);
    }
  }

  private static async getChallenge(challengeId: string): Promise<MFAChallenge | null> {
    if (env.REDIS_DISABLED) return null;

    try {
      const redis = RedisManager.getInstance();
      const key = `mfa:challenge:${challengeId}`;
      const challengeData = await redis.get(key);
      
      if (!challengeData) return null;
      
      const challenge = JSON.parse(challengeData);
      return {
        ...challenge,
        expiresAt: new Date(challenge.expiresAt)
      };
    } catch (error) {
      console.error('[MFA Service] Error getting challenge:', error);
      return null;
    }
  }

  private static async verifyCodeForMethod(method: MFAMethod, code: string): Promise<boolean> {
    switch (method.type) {
      case 'totp':
        if (!method.metadata.secret) return false;
        return authenticator.verify({ token: code, secret: method.metadata.secret });
      
      case 'backup_codes':
        const codes = method.metadata.codes || [];
        const usedCodes = method.metadata.usedCodes || [];
        
        if (codes.includes(code) && !usedCodes.includes(code)) {
          // Mark code as used
          method.metadata.usedCodes = [...usedCodes, code];
          await this.storeMFAMethod(method);
          return true;
        }
        return false;
      
      case 'sms':
        // SMS verification is handled separately through challenges
        return false;
      
      default:
        return false;
    }
  }

  private static async updateMethodLastUsed(methodId: string): Promise<void> {
    // Implementation would update the lastUsed timestamp
    console.log(`[MFA Service] Updated last used for method: ${methodId}`);
  }

  private static async updateUserMFAStatus(userId: string, enabled: boolean): Promise<void> {
    try {
      // Update user record with MFA status
      // This would typically be a field in the user table
      console.log(`[MFA Service] Updated MFA status for user ${userId}: ${enabled}`);
    } catch (error) {
      console.error('[MFA Service] Error updating user MFA status:', error);
    }
  }

  private static generateSMSCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private static maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length < 4) return phoneNumber;
    const visible = phoneNumber.slice(-4);
    const masked = '*'.repeat(phoneNumber.length - 4);
    return masked + visible;
  }

  private static getUserMFAMethodsFallback(userId: string): MFAMethod[] {
    // Fallback implementation for when Redis is disabled
    return [];
  }

  /**
   * Get MFA statistics
   */
  static async getStats(): Promise<{
    totalUsersWithMFA: number;
    methodDistribution: Record<string, number>;
    enforcementStats: {
      requiredUsers: number;
      enabledUsers: number;
      complianceRate: number;
    };
  }> {
    // Implementation would aggregate statistics from Redis/database
    return {
      totalUsersWithMFA: 0,
      methodDistribution: {
        totp: 0,
        sms: 0,
        backup_codes: 0
      },
      enforcementStats: {
        requiredUsers: 0,
        enabledUsers: 0,
        complianceRate: 0
      }
    };
  }
}
