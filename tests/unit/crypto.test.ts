import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashSecret, verifySecret } from '../../src/utils/crypto';

describe('Crypto Utils', () => {
  describe('Password Hashing', () => {
    it('should hash a password successfully', async () => {
      const password = 'testPassword123!';
      const hash = await hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50); // Argon2 hashes are typically longer
    });

    it('should verify a correct password', async () => {
      const password = 'testPassword123!';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(hash, password);
      
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const password = 'testPassword123!';
      const wrongPassword = 'wrongPassword456!';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(hash, wrongPassword);
      
      expect(isValid).toBe(false);
    });

    it('should handle empty password gracefully', async () => {
      const password = '';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(hash, password);
      
      expect(isValid).toBe(true);
    });

    it('should return false for invalid hash format', async () => {
      const password = 'testPassword123!';
      const invalidHash = 'invalid-hash-format';
      const isValid = await verifyPassword(invalidHash, password);
      
      expect(isValid).toBe(false);
    });
  });

  describe('Secret Hashing', () => {
    it('should hash a secret successfully', async () => {
      const secret = 'mySecretToken123';
      const hash = await hashSecret(secret);
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe(secret);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should verify a correct secret', async () => {
      const secret = 'mySecretToken123';
      const hash = await hashSecret(secret);
      const isValid = await verifySecret(hash, secret);
      
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect secret', async () => {
      const secret = 'mySecretToken123';
      const wrongSecret = 'wrongSecret456';
      const hash = await hashSecret(secret);
      const isValid = await verifySecret(hash, wrongSecret);
      
      expect(isValid).toBe(false);
    });

    it('should handle different secrets with same hash function', async () => {
      const secret1 = 'secret1';
      const secret2 = 'secret2';
      
      const hash1 = await hashSecret(secret1);
      const hash2 = await hashSecret(secret2);
      
      expect(hash1).not.toBe(hash2);
      
      const isValid1 = await verifySecret(hash1, secret1);
      const isValid2 = await verifySecret(hash2, secret2);
      const crossValid1 = await verifySecret(hash1, secret2);
      const crossValid2 = await verifySecret(hash2, secret1);
      
      expect(isValid1).toBe(true);
      expect(isValid2).toBe(true);
      expect(crossValid1).toBe(false);
      expect(crossValid2).toBe(false);
    });
  });

  describe('Security Properties', () => {
    it('should produce different hashes for same password (salt)', async () => {
      const password = 'testPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      expect(hash1).not.toBe(hash2); // Different salts should produce different hashes
      
      // But both should verify correctly
      expect(await verifyPassword(hash1, password)).toBe(true);
      expect(await verifyPassword(hash2, password)).toBe(true);
    });

    it('should be resistant to timing attacks', async () => {
      const password = 'testPassword123!';
      const hash = await hashPassword(password);
      
      // Measure time for correct password
      const start1 = Date.now();
      await verifyPassword(hash, password);
      const time1 = Date.now() - start1;
      
      // Measure time for incorrect password
      const start2 = Date.now();
      await verifyPassword(hash, 'wrongPassword');
      const time2 = Date.now() - start2;
      
      // Times should be similar (within reasonable bounds)
      // This is a basic test - real timing attack resistance requires more sophisticated testing
      const timeDiff = Math.abs(time1 - time2);
      expect(timeDiff).toBeLessThan(100); // Allow 100ms difference
    });
  });
});
