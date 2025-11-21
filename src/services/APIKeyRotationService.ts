import { randomBytes, createHmac } from 'crypto';
import { RedisManager } from '../config/redis.js';
import { env } from '../config/env.js';
import { Logger } from '../utils/logger.js';

/**
 * CRITICAL FIX: API Key Rotation Service for internal service authentication
 * Provides secure key rotation mechanism for INTERNAL_API_KEY
 * Supports multiple active keys for zero-downtime rotation
 */
export interface APIKeyPair {
  id: string;
  key?: string; // Only returned on creation
  hashedKey: string;
  algorithm: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'rotating' | 'deprecated' | 'revoked';
  usage: {
    requestsAuthorized: number;
    lastUsed: string | null;
  };
  metadata?: {
    service?: string;
    description?: string;
  };
}

export interface KeyRotationConfig {
  rotationIntervalHours: number;
  keyOverlapHours: number;
  maxActiveKeys: number;
  keyLength: number;
}

export class APIKeyRotationService {
  private static readonly DEFAULT_CONFIG: KeyRotationConfig = {
    rotationIntervalHours: 24 * 7, // Weekly rotation
    keyOverlapHours: 24, // 24-hour overlap for graceful transition
    maxActiveKeys: 3, // Maximum active keys at once
    keyLength: 32 // 256-bit key
  };

  private static config: KeyRotationConfig = this.DEFAULT_CONFIG;
  private static rotationTimer: NodeJS.Timeout | null = null;
  private static readonly REDIS_KEY = 'api-keys:rotation';

  /**
   * Initialize the API key rotation service
   */
  static async initialize(customConfig?: Partial<KeyRotationConfig>): Promise<void> {
    if (customConfig) {
      this.config = { ...this.DEFAULT_CONFIG, ...customConfig };
    }

    // Ensure we have at least one active key
    const activeKeys = await this.getActiveKeys();
    if (activeKeys.length === 0) {
      Logger.info('[API Key Rotation] No active keys found, generating initial key pair');
      await this.generateNewKeyPair('INTERNAL_API_KEY', 'Initial API key for internal services');
    }

    // Start automatic rotation
    this.startAutomaticRotation();
    
    Logger.info('[API Key Rotation] Service initialized successfully');
  }

  /**
   * CRITICAL FIX: Generate a new API key for internal service authentication
   */
  static async generateNewKeyPair(service: string, description?: string): Promise<APIKeyPair> {
    const keyId = `api-key-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate random API key
    const key = randomBytes(this.config.keyLength).toString('hex');
    const hashedKey = this.hashKey(key);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.rotationIntervalHours * 60 * 60 * 1000);

    const keyPair: APIKeyPair = {
      id: keyId,
      key, // Return plain key only once
      hashedKey,
      algorithm: 'HMAC-SHA256',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'active',
      usage: {
        requestsAuthorized: 0,
        lastUsed: null
      },
      metadata: {
        service,
        description
      }
    };

    // Store in Redis
    const redis = RedisManager.getInstance();
    await redis.hset(
      this.REDIS_KEY,
      keyId,
      JSON.stringify(keyPair)
    );

    Logger.security('[API Key Rotation] New API key generated', {
      severity: 'low',
      keyId,
      service,
      expiresAt: expiresAt.toISOString(),
      event: 'api_key_generated'
    });

    return keyPair;
  }

  /**
   * Get all active API keys
   */
  static async getActiveKeys(): Promise<APIKeyPair[]> {
    const redis = RedisManager.getInstance();
    const keysData = await redis.hgetall(this.REDIS_KEY);

    if (!keysData || Object.keys(keysData).length === 0) {
      return [];
    }

    const keys: APIKeyPair[] = Object.values(keysData)
      .map(data => JSON.parse(data as string))
      .filter(key => {
        const isActive = key.status === 'active' || key.status === 'rotating';
        const isNotExpired = new Date(key.expiresAt) > new Date();
        return isActive && isNotExpired;
      });

    return keys;
  }

  /**
   * Get current signing key (most recently created active key)
   */
  static async getCurrentSigningKey(): Promise<APIKeyPair> {
    const activeKeys = await this.getActiveKeys();
    
    if (activeKeys.length === 0) {
      throw new Error('[API Key Rotation] No active API keys available');
    }

    // Return the most recently created key
    return activeKeys.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * Verify an API key
   */
  static async verifyKey(providedKey: string): Promise<{ valid: boolean; keyId?: string }> {
    const activeKeys = await this.getActiveKeys();

    for (const keyPair of activeKeys) {
      const isValid = this.compareKeys(providedKey, keyPair.hashedKey);
      
      if (isValid) {
        // Update usage statistics
        const redis = RedisManager.getInstance();
        keyPair.usage.requestsAuthorized++;
        keyPair.usage.lastUsed = new Date().toISOString();
        
        await redis.hset(
          this.REDIS_KEY,
          keyPair.id,
          JSON.stringify(keyPair)
        );

        Logger.debug('[API Key Rotation] API key verified successfully', {
          keyId: keyPair.id,
          event: 'api_key_verified'
        });

        return { valid: true, keyId: keyPair.id };
      }
    }

    Logger.security('[API Key Rotation] Invalid API key provided', {
      severity: 'medium',
      event: 'invalid_api_key'
    });

    return { valid: false };
  }

  /**
   * Revoke an API key
   */
  static async revokeKey(keyId: string): Promise<void> {
    const redis = RedisManager.getInstance();
    const keyData = await redis.hget(this.REDIS_KEY, keyId);

    if (!keyData) {
      throw new Error(`[API Key Rotation] Key not found: ${keyId}`);
    }

    const keyPair: APIKeyPair = JSON.parse(keyData as string);
    keyPair.status = 'revoked';

    await redis.hset(
      this.REDIS_KEY,
      keyId,
      JSON.stringify(keyPair)
    );

    Logger.security('[API Key Rotation] API key revoked', {
      severity: 'low',
      keyId,
      event: 'api_key_revoked'
    });
  }

  /**
   * Start automatic key rotation
   */
  private static startAutomaticRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }

    // Rotate keys every rotation interval
    this.rotationTimer = setInterval(async () => {
      try {
        await this.performRotation();
      } catch (error) {
        Logger.security('[API Key Rotation] Automatic rotation failed', {
          severity: 'high',
          message: error instanceof Error ? error.message : String(error),
          event: 'rotation_failed'
        });
      }
    }, this.config.rotationIntervalHours * 60 * 60 * 1000);

    Logger.info('[API Key Rotation] Automatic rotation started', {
      intervalHours: this.config.rotationIntervalHours
    });
  }

  /**
   * Perform key rotation
   */
  private static async performRotation(): Promise<void> {
    Logger.info('[API Key Rotation] Starting key rotation process');

    const activeKeys = await this.getActiveKeys();
    const redis = RedisManager.getInstance();

    // Mark old keys as rotating
    for (const key of activeKeys) {
      if (key.status === 'active') {
        key.status = 'rotating';
        await redis.hset(
          this.REDIS_KEY,
          key.id,
          JSON.stringify(key)
        );
      }
    }

    // Generate new key
    const newKey = await this.generateNewKeyPair(
      'INTERNAL_API_KEY',
      'Auto-rotated API key'
    );

    // Clean up deprecated keys
    await this.cleanupDeprecatedKeys();

    Logger.security('[API Key Rotation] Key rotation completed', {
      severity: 'low',
      newKeyId: newKey.id,
      event: 'key_rotation_completed'
    });
  }

  /**
   * Clean up deprecated and expired keys
   */
  private static async cleanupDeprecatedKeys(): Promise<void> {
    const redis = RedisManager.getInstance();
    const keysData = await redis.hgetall(this.REDIS_KEY);

    if (!keysData) return;

    const now = new Date();
    const keysToDelete: string[] = [];

    for (const [keyId, data] of Object.entries(keysData)) {
      const keyPair: APIKeyPair = JSON.parse(data as string);
      const isExpired = new Date(keyPair.expiresAt) < now;
      const isDeprecated = keyPair.status === 'deprecated' || keyPair.status === 'revoked';

      if (isExpired || isDeprecated) {
        keysToDelete.push(keyId);
      }
    }

    // Delete deprecated keys
    if (keysToDelete.length > 0) {
      for (const keyId of keysToDelete) {
        await redis.hdel(this.REDIS_KEY, keyId);
      }

      Logger.info('[API Key Rotation] Cleaned up deprecated keys', {
        count: keysToDelete.length
      });
    }
  }

  /**
   * Hash an API key using HMAC-SHA256
   */
  private static hashKey(key: string): string {
    return createHmac('sha256', env.AUTH_JWT_ISSUER || 'default-secret')
      .update(key)
      .digest('hex');
  }

  /**
   * Compare a provided key with a hashed key
   */
  private static compareKeys(providedKey: string, hashedKey: string): boolean {
    const hashedProvidedKey = createHmac('sha256', env.AUTH_JWT_ISSUER || 'default-secret')
      .update(providedKey)
      .digest('hex');

    return hashedProvidedKey === hashedKey;
  }

  /**
   * Get key rotation statistics
   */
  static async getStatistics(): Promise<{
    activeKeys: number;
    totalRequests: number;
    lastRotation: Date | null;
  }> {
    const activeKeys = await this.getActiveKeys();
    const totalRequests = activeKeys.reduce((sum, key) => sum + key.usage.requestsAuthorized, 0);
    const lastRotation = activeKeys.length > 0 
      ? new Date(Math.max(...activeKeys.map(k => new Date(k.createdAt).getTime())))
      : null;

    return {
      activeKeys: activeKeys.length,
      totalRequests,
      lastRotation
    };
  }
}
