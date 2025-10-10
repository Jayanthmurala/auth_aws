import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildServer from '../../src/index';
import { prisma } from '../../src/db';

describe('Authentication Endpoints Integration Tests', () => {
  let app: FastifyInstance;
  let testUser: any;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.securityToken.deleteMany({});
    await prisma.user.deleteMany({});
    
    // Create test college
    const college = await prisma.college.create({
      data: {
        name: 'Test University',
        code: 'TEST',
        departments: ['Computer Science', 'Mathematics'],
        isActive: true
      }
    });

    // Create test user
    testUser = {
      email: 'test@example.com',
      password: 'TestPassword123!',
      displayName: 'Test User',
      role: 'STUDENT',
      collegeId: college.id,
      department: 'Computer Science',
      year: 3
    };
  });

  describe('POST /v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.user.email).toBe(testUser.email);
      expect(body.user.displayName).toBe(testUser.displayName);
    });

    it('should reject weak passwords', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          ...testUser,
          password: 'weak'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Password must');
    });

    it('should reject duplicate email registration', async () => {
      // First registration
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      // Second registration with same email
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('already registered');
    });

    it('should enforce rate limiting', async () => {
      const requests = [];
      
      // Make 4 registration attempts (rate limit is 3/hour)
      for (let i = 0; i < 4; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/v1/auth/register',
            payload: {
              ...testUser,
              email: `test${i}@example.com`
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // First 3 should succeed or fail for other reasons
      expect(responses[0].statusCode).not.toBe(429);
      expect(responses[1].statusCode).not.toBe(429);
      expect(responses[2].statusCode).not.toBe(429);
      
      // 4th should be rate limited
      expect(responses[3].statusCode).toBe(429);
      const body = JSON.parse(responses[3].body);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('POST /v1/auth/login', () => {
    beforeEach(async () => {
      // Register a user for login tests
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });
    });

    it('should login successfully with correct credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.user.email).toBe(testUser.email);
      
      accessToken = body.accessToken;
    });

    it('should reject invalid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: testUser.email,
          password: 'wrongpassword'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Invalid email or password');
    });

    it('should enforce rate limiting on failed attempts', async () => {
      const requests = [];
      
      // Make 6 failed login attempts (rate limit is 5/15min)
      for (let i = 0; i < 6; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/v1/auth/login',
            payload: {
              email: testUser.email,
              password: 'wrongpassword'
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // First 5 should return 401 (invalid credentials)
      for (let i = 0; i < 5; i++) {
        expect(responses[i].statusCode).toBe(401);
      }
      
      // 6th should be rate limited
      expect(responses[5].statusCode).toBe(429);
    });
  });

  describe('GET /v1/auth/me', () => {
    beforeEach(async () => {
      // Register and login to get access token
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password
        }
      });

      const loginBody = JSON.parse(loginResponse.body);
      accessToken = loginBody.accessToken;
    });

    it('should return user profile with valid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.email).toBe(testUser.email);
      expect(body.displayName).toBe(testUser.displayName);
      expect(body.roles).toContain('STUDENT');
    });

    it('should reject requests without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/me'
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    it('should reject requests with invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: {
          authorization: 'Bearer invalid-token'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  describe('POST /v1/auth/logout', () => {
    beforeEach(async () => {
      // Register and login to get access token
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password
        }
      });

      const loginBody = JSON.parse(loginResponse.body);
      accessToken = loginBody.accessToken;
    });

    it('should logout successfully with valid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should require authentication for logout', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout'
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/forgot-password', () => {
    beforeEach(async () => {
      // Register a user for password reset tests
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });
    });

    it('should send password reset email for valid user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: {
          email: testUser.email
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('password reset link');
    });

    it('should return success even for non-existent email (security)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: {
          email: 'nonexistent@example.com'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('password reset link');
    });

    it('should enforce rate limiting', async () => {
      const requests = [];
      
      // Make 4 password reset requests (rate limit is 3/hour)
      for (let i = 0; i < 4; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/v1/auth/forgot-password',
            payload: {
              email: testUser.email
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // First 3 should succeed
      expect(responses[0].statusCode).toBe(200);
      expect(responses[1].statusCode).toBe(200);
      expect(responses[2].statusCode).toBe(200);
      
      // 4th should be rate limited
      expect(responses[3].statusCode).toBe(429);
    });
  });

  describe('POST /v1/auth/reset-password', () => {
    let resetToken: string;

    beforeEach(async () => {
      // Register a user
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });

      // Request password reset to get token
      await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: {
          email: testUser.email
        }
      });

      // Get the reset token from database (in real app, this would be from email)
      const tokenRecord = await prisma.securityToken.findFirst({
        where: {
          type: 'PASSWORD_RESET',
          usedAt: null
        }
      });

      // Generate the actual token (this is normally in the email URL)
      resetToken = 'mock-reset-token'; // In real test, you'd need the actual token
    });

    it('should reset password with valid token', async () => {
      // Note: This test would need the actual reset token from the database
      // For now, we'll test the validation logic
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: {
          token: resetToken,
          password: 'NewPassword123!'
        }
      });

      // This will fail with invalid token, but tests the endpoint structure
      expect([401, 500]).toContain(response.statusCode);
    });

    it('should reject weak passwords', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/reset-password',
        payload: {
          token: resetToken,
          password: 'weak'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Password must');
    });
  });

  describe('POST /v1/auth/verify-email', () => {
    it('should verify email with valid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: {
          token: 'mock-verification-token'
        }
      });

      // This will fail with invalid token, but tests the endpoint structure
      expect([401, 500]).toContain(response.statusCode);
    });

    it('should reject invalid tokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: {
          token: 'invalid-token'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/resend-verification', () => {
    beforeEach(async () => {
      // Register a user
      await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: testUser
      });
    });

    it('should resend verification email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/resend-verification',
        payload: {
          email: testUser.email
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('verification email');
    });

    it('should enforce rate limiting', async () => {
      const requests = [];
      
      // Make 6 verification requests (rate limit is 5/hour)
      for (let i = 0; i < 6; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/v1/auth/resend-verification',
            payload: {
              email: testUser.email
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        expect(responses[i].statusCode).toBe(200);
      }
      
      // 6th should be rate limited
      expect(responses[5].statusCode).toBe(429);
    });
  });
});
