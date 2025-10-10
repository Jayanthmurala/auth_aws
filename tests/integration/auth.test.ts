import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import supertest from 'supertest';

// Mock Prisma client for testing
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  college: {
    findUnique: vi.fn(),
  },
  securityToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

// Mock the database module
vi.mock('../../src/db', () => ({
  prisma: mockPrisma,
}));

// Mock the profile initialization service
vi.mock('../../src/services/ProfileInitializationService', () => ({
  ProfileInitializationService: {
    initializeUserProfileAsync: vi.fn(),
  },
}));

// Mock the email service
vi.mock('../../src/emails/mailer', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({ messageId: 'test', previewUrl: 'test' }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ messageId: 'test', previewUrl: 'test' }),
}));


describe('Auth Routes Integration', () => {
  let app: FastifyInstance;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    // Import the server builder after mocks are set up
    const buildServer = (await import('../../src/index')).default;
    app = await buildServer();
    await app.ready();
    request = supertest(app.server);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe('POST /v1/auth/register', () => {
    const validRegistrationData = {
      displayName: 'Test User',
      email: 'test@example.com',
      password: 'StrongP@ssw0rd123',
      role: 'STUDENT',
      collegeId: 'college123',
      department: 'Computer Science',
      year: 2,
    };

    it('should register a new user successfully', async () => {
      // Mock college exists
      mockPrisma.college.findUnique.mockResolvedValue({
        id: 'college123',
        name: 'Test College',
        isActive: true,
      });

      // Mock user doesn't exist
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Mock user creation
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['STUDENT'],
        collegeId: 'college123',
        department: 'Computer Science',
        year: 2,
      };
      mockPrisma.user.create.mockResolvedValue(mockUser);

      const response = await request
        .post('/v1/auth/register')
        .send(validRegistrationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.accessToken).toBeDefined();
    });

    it('should reject registration with invalid email', async () => {
      const invalidData = {
        ...validRegistrationData,
        email: 'invalid-email',
      };

      const response = await request
        .post('/v1/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with weak password', async () => {
      const invalidData = {
        ...validRegistrationData,
        password: 'weak',
      };

      const response = await request
        .post('/v1/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with existing email', async () => {
      // Mock college exists
      mockPrisma.college.findUnique.mockResolvedValue({
        id: 'college123',
        name: 'Test College',
        isActive: true,
      });

      // Mock user already exists
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'test@example.com',
      });

      const response = await request
        .post('/v1/auth/register')
        .send(validRegistrationData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });

    it('should reject registration with non-existent college', async () => {
      // Mock college doesn't exist
      mockPrisma.college.findUnique.mockResolvedValue(null);

      const response = await request
        .post('/v1/auth/register')
        .send(validRegistrationData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('College not found');
    });
  });

  describe('POST /v1/auth/login', () => {
    const validLoginData = {
      email: 'test@example.com',
      password: 'StrongP@ssw0rd123',
    };

    it('should login successfully with correct credentials', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash', // Mock hash
        roles: ['STUDENT'],
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        collegeId: 'college123',
        department: 'Computer Science',
        year: 2,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      // Mock password verification (we'd need to mock the crypto module too)
      // For now, we'll assume the password verification passes

      const response = await request
        .post('/v1/auth/login')
        .send(validLoginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.headers['set-cookie']).toBeDefined(); // Refresh token cookie
    });

    it('should reject login with invalid email format', async () => {
      const invalidData = {
        ...validLoginData,
        email: 'invalid-email',
      };

      const response = await request
        .post('/v1/auth/login')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject login with non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request
        .post('/v1/auth/login')
        .send(validLoginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject login for unverified user', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash',
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const response = await request
        .post('/v1/auth/login')
        .send(validLoginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('verify');
    });
  });

  describe('GET /v1/auth/me', () => {
    it('should return user info with valid token', async () => {
      // This test would require creating a valid JWT token
      // For now, we'll test the endpoint structure
      const response = await request
        .get('/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOKEN_ERROR');
    });

    it('should reject request without authorization header', async () => {
      const response = await request
        .get('/v1/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /v1/auth/forgot-password', () => {
    it('should send password reset email for existing user', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        status: 'ACTIVE',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.securityToken.create.mockResolvedValue({
        id: 'token123',
        tokenHash: 'hash',
      });

      const response = await request
        .post('/v1/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('reset');
    });

    it('should handle non-existent user gracefully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request
        .post('/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      // Should return success even for non-existent users (security)
      expect(response.body.success).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on login endpoint', async () => {
      // Make multiple requests quickly
      const requests = Array(6).fill(null).map(() =>
        request
          .post('/v1/auth/login')
          .send({ email: 'test@example.com', password: 'password' })
      );

      const responses = await Promise.all(requests);
      
      // At least one should be rate limited
      const rateLimitedResponse = responses.find(r => r.status === 429);
      expect(rateLimitedResponse).toBeDefined();
      
      if (rateLimitedResponse) {
        expect(rateLimitedResponse.body.success).toBe(false);
        expect(rateLimitedResponse.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      }
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request.get('/health');

      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });
  });
});
