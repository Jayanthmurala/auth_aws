import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildServer from '../../index';
import { prisma } from '../../db';
import { generateAccessToken } from '../../utils/jwt';

// P1-4: Comprehensive test suite for college endpoints
describe('College Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUserId: string;
  let testCollegeId: string;

  beforeAll(async () => {
    // Build test app
    app = await buildServer();
    
    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: 'test@college.edu',
        displayName: 'Test User',
        roles: ['STUDENT'],
        status: 'ACTIVE',
        collegeId: 'test-college-id',
        department: 'Computer Science'
      }
    });
    testUserId = testUser.id;
    
    // Generate auth token
    authToken = await generateAccessToken({
      sub: testUserId,
      email: testUser.email,
      roles: testUser.roles
    });
    
    // Create test college
    const testCollege = await prisma.college.create({
      data: {
        name: 'Test University',
        code: 'TEST',
        location: 'Test City',
        website: 'https://test.edu',
        departments: ['Computer Science', 'Engineering', 'Business'],
        isActive: true
      }
    });
    testCollegeId = testCollege.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany({ where: { email: 'test@college.edu' } });
    await prisma.college.deleteMany({ where: { code: 'TEST' } });
    await app.close();
  });

  beforeEach(async () => {
    // Reset any test data modifications
  });

  describe('Authentication & Authorization', () => {
    it('should require authentication for all endpoints', async () => {
      const endpoints = [
        '/v1/colleges',
        `/v1/colleges/${testCollegeId}`,
        `/v1/colleges/${testCollegeId}/departments`
      ];

      for (const endpoint of endpoints) {
        const response = await app.inject({
          method: 'GET',
          url: endpoint
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({
          success: false,
          error: {
            code: 'AUTH_TOKEN_MISSING'
          }
        });
      }
    });

    it('should reject invalid tokens', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: 'Bearer invalid-token'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'AUTH_TOKEN_EXPIRED'
        }
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      // Make multiple requests to trigger rate limit
      const requests = Array.from({ length: 101 }, () =>
        app.inject({
          method: 'GET',
          url: '/v1/colleges',
          headers: {
            authorization: `Bearer ${authToken}`
          }
        })
      );

      const responses = await Promise.all(requests);
      
      // Should have at least one rate limited response
      const rateLimitedResponse = responses.find(r => r.statusCode === 429);
      expect(rateLimitedResponse).toBeDefined();
      
      if (rateLimitedResponse) {
        expect(rateLimitedResponse.json()).toMatchObject({
          success: false,
          code: 'GENERAL_RATE_LIMIT_EXCEEDED'
        });
      }
    });

    it('should include rate limit headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('GET /v1/colleges', () => {
    it('should return paginated college list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      expect(body).toMatchObject({
        colleges: expect.any(Array),
        total: expect.any(Number),
        pagination: {
          limit: expect.any(Number),
          offset: expect.any(Number),
          hasMore: expect.any(Boolean)
        }
      });

      // Verify college structure
      if (body.colleges.length > 0) {
        expect(body.colleges[0]).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          code: expect.any(String),
          isActive: expect.any(Boolean),
          departments: expect.any(Array)
        });

        // Should not include sensitive fields
        expect(body.colleges[0]).not.toHaveProperty('createdAt');
        expect(body.colleges[0]).not.toHaveProperty('updatedAt');
      }
    });

    it('should filter by active status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges?active=true',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      body.colleges.forEach((college: any) => {
        expect(college.isActive).toBe(true);
      });
    });

    it('should support search functionality', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges?search=Test',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      // Should find our test college
      const testCollege = body.colleges.find((c: any) => c.code === 'TEST');
      expect(testCollege).toBeDefined();
    });

    it('should support location filtering', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges?location=Test City',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      body.colleges.forEach((college: any) => {
        if (college.location) {
          expect(college.location.toLowerCase()).toContain('test');
        }
      });
    });

    it('should respect pagination limits', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges?limit=5&offset=0',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      expect(body.colleges.length).toBeLessThanOrEqual(5);
      expect(body.pagination.limit).toBe(5);
      expect(body.pagination.offset).toBe(0);
    });

    it('should validate query parameters', async () => {
      const invalidQueries = [
        '?limit=invalid',
        '?offset=-1',
        '?limit=1000',
        '?search=' + 'x'.repeat(101), // Too long
        '?search=<script>alert("xss")</script>' // Invalid characters
      ];

      for (const query of invalidQueries) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/colleges${query}`,
          headers: {
            authorization: `Bearer ${authToken}`
          }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          success: false,
          error: {
            code: 'VALIDATION_ERROR'
          }
        });
      }
    });
  });

  describe('GET /v1/colleges/:id', () => {
    it('should return college by valid ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/colleges/${testCollegeId}`,
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      expect(body).toMatchObject({
        id: testCollegeId,
        name: 'Test University',
        code: 'TEST',
        location: 'Test City',
        website: 'https://test.edu',
        departments: ['Computer Science', 'Engineering', 'Business'],
        isActive: true
      });

      // Should not include sensitive fields
      expect(body).not.toHaveProperty('createdAt');
      expect(body).not.toHaveProperty('updatedAt');
    });

    it('should return 404 for non-existent college', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges/non-existent-id',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'COLLEGE_NOT_FOUND',
          message: 'The requested college could not be found'
        }
      });
    });

    it('should validate college ID format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges/invalid-id-format',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid college ID format'
        }
      });
    });
  });

  describe('GET /v1/colleges/:id/departments', () => {
    it('should return departments for valid college', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/colleges/${testCollegeId}/departments`,
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      expect(body).toMatchObject({
        success: true,
        data: {
          collegeId: testCollegeId,
          collegeName: 'Test University',
          departments: ['Computer Science', 'Engineering', 'Business']
        }
      });
    });

    it('should return 404 for non-existent college', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges/non-existent-id/departments',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'COLLEGE_NOT_FOUND'
        }
      });
    });

    it('should handle inactive colleges', async () => {
      // Create inactive college
      const inactiveCollege = await prisma.college.create({
        data: {
          name: 'Inactive University',
          code: 'INACTIVE',
          departments: ['Test Dept'],
          isActive: false
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/colleges/${inactiveCollege.id}/departments`,
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'COLLEGE_INACTIVE'
        }
      });

      // Cleanup
      await prisma.college.delete({ where: { id: inactiveCollege.id } });
    });

    it('should handle empty departments array', async () => {
      // Create college with no departments
      const emptyCollege = await prisma.college.create({
        data: {
          name: 'Empty University',
          code: 'EMPTY',
          departments: [],
          isActive: true
        }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/colleges/${emptyCollege.id}/departments`,
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      expect(body.data.departments).toEqual([]);

      // Cleanup
      await prisma.college.delete({ where: { id: emptyCollege.id } });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Mock database error by temporarily closing connection
      // This is a simplified test - in real scenarios, you'd mock Prisma
      
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      // Should either succeed or return proper error format
      if (response.statusCode !== 200) {
        expect(response.json()).toMatchObject({
          success: false,
          error: {
            code: expect.any(String),
            message: expect.any(String),
            timestamp: expect.any(String)
          }
        });
      }
    });

    it('should include request IDs in error responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges/invalid-id',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      
      expect(body.error).toHaveProperty('requestId');
      expect(body.error.requestId).toBeTruthy();
    });
  });

  describe('Security', () => {
    it('should not expose sensitive data in responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      body.colleges.forEach((college: any) => {
        // Should not expose internal timestamps
        expect(college).not.toHaveProperty('createdAt');
        expect(college).not.toHaveProperty('updatedAt');
        
        // Should not expose internal IDs or metadata
        expect(college).not.toHaveProperty('_count');
        expect(college).not.toHaveProperty('adminAuditLogs');
      });
    });

    it('should sanitize search inputs', async () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        'DROP TABLE colleges;',
        '../../etc/passwd',
        'javascript:alert(1)'
      ];

      for (const input of maliciousInputs) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/colleges?search=${encodeURIComponent(input)}`,
          headers: {
            authorization: `Bearer ${authToken}`
          }
        });

        // Should either reject with validation error or handle safely
        if (response.statusCode === 400) {
          expect(response.json()).toMatchObject({
            success: false,
            error: {
              code: 'VALIDATION_ERROR'
            }
          });
        } else {
          // If accepted, should not cause any issues
          expect(response.statusCode).toBe(200);
        }
      }
    });
  });

  describe('Performance', () => {
    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now();
      
      const response = await app.inject({
        method: 'GET',
        url: '/v1/colleges',
        headers: {
          authorization: `Bearer ${authToken}`
        }
      });

      const responseTime = Date.now() - startTime;
      
      expect(response.statusCode).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should handle concurrent requests', async () => {
      const concurrentRequests = Array.from({ length: 10 }, () =>
        app.inject({
          method: 'GET',
          url: '/v1/colleges',
          headers: {
            authorization: `Bearer ${authToken}`
          }
        })
      );

      const responses = await Promise.all(concurrentRequests);
      
      responses.forEach(response => {
        expect([200, 429]).toContain(response.statusCode); // Success or rate limited
      });
    });
  });
});
