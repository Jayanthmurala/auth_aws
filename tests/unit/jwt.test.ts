import { describe, it, expect, beforeAll } from 'vitest';
import { signAccessToken, verifyAccessToken, getJWKS } from '../../src/utils/jwt';

describe('JWT Utils', () => {
  const testUserId = 'test-user-123';
  const testClaims = {
    email: 'test@example.com',
    roles: ['STUDENT'],
    displayName: 'Test User'
  };

  describe('Token Creation', () => {
    it('should create a valid JWT token', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include all provided claims in token', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      const payload = await verifyAccessToken(token);
      
      expect(payload.sub).toBe(testUserId);
      expect(payload.email).toBe(testClaims.email);
      expect(payload.roles).toEqual(testClaims.roles);
      expect(payload.displayName).toBe(testClaims.displayName);
    });

    it('should include standard JWT claims', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      const payload = await verifyAccessToken(token);
      
      expect(payload.iss).toBe('nexus-auth'); // issuer
      expect(payload.aud).toBe('nexus'); // audience
      expect(payload.iat).toBeDefined(); // issued at
      expect(payload.exp).toBeDefined(); // expires at
      expect(payload.sub).toBe(testUserId); // subject
    });

    it('should create tokens with proper expiration', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      const payload = await verifyAccessToken(token);
      
      const now = Math.floor(Date.now() / 1000);
      const expiry = payload.exp as number;
      
      expect(expiry).toBeGreaterThan(now);
      expect(expiry - now).toBeLessThanOrEqual(30 * 60); // 30 minutes max
    });
  });

  describe('Token Verification', () => {
    it('should verify a valid token', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      const payload = await verifyAccessToken(token);
      
      expect(payload).toBeDefined();
      expect(payload.sub).toBe(testUserId);
    });

    it('should reject an invalid token', async () => {
      const invalidToken = 'invalid.token.here';
      
      await expect(verifyAccessToken(invalidToken)).rejects.toThrow();
    });

    it('should reject a malformed token', async () => {
      const malformedToken = 'not-a-jwt-token';
      
      await expect(verifyAccessToken(malformedToken)).rejects.toThrow();
    });

    it('should reject a token with wrong signature', async () => {
      const token = await signAccessToken(testUserId, testClaims);
      const parts = token.split('.');
      const tamperedToken = parts[0] + '.' + parts[1] + '.tampered-signature';
      
      await expect(verifyAccessToken(tamperedToken)).rejects.toThrow();
    });
  });

  describe('JWKS Endpoint', () => {
    it('should return valid JWKS format', async () => {
      const jwks = await getJWKS();
      
      expect(jwks).toBeDefined();
      expect(jwks.keys).toBeDefined();
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);
    });

    it('should include required JWK fields', async () => {
      const jwks = await getJWKS();
      const key = jwks.keys[0] as JsonWebKey & { kid?: string };
      
      expect(key.kty).toBeDefined(); // key type
      expect(key.use).toBe('sig'); // usage
      expect(key.alg).toBe('RS256'); // algorithm
      expect(key.kid).toBeDefined(); // key id
      expect(key.n).toBeDefined(); // modulus
      expect(key.e).toBeDefined(); // exponent
    });
  });

  describe('Token Security', () => {
    it('should create different tokens for same user with different timestamps', async () => {
      const token1 = await signAccessToken(testUserId, testClaims);
      
      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const token2 = await signAccessToken(testUserId, testClaims);
      
      expect(token1).not.toBe(token2);
      
      // But both should be valid
      const payload1 = await verifyAccessToken(token1);
      const payload2 = await verifyAccessToken(token2);
      
      expect(payload1.sub).toBe(testUserId);
      expect(payload2.sub).toBe(testUserId);
      expect(payload1.iat).not.toBe(payload2.iat);
    });

    it('should handle empty claims gracefully', async () => {
      const token = await signAccessToken(testUserId, {});
      const payload = await verifyAccessToken(token);
      
      expect(payload.sub).toBe(testUserId);
      expect(payload.iss).toBe('nexus-auth');
      expect(payload.aud).toBe('nexus');
    });

    it('should handle special characters in claims', async () => {
      const specialClaims = {
        email: 'test+special@example.com',
        displayName: 'Test User with "quotes" & symbols',
        customField: 'Value with\nnewlines\tand\ttabs'
      };
      
      const token = await signAccessToken(testUserId, specialClaims);
      const payload = await verifyAccessToken(token);
      
      expect(payload.email).toBe(specialClaims.email);
      expect(payload.displayName).toBe(specialClaims.displayName);
      expect(payload.customField).toBe(specialClaims.customField);
    });
  });

  describe('Error Handling', () => {
    it('should handle null/undefined user ID', async () => {
      await expect(signAccessToken(null as any, testClaims)).rejects.toThrow();
      await expect(signAccessToken(undefined as any, testClaims)).rejects.toThrow();
    });

    it('should handle null/undefined claims', async () => {
      const token = await signAccessToken(testUserId, null as any);
      const payload = await verifyAccessToken(token);
      
      expect(payload.sub).toBe(testUserId);
    });
  });
});
