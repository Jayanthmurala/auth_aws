import { beforeAll, afterAll, beforeEach } from 'vitest';
import { env } from '../src/config/env';

// Mock environment variables for testing
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/nexus_test?schema=authsvc_test';
  process.env.AUTH_JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKB
UMnV/+5ZnOKgdXLjr7l1CG8M5wiyNhkbQjOQYeYXVy/6ZcjCO26HpgLNSd2d5Q==
-----END PRIVATE KEY-----`;
  process.env.AUTH_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L7VLPHCgVDJ1f/u
WZzioHVy46+5dQhvDOcIsjYZG0IzkGHmF1cv+mXIwjtuh6YCzUndneU=
-----END PUBLIC KEY-----`;
  process.env.AUTH_JWT_KID = 'test-key';
  process.env.FRONTEND_URLS = 'http://localhost:3000';
});

afterAll(() => {
  // Cleanup after all tests
});

beforeEach(() => {
  // Reset state before each test
});
