import { SignJWT, importPKCS8, importSPKI, exportJWK, JWTPayload, KeyLike, jwtVerify, decodeProtectedHeader } from "jose";
import { env } from "../config/env.js";
import { JWTKeyRotationService } from "../services/JWTKeyRotationService.js";
import { RedisManager } from "../config/redis.js";
import { Logger } from "./logger.js";

let privateKeyPromise: Promise<KeyLike> | null = null;
let publicKeyPromise: Promise<KeyLike> | null = null;
let publicJWKPromise: Promise<JsonWebKey> | null = null;

function initKeys() {
  if (!privateKeyPromise) {
    privateKeyPromise = importPKCS8(env.AUTH_JWT_PRIVATE_KEY, "RS256");
  }
  if (!publicKeyPromise) {
    publicKeyPromise = importSPKI(env.AUTH_JWT_PUBLIC_KEY, "RS256");
  }
  if (!publicJWKPromise) {
    publicJWKPromise = (async () => {
      const pub = await publicKeyPromise!;
      const jwk = await exportJWK(pub);
      // add required fields
      jwk.alg = "RS256" as any;
      jwk.use = "sig" as any;
      jwk.kid = env.AUTH_JWT_KID as any;
      return jwk;
    })();
  }
}

initKeys();

/**
 * Blacklist a JWT token to prevent further use
 */
export async function blacklistToken(token: string, expiresAt: Date): Promise<void> {
  try {
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (ttl > 0) {
      const redis = RedisManager.getInstance();
      await redis.setex(`blacklist:${token}`, ttl, '1');
    }
  } catch (error) {
    Logger.error('Failed to blacklist token', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Token blacklisting failed');
  }
}

/**
 * Check if a JWT token is blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    if (env.REDIS_DISABLED) {
      return false; // Skip blacklist check if Redis is disabled
    }
    const redis = RedisManager.getInstance();
    const result = await redis.get(`blacklist:${token}`);
    return result === '1';
  } catch (error) {
    Logger.error('Failed to check token blacklist', error instanceof Error ? error : new Error(String(error)));
    // Fail open in case of Redis issues (but log the error)
    return false;
  }
}

/**
 * Blacklist all tokens for a specific user (emergency revocation)
 */
export async function blacklistUserTokens(userId: string, reason: string = 'user_revocation'): Promise<void> {
  try {
    const redis = RedisManager.getInstance();
    // Store user revocation with 24 hour TTL (longer than max token lifetime)
    await redis.setex(`user_revoked:${userId}`, 86400, JSON.stringify({
      reason,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    Logger.error('Failed to blacklist user tokens', error instanceof Error ? error : new Error(String(error)), { userId, reason });
    throw new Error('User token revocation failed');
  }
}

/**
 * Check if all tokens for a user are revoked
 */
export async function isUserTokensRevoked(userId: string): Promise<boolean> {
  try {
    if (env.REDIS_DISABLED) {
      return false;
    }
    const redis = RedisManager.getInstance();
    const result = await redis.get(`user_revoked:${userId}`);
    return result !== null;
  } catch (error) {
    Logger.error('Failed to check user token revocation', error instanceof Error ? error : new Error(String(error)), { userId });
    return false;
  }
}

export async function generateAccessToken(payload: { sub: string; email: string; roles: string[] }): Promise<string> {
  return signAccessToken(payload.sub, { email: payload.email, roles: payload.roles });
}

export async function signAccessToken(subject: string, claims: Record<string, any>): Promise<string> {
  Logger.debug('Creating JWT token', { subject, operation: 'jwt_create' });
  
  try {
    // Try to get current signing key from rotation service
    const signingKey = await JWTKeyRotationService.getCurrentSigningKey();
    const key = await importPKCS8(signingKey.privateKey, signingKey.algorithm as any);
    
    const jwt = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: signingKey.algorithm, kid: signingKey.id })
      .setSubject(subject)
      .setIssuer(env.AUTH_JWT_ISSUER)
      .setAudience(env.AUTH_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(env.AUTH_JWT_ACCESS_EXPIRES_IN)
      .sign(key);
    
    Logger.debug('JWT token created successfully', { keyId: signingKey.id, operation: 'jwt_create' });
    return jwt;
  } catch (error) {
    // Fallback to environment keys if rotation service fails
    Logger.warn('Key rotation service unavailable, using fallback keys', { error: error instanceof Error ? error.message : String(error), operation: 'jwt_create' });
    
    const key = await privateKeyPromise!;
    const jwt = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: env.AUTH_JWT_KID })
      .setSubject(subject)
      .setIssuer(env.AUTH_JWT_ISSUER)
      .setAudience(env.AUTH_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(env.AUTH_JWT_ACCESS_EXPIRES_IN)
      .sign(key);
    
    Logger.debug('JWT token created with fallback key', { operation: 'jwt_create' });
    return jwt;
  }
}

export async function getJWKS() {
  const keys = [];
  
  // Add static environment key
  const staticJwk = await publicJWKPromise!;
  keys.push(staticJwk);
  
  // Add dynamic rotation keys
  try {
    const activeKeys = await JWTKeyRotationService.getActiveKeys();
    for (const keyPair of activeKeys) {
      if (keyPair.status === 'active' || keyPair.status === 'rotating') {
        // Convert PEM public key to JWK format
        const { importSPKI, exportJWK } = await import('jose');
        const publicKey = await importSPKI(keyPair.publicKey, keyPair.algorithm as any);
        const jwk = await exportJWK(publicKey);
        
        // Add required JWK fields
        jwk.alg = keyPair.algorithm;
        jwk.use = 'sig';
        jwk.kid = keyPair.id;
        
        keys.push(jwk);
      }
    }
  } catch (error) {
    console.warn('[JWKS] Failed to load rotation keys, using static key only:', error);
  }
  
  return { keys };
}

export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  // Check blacklist first (fast path)
  if (await isTokenBlacklisted(token)) {
    throw new Error('Token has been revoked');
  }

  try {
    // Decode header to get key ID
    const header = decodeProtectedHeader(token);
    const keyId = header.kid;
    
    if (keyId) {
      // Try to get key from rotation service
      const keyPair = await JWTKeyRotationService.getKeyById(keyId);
      
      if (keyPair && (keyPair.status === 'active' || keyPair.status === 'rotating')) {
        const publicKey = await importSPKI(keyPair.publicKey, keyPair.algorithm as any);
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: env.AUTH_JWT_ISSUER,
          audience: env.AUTH_JWT_AUDIENCE,
          algorithms: [keyPair.algorithm as any],
        });
        
        Logger.debug('JWT token verified with rotated key', { keyId, operation: 'jwt_verify' });
        
        // Check if user tokens are revoked
        if (payload.sub && await isUserTokensRevoked(payload.sub)) {
          throw new Error('All user tokens have been revoked');
        }
        
        return payload;
      }
    }
    
    // Fallback to environment key if rotation service key not found
    Logger.warn('Key not found in rotation service, trying fallback key', { keyId, operation: 'jwt_verify' });
    const key = await publicKeyPromise!;
    const { payload } = await jwtVerify(token, key, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
      algorithms: ["RS256"],
    });
    
    Logger.debug('JWT token verified with fallback key', { operation: 'jwt_verify' });
    
    // Check if user tokens are revoked
    if (payload.sub && await isUserTokensRevoked(payload.sub)) {
      throw new Error('All user tokens have been revoked');
    }
    
    return payload;
  } catch (error) {
    // If rotation service fails, try all active keys
    try {
      const activeKeys = await JWTKeyRotationService.getActiveKeys();
      
      for (const keyPair of activeKeys) {
        if (keyPair.status !== 'active' && keyPair.status !== 'rotating') continue;
        
        try {
          const publicKey = await importSPKI(keyPair.publicKey, keyPair.algorithm as any);
          const { payload } = await jwtVerify(token, publicKey, {
            issuer: env.AUTH_JWT_ISSUER,
            audience: env.AUTH_JWT_AUDIENCE,
            algorithms: [keyPair.algorithm as any],
          });
          
          Logger.debug('JWT token verified with key', { keyId: keyPair.id, operation: 'jwt_verify' });
          return payload;
        } catch (keyError) {
          // Try next key
          continue;
        }
      }
    } catch (rotationError) {
      // Rotation service completely unavailable, use fallback
      Logger.warn('Rotation service unavailable, using fallback verification', { operation: 'jwt_verify' });
    }
    
    // Final fallback to environment key
    const key = await publicKeyPromise!;
    const { payload } = await jwtVerify(token, key, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
      algorithms: ["RS256"],
    });
    return payload;
  }
}
