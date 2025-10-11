import { generateKeyPairSync } from 'crypto';
import { RedisManager, RedisKeys } from '../config/redis.js';
import { env } from '../config/env.js';
import { AuditLogger } from '../middleware/auditLogger.js';

/**
 * JWT Key Rotation Service for enterprise-grade security
 * Supports multiple active keys for zero-downtime rotation
 */
export interface JWTKeyPair {
  id: string;
  publicKey: string;
  privateKey: string;
  algorithm: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'active' | 'rotating' | 'deprecated' | 'revoked';
  usage: {
    tokensIssued: number;
    lastUsed: Date | null;
  };
}

export interface KeyRotationConfig {
  rotationIntervalHours: number;
  keyOverlapHours: number;
  maxActiveKeys: number;
  algorithm: 'RS256' | 'RS384' | 'RS512';
  keySize: number;
}

export class JWTKeyRotationService {
  private static readonly DEFAULT_CONFIG: KeyRotationConfig = {
    rotationIntervalHours: 24 * 7, // Weekly rotation
    keyOverlapHours: 24, // 24-hour overlap for graceful transition
    maxActiveKeys: 3, // Maximum active keys at once
    algorithm: 'RS256',
    keySize: 2048
  };

  private static config: KeyRotationConfig = this.DEFAULT_CONFIG;
  private static rotationTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the key rotation service
   */
  static async initialize(customConfig?: Partial<KeyRotationConfig>): Promise<void> {
    if (customConfig) {
      this.config = { ...this.DEFAULT_CONFIG, ...customConfig };
    }

    // Ensure we have at least one active key
    const activeKeys = await this.getActiveKeys();
    if (activeKeys.length === 0) {
      console.log('[JWT Key Rotation] No active keys found, generating initial key pair');
      await this.generateNewKeyPair();
    }

    // Start automatic rotation
    this.startAutomaticRotation();
    
    console.log('[JWT Key Rotation] Service initialized successfully');
  }

  /**
   * Generate a new RSA key pair for JWT signing
   */
  static async generateNewKeyPair(): Promise<JWTKeyPair> {
    const keyId = `jwt-key-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate RSA key pair
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: this.config.keySize,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.rotationIntervalHours * 60 * 60 * 1000);

    const keyPair: JWTKeyPair = {
      id: keyId,
      publicKey,
      privateKey,
      algorithm: this.config.algorithm,
      createdAt: now,
      expiresAt,
      status: 'active',
      usage: {
        tokensIssued: 0,
        lastUsed: null
      }
    };

    // Store in Redis for distributed access
    await this.storeKeyPair(keyPair);
    
    // Audit log key generation
    AuditLogger.logSystem('jwt_key_generated', '/system/jwt-rotation', {
      details: { keyId, algorithm: this.config.algorithm, expiresAt },
      risk: 'high',
      category: 'security'
    });

    console.log(`[JWT Key Rotation] Generated new key pair: ${keyId}`);
    return keyPair;
  }

  /**
   * Get all active keys (for token verification)
   */
  static async getActiveKeys(): Promise<JWTKeyPair[]> {
    if (env.REDIS_DISABLED) {
      // Fallback to current environment keys
      return this.getFallbackKeys();
    }

    try {
      const redis = RedisManager.getInstance();
      const keyIds = await redis.smembers('jwt:active_keys');
      
      const keys: JWTKeyPair[] = [];
      for (const keyId of keyIds) {
        const keyData = await redis.get(`jwt:key:${keyId}`);
        if (keyData) {
          const keyPair = JSON.parse(keyData);
          // Check if key is still valid
          if (new Date(keyPair.expiresAt) > new Date() && keyPair.status === 'active') {
            keys.push({
              ...keyPair,
              createdAt: new Date(keyPair.createdAt),
              expiresAt: new Date(keyPair.expiresAt),
              usage: {
                ...keyPair.usage,
                lastUsed: keyPair.usage.lastUsed ? new Date(keyPair.usage.lastUsed) : null
              }
            });
          } else {
            // Remove expired key
            await this.removeExpiredKey(keyId);
          }
        }
      }
      
      return keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('[JWT Key Rotation] Error getting active keys:', error);
      return this.getFallbackKeys();
    }
  }

  /**
   * Get the current signing key (newest active key)
   */
  static async getCurrentSigningKey(): Promise<JWTKeyPair> {
    const activeKeys = await this.getActiveKeys();
    
    if (activeKeys.length === 0) {
      console.log('[JWT Key Rotation] No active keys found, generating new key');
      return await this.generateNewKeyPair();
    }

    // Return the newest active key
    const signingKey = activeKeys[0];
    
    // Update usage statistics
    await this.updateKeyUsage(signingKey.id);
    
    return signingKey;
  }

  /**
   * Get key by ID (for token verification)
   */
  static async getKeyById(keyId: string): Promise<JWTKeyPair | null> {
    if (env.REDIS_DISABLED) {
      const fallbackKeys = this.getFallbackKeys();
      return fallbackKeys.find(key => key.id === keyId) || null;
    }

    try {
      const redis = RedisManager.getInstance();
      const keyData = await redis.get(`jwt:key:${keyId}`);
      
      if (!keyData) return null;
      
      const keyPair = JSON.parse(keyData);
      return {
        ...keyPair,
        createdAt: new Date(keyPair.createdAt),
        expiresAt: new Date(keyPair.expiresAt),
        usage: {
          ...keyPair.usage,
          lastUsed: keyPair.usage.lastUsed ? new Date(keyPair.usage.lastUsed) : null
        }
      };
    } catch (error) {
      console.error(`[JWT Key Rotation] Error getting key ${keyId}:`, error);
      return null;
    }
  }

  /**
   * Rotate keys (generate new, deprecate old)
   */
  static async rotateKeys(): Promise<{ newKey: JWTKeyPair; deprecatedKeys: string[] }> {
    console.log('[JWT Key Rotation] Starting key rotation...');
    
    const activeKeys = await this.getActiveKeys();
    const deprecatedKeys: string[] = [];

    // Generate new key
    const newKey = await this.generateNewKeyPair();

    // Mark old keys for deprecation (but keep them active for overlap period)
    const now = new Date();
    const overlapEndTime = new Date(now.getTime() + this.config.keyOverlapHours * 60 * 60 * 1000);

    for (const key of activeKeys) {
      if (activeKeys.length > this.config.maxActiveKeys - 1) {
        // Mark oldest keys as rotating (will be deprecated after overlap)
        key.status = 'rotating';
        key.expiresAt = overlapEndTime;
        await this.storeKeyPair(key);
        deprecatedKeys.push(key.id);
      }
    }

    // Schedule cleanup of rotating keys
    setTimeout(async () => {
      for (const keyId of deprecatedKeys) {
        await this.deprecateKey(keyId);
      }
    }, this.config.keyOverlapHours * 60 * 60 * 1000);

    // Audit log rotation
    AuditLogger.logSystem('jwt_keys_rotated', '/system/jwt-rotation', {
      details: { 
        newKeyId: newKey.id, 
        deprecatedKeys,
        rotationTime: now.toISOString()
      },
      risk: 'high',
      category: 'security'
    });

    console.log(`[JWT Key Rotation] Rotation complete. New key: ${newKey.id}, Deprecated: ${deprecatedKeys.length} keys`);
    
    return { newKey, deprecatedKeys };
  }

  /**
   * Revoke a specific key (emergency use)
   */
  static async revokeKey(keyId: string, reason: string): Promise<boolean> {
    const key = await this.getKeyById(keyId);
    if (!key) return false;

    key.status = 'revoked';
    await this.storeKeyPair(key);
    
    // Remove from active keys set
    if (!env.REDIS_DISABLED) {
      const redis = RedisManager.getInstance();
      await redis.srem('jwt:active_keys', keyId);
    }

    // Audit log revocation
    AuditLogger.logSystem('jwt_key_revoked', '/system/jwt-rotation', {
      details: { keyId, reason, revokedAt: new Date().toISOString() },
      risk: 'critical',
      category: 'security'
    });

    console.log(`[JWT Key Rotation] Key revoked: ${keyId}, Reason: ${reason}`);
    return true;
  }

  /**
   * Get key rotation statistics
   */
  static async getRotationStats(): Promise<{
    activeKeys: number;
    rotatingKeys: number;
    deprecatedKeys: number;
    revokedKeys: number;
    totalTokensIssued: number;
    nextRotation: Date | null;
  }> {
    const allKeys = await this.getAllKeys();
    
    const stats = {
      activeKeys: allKeys.filter(k => k.status === 'active').length,
      rotatingKeys: allKeys.filter(k => k.status === 'rotating').length,
      deprecatedKeys: allKeys.filter(k => k.status === 'deprecated').length,
      revokedKeys: allKeys.filter(k => k.status === 'revoked').length,
      totalTokensIssued: allKeys.reduce((sum, k) => sum + k.usage.tokensIssued, 0),
      nextRotation: this.getNextRotationTime()
    };

    return stats;
  }

  /**
   * Private helper methods
   */
  private static async storeKeyPair(keyPair: JWTKeyPair): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      
      // Store key data
      await redis.set(`jwt:key:${keyPair.id}`, JSON.stringify(keyPair));
      
      // Add to active keys set if active
      if (keyPair.status === 'active') {
        await redis.sadd('jwt:active_keys', keyPair.id);
      } else {
        await redis.srem('jwt:active_keys', keyPair.id);
      }
      
      // Set expiration for cleanup (30 days after expiry)
      const cleanupTime = Math.floor((keyPair.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000);
      await redis.expireat(`jwt:key:${keyPair.id}`, cleanupTime);
      
    } catch (error) {
      console.error('[JWT Key Rotation] Error storing key pair:', error);
    }
  }

  private static async updateKeyUsage(keyId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const keyData = await redis.get(`jwt:key:${keyId}`);
      
      if (keyData) {
        const keyPair = JSON.parse(keyData);
        keyPair.usage.tokensIssued += 1;
        keyPair.usage.lastUsed = new Date().toISOString();
        
        await redis.set(`jwt:key:${keyId}`, JSON.stringify(keyPair));
      }
    } catch (error) {
      console.error('[JWT Key Rotation] Error updating key usage:', error);
    }
  }

  private static async removeExpiredKey(keyId: string): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      await redis.del(`jwt:key:${keyId}`);
      await redis.srem('jwt:active_keys', keyId);
      
      console.log(`[JWT Key Rotation] Removed expired key: ${keyId}`);
    } catch (error) {
      console.error('[JWT Key Rotation] Error removing expired key:', error);
    }
  }

  private static async deprecateKey(keyId: string): Promise<void> {
    const key = await this.getKeyById(keyId);
    if (!key) return;

    key.status = 'deprecated';
    await this.storeKeyPair(key);
    
    console.log(`[JWT Key Rotation] Key deprecated: ${keyId}`);
  }

  private static async getAllKeys(): Promise<JWTKeyPair[]> {
    if (env.REDIS_DISABLED) return this.getFallbackKeys();

    try {
      const redis = RedisManager.getInstance();
      const keyPattern = 'jwt:key:*';
      const keyNames = await redis.keys(keyPattern);
      
      const keys: JWTKeyPair[] = [];
      for (const keyName of keyNames) {
        const keyData = await redis.get(keyName);
        if (keyData) {
          const keyPair = JSON.parse(keyData);
          keys.push({
            ...keyPair,
            createdAt: new Date(keyPair.createdAt),
            expiresAt: new Date(keyPair.expiresAt),
            usage: {
              ...keyPair.usage,
              lastUsed: keyPair.usage.lastUsed ? new Date(keyPair.usage.lastUsed) : null
            }
          });
        }
      }
      
      return keys;
    } catch (error) {
      console.error('[JWT Key Rotation] Error getting all keys:', error);
      return this.getFallbackKeys();
    }
  }

  private static getFallbackKeys(): JWTKeyPair[] {
    // Fallback to environment keys when Redis is disabled
    return [{
      id: env.AUTH_JWT_KID,
      publicKey: env.AUTH_JWT_PUBLIC_KEY,
      privateKey: env.AUTH_JWT_PRIVATE_KEY,
      algorithm: 'RS256',
      createdAt: new Date('2024-01-01'), // Placeholder
      expiresAt: new Date('2025-12-31'), // Placeholder
      status: 'active',
      usage: {
        tokensIssued: 0,
        lastUsed: null
      }
    }];
  }

  private static startAutomaticRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }

    const rotationInterval = this.config.rotationIntervalHours * 60 * 60 * 1000;
    
    this.rotationTimer = setInterval(async () => {
      try {
        await this.rotateKeys();
      } catch (error) {
        console.error('[JWT Key Rotation] Automatic rotation failed:', error);
        
        // Audit log rotation failure
        AuditLogger.logSystem('jwt_rotation_failed', '/system/jwt-rotation', {
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
          risk: 'critical',
          category: 'security'
        });
      }
    }, rotationInterval);

    console.log(`[JWT Key Rotation] Automatic rotation scheduled every ${this.config.rotationIntervalHours} hours`);
  }

  private static getNextRotationTime(): Date | null {
    const activeKeys = this.getActiveKeys();
    // This is async, but for stats we'll return a calculated time
    const now = new Date();
    return new Date(now.getTime() + this.config.rotationIntervalHours * 60 * 60 * 1000);
  }

  /**
   * Cleanup method for graceful shutdown
   */
  static shutdown(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
    console.log('[JWT Key Rotation] Service shutdown complete');
  }
}
