# Testing Guide

## 🧪 Comprehensive Testing Strategy

The Nexus Auth Service uses a multi-layered testing approach including unit tests, integration tests, and end-to-end testing.

---

## 🛠️ Test Setup

### Test Environment

```bash
# Install test dependencies
npm install

# Set up test database
cp .env .env.test
# Update DATABASE_URL for test database in .env.test

# Run database migrations for tests
NODE_ENV=test npx prisma migrate dev
```

### Test Configuration

```javascript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    timeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts'
      ]
    }
  }
});
```

---

## 🔬 Unit Tests

### Running Unit Tests

```bash
# Run all unit tests
npm run test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific test file
npm run test auth.test.ts
```

### Authentication Tests

```javascript
// tests/unit/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../../src/services/auth.service';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('validatePassword', () => {
    it('should validate correct password', async () => {
      const hashedPassword = await authService.hashPassword('password123');
      const isValid = await authService.validatePassword('password123', hashedPassword);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hashedPassword = await authService.hashPassword('password123');
      const isValid = await authService.validatePassword('wrongpassword', hashedPassword);
      expect(isValid).toBe(false);
    });
  });

  describe('generateJWT', () => {
    it('should generate valid JWT token', async () => {
      const payload = { userId: '123', email: 'test@example.com' };
      const token = await authService.generateJWT(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });
});
```

---

## 🔗 Integration Tests

### Database Integration

```javascript
// tests/integration/database.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/db';

describe('Database Integration', () => {
  beforeAll(async () => {
    // Clean test database
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should create and retrieve user', async () => {
    const userData = {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      hashedPassword: 'hashed_password'
    };

    const user = await prisma.user.create({ data: userData });
    expect(user.email).toBe(userData.email);

    const retrieved = await prisma.user.findUnique({
      where: { id: user.id }
    });
    expect(retrieved).toBeDefined();
    expect(retrieved?.email).toBe(userData.email);
  });
});
```

### API Integration Tests

```javascript
// tests/integration/api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index';
import { FastifyInstance } from 'fastify';

describe('API Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'newuser@example.com',
          password: 'Password123!',
          firstName: 'New',
          lastName: 'User',
          collegeId: 'test-college-id',
          role: 'STUDENT'
        }
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.data.user.email).toBe('newuser@example.com');
    });

    it('should reject duplicate email', async () => {
      // First registration
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'Password123!',
          firstName: 'First',
          lastName: 'User'
        }
      });

      // Duplicate registration
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'Password123!',
          firstName: 'Second',
          lastName: 'User'
        }
      });

      expect(response.statusCode).toBe(409);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('DUPLICATE_EMAIL');
    });
  });
});
```

---

## 🌐 API Testing with Postman

### Postman Collection Setup

Create `docs/postman/nexus-auth.postman_collection.json`:

```json
{
  "info": {
    "name": "Nexus Auth Service",
    "description": "Complete API collection for Nexus Auth Service",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{accessToken}}",
        "type": "string"
      }
    ]
  },
  "event": [
    {
      "listen": "prerequest",
      "script": {
        "exec": [
          "// Auto-refresh token if expired",
          "const expiresAt = pm.environment.get('tokenExpiresAt');",
          "if (expiresAt && Date.now() > parseInt(expiresAt) - 60000) {",
          "  pm.sendRequest({",
          "    url: pm.environment.get('baseUrl') + '/api/v1/auth/refresh',",
          "    method: 'POST',",
          "    header: { 'Content-Type': 'application/json' },",
          "    body: {",
          "      mode: 'raw',",
          "      raw: JSON.stringify({",
          "        refreshToken: pm.environment.get('refreshToken')",
          "      })",
          "    }",
          "  }, (err, res) => {",
          "    if (!err && res.code === 200) {",
          "      const data = res.json();",
          "      pm.environment.set('accessToken', data.data.accessToken);",
          "      pm.environment.set('refreshToken', data.data.refreshToken);",
          "      pm.environment.set('tokenExpiresAt', Date.now() + (data.data.expiresIn * 1000));",
          "    }",
          "  });",
          "}"
        ]
      }
    }
  ],
  "item": [
    {
      "name": "Authentication",
      "item": [
        {
          "name": "Register",
          "request": {
            "method": "POST",
            "header": [],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{$randomEmail}}\",\n  \"password\": \"Password123!\",\n  \"firstName\": \"{{$randomFirstName}}\",\n  \"lastName\": \"{{$randomLastName}}\",\n  \"collegeId\": \"{{collegeId}}\",\n  \"role\": \"STUDENT\"\n}",
              "options": {
                "raw": {
                  "language": "json"
                }
              }
            },
            "url": {
              "raw": "{{baseUrl}}/api/v1/auth/register",
              "host": ["{{baseUrl}}"],
              "path": ["api", "v1", "auth", "register"]
            }
          }
        },
        {
          "name": "Login",
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "if (pm.response.code === 200) {",
                  "  const data = pm.response.json();",
                  "  if (data.data.tokens) {",
                  "    pm.environment.set('accessToken', data.data.tokens.accessToken);",
                  "    pm.environment.set('refreshToken', data.data.tokens.refreshToken);",
                  "    pm.environment.set('tokenExpiresAt', Date.now() + (data.data.tokens.expiresIn * 1000));",
                  "  }",
                  "}"
                ]
              }
            }
          ],
          "request": {
            "method": "POST",
            "header": [],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{testEmail}}\",\n  \"password\": \"{{testPassword}}\"\n}",
              "options": {
                "raw": {
                  "language": "json"
                }
              }
            },
            "url": {
              "raw": "{{baseUrl}}/api/v1/auth/login",
              "host": ["{{baseUrl}}"],
              "path": ["api", "v1", "auth", "login"]
            }
          }
        }
      ]
    }
  ]
}
```

### Environment Configuration

```json
{
  "name": "Nexus Auth - Development",
  "values": [
    {
      "key": "baseUrl",
      "value": "http://localhost:4001",
      "enabled": true
    },
    {
      "key": "testEmail",
      "value": "test@example.com",
      "enabled": true
    },
    {
      "key": "testPassword",
      "value": "Password123!",
      "enabled": true
    },
    {
      "key": "collegeId",
      "value": "default-college-id",
      "enabled": true
    }
  ]
}
```

---

## 🔒 Security Testing

### Authentication Security Tests

```javascript
// tests/security/auth-security.test.ts
describe('Authentication Security', () => {
  it('should prevent brute force attacks', async () => {
    const attempts = [];
    
    // Make 6 failed login attempts
    for (let i = 0; i < 6; i++) {
      attempts.push(
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            email: 'test@example.com',
            password: 'wrongpassword'
          }
        })
      );
    }
    
    const responses = await Promise.all(attempts);
    const lastResponse = responses[responses.length - 1];
    
    expect(lastResponse.statusCode).toBe(429);
    expect(JSON.parse(lastResponse.payload).error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should validate JWT token properly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: 'Bearer invalid-token'
      }
    });

    expect(response.statusCode).toBe(401);
  });
});
```

### Input Validation Tests

```javascript
describe('Input Validation', () => {
  it('should reject invalid email formats', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'invalid-email',
        password: 'Password123!'
      }
    });

    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.payload);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject weak passwords', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'test@example.com',
        password: '123'
      }
    });

    expect(response.statusCode).toBe(422);
  });
});
```

---

## 🏃‍♂️ Performance Testing

### Load Testing with Artillery

```yaml
# artillery-config.yml
config:
  target: 'http://localhost:4001'
  phases:
    - duration: 60
      arrivalRate: 10
    - duration: 120
      arrivalRate: 50
    - duration: 60
      arrivalRate: 100
  defaults:
    headers:
      Content-Type: 'application/json'

scenarios:
  - name: 'Authentication Flow'
    weight: 70
    flow:
      - post:
          url: '/api/v1/auth/login'
          json:
            email: 'test@example.com'
            password: 'Password123!'
          capture:
            - json: '$.data.tokens.accessToken'
              as: 'accessToken'
      - get:
          url: '/api/v1/auth/me'
          headers:
            Authorization: 'Bearer {{ accessToken }}'
  
  - name: 'Health Check'
    weight: 30
    flow:
      - get:
          url: '/health'
```

```bash
# Run load tests
npm install -g artillery
artillery run artillery-config.yml
```

---

## 🧪 Test Data Management

### Test Fixtures

```javascript
// tests/fixtures/users.ts
export const testUsers = {
  student: {
    email: 'student@example.com',
    password: 'StudentPass123!',
    firstName: 'Test',
    lastName: 'Student',
    role: 'STUDENT'
  },
  faculty: {
    email: 'faculty@example.com',
    password: 'FacultyPass123!',
    firstName: 'Test',
    lastName: 'Faculty',
    role: 'FACULTY'
  },
  admin: {
    email: 'admin@example.com',
    password: 'AdminPass123!',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'HEAD_ADMIN'
  }
};
```

### Database Seeding for Tests

```javascript
// tests/helpers/seed.ts
import { prisma } from '../../src/db';
import { testUsers } from '../fixtures/users';

export async function seedTestData() {
  // Clean existing data
  await prisma.user.deleteMany();
  
  // Create test users
  for (const userData of Object.values(testUsers)) {
    await prisma.user.create({
      data: {
        ...userData,
        hashedPassword: await hashPassword(userData.password),
        status: 'ACTIVE',
        emailVerified: true
      }
    });
  }
}

export async function cleanTestData() {
  await prisma.user.deleteMany();
}
```

---

## 📊 Test Coverage

### Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View HTML coverage report
open coverage/index.html
```

### Coverage Targets

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 85%
- **Lines**: > 80%

---

## 🔄 Continuous Integration

### GitHub Actions Test Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: nexus_auth_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Setup test environment
      run: |
        cp .env.example .env.test
        echo "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nexus_auth_test" >> .env.test
        echo "REDIS_URL=redis://localhost:6379" >> .env.test
    
    - name: Run database migrations
      run: NODE_ENV=test npx prisma migrate deploy
    
    - name: Run tests
      run: npm run test:coverage
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
```

---

For more information, see:
- [API Overview](./api-overview.md)
- [Installation Guide](./installation.md)
- [Troubleshooting Guide](./troubleshooting.md)
