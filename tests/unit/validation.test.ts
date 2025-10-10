import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InputSanitizer, CommonSchemas } from '../../src/middleware/validation';

describe('Input Validation', () => {
  describe('InputSanitizer', () => {
    describe('sanitizeString', () => {
      it('should remove script tags', () => {
        const input = 'Hello <script>alert("xss")</script> World';
        const result = InputSanitizer.sanitizeString(input);
        expect(result).toBe('Hello  World');
      });

      it('should remove javascript: protocol', () => {
        const input = 'javascript:alert("xss")';
        const result = InputSanitizer.sanitizeString(input);
        expect(result).toBe('alert("xss")');
      });

      it('should remove event handlers', () => {
        const input = 'Hello onclick="alert()" World';
        const result = InputSanitizer.sanitizeString(input);
        expect(result).toBe('Hello  World');
      });

      it('should trim whitespace', () => {
        const input = '  Hello World  ';
        const result = InputSanitizer.sanitizeString(input);
        expect(result).toBe('Hello World');
      });

      it('should handle empty string', () => {
        const input = '';
        const result = InputSanitizer.sanitizeString(input);
        expect(result).toBe('');
      });
    });

    describe('sanitizeEmail', () => {
      it('should convert to lowercase', () => {
        const input = 'TEST@EXAMPLE.COM';
        const result = InputSanitizer.sanitizeEmail(input);
        expect(result).toBe('test@example.com');
      });

      it('should trim whitespace', () => {
        const input = '  test@example.com  ';
        const result = InputSanitizer.sanitizeEmail(input);
        expect(result).toBe('test@example.com');
      });
    });

    describe('validatePassword', () => {
      it('should accept strong password', () => {
        const password = 'StrongP@ssw0rd123';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject short password', () => {
        const password = 'Short1!';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should require uppercase letter', () => {
        const password = 'lowercase123!';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
      });

      it('should require lowercase letter', () => {
        const password = 'UPPERCASE123!';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
      });

      it('should require number', () => {
        const password = 'NoNumbers!';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
      });

      it('should require special character', () => {
        const password = 'NoSpecialChars123';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one special character');
      });

      it('should return multiple errors for weak password', () => {
        const password = 'weak';
        const result = InputSanitizer.validatePassword(password);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
      });
    });

    describe('sanitizeCollegeMemberId', () => {
      it('should remove invalid characters', () => {
        const input = 'ABC123!@#$%^&*()def';
        const result = InputSanitizer.sanitizeCollegeMemberId(input);
        expect(result).toBe('ABC123-_def');
      });

      it('should trim whitespace', () => {
        const input = '  ABC123  ';
        const result = InputSanitizer.sanitizeCollegeMemberId(input);
        expect(result).toBe('ABC123');
      });

      it('should preserve valid characters', () => {
        const input = 'ABC-123_def';
        const result = InputSanitizer.sanitizeCollegeMemberId(input);
        expect(result).toBe('ABC-123_def');
      });
    });
  });

  describe('CommonSchemas', () => {
    describe('email schema', () => {
      it('should validate correct email', () => {
        const result = CommonSchemas.email.safeParse('test@example.com');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('test@example.com');
        }
      });

      it('should reject invalid email format', () => {
        const result = CommonSchemas.email.safeParse('invalid-email');
        expect(result.success).toBe(false);
      });

      it('should reject empty email', () => {
        const result = CommonSchemas.email.safeParse('');
        expect(result.success).toBe(false);
      });

      it('should sanitize email', () => {
        const result = CommonSchemas.email.safeParse('  TEST@EXAMPLE.COM  ');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('test@example.com');
        }
      });
    });

    describe('password schema', () => {
      it('should validate strong password', () => {
        const result = CommonSchemas.password.safeParse('StrongP@ssw0rd123');
        expect(result.success).toBe(true);
      });

      it('should reject weak password', () => {
        const result = CommonSchemas.password.safeParse('weak');
        expect(result.success).toBe(false);
      });

      it('should reject too long password', () => {
        const longPassword = 'a'.repeat(130) + 'A1!';
        const result = CommonSchemas.password.safeParse(longPassword);
        expect(result.success).toBe(false);
      });
    });

    describe('displayName schema', () => {
      it('should validate correct display name', () => {
        const result = CommonSchemas.displayName.safeParse('John Doe');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('John Doe');
        }
      });

      it('should reject too short name', () => {
        const result = CommonSchemas.displayName.safeParse('A');
        expect(result.success).toBe(false);
      });

      it('should sanitize display name', () => {
        const result = CommonSchemas.displayName.safeParse('  John <script>alert()</script> Doe  ');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('John  Doe');
        }
      });
    });

    describe('year schema', () => {
      it('should validate valid year', () => {
        const result = CommonSchemas.year.safeParse(3);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(3);
        }
      });

      it('should reject invalid year', () => {
        const result = CommonSchemas.year.safeParse(7);
        expect(result.success).toBe(false);
      });

      it('should reject negative year', () => {
        const result = CommonSchemas.year.safeParse(-1);
        expect(result.success).toBe(false);
      });

      it('should handle optional year', () => {
        const result = CommonSchemas.year.safeParse(undefined);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBeUndefined();
        }
      });
    });

    describe('pagination schemas', () => {
      it('should validate and transform limit', () => {
        const result = CommonSchemas.pagination.limit.safeParse('50');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(50);
        }
      });

      it('should use default limit', () => {
        const result = CommonSchemas.pagination.limit.safeParse(undefined);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(20);
        }
      });

      it('should reject invalid limit', () => {
        const result = CommonSchemas.pagination.limit.safeParse('150');
        expect(result.success).toBe(false);
      });

      it('should validate and transform offset', () => {
        const result = CommonSchemas.pagination.offset.safeParse('10');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(10);
        }
      });

      it('should use default offset', () => {
        const result = CommonSchemas.pagination.offset.safeParse(undefined);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(0);
        }
      });

      it('should reject negative offset', () => {
        const result = CommonSchemas.pagination.offset.safeParse('-5');
        expect(result.success).toBe(false);
      });
    });
  });
});
