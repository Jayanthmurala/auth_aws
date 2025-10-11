# 🎯 Standard Path Structure Guide

## Overview

This document establishes the **official path and import standards** for the Nexus Auth Service. Following these standards ensures consistency, maintainability, and prevents runtime errors in production.

---

## 📋 Path Standards Summary

### ✅ **Adopted Standards**
- **API Endpoints**: `/v1/*` (no `/api` prefix)
- **Import Extensions**: Always use `.js` for ESM imports
- **Import Style**: Relative paths with proper extensions
- **Route Versioning**: All API routes use `/v1/` prefix
- **Health Endpoints**: No version prefix (`/health`, `/ready`)

### 🎯 **Future Improvements**
- **Absolute Imports**: Implement `@/` path mapping
- **Consistent Prefixes**: Consider adding `/api` prefix for all routes
- **Import Linting**: Add ESLint rules for import consistency

---

## 🛣️ API Route Structure

### Current Standard (Implemented)

```
Base URL: http://localhost:4001

Authentication:
├── GET    /v1/auth/me
├── POST   /v1/auth/login
├── POST   /v1/auth/register
├── POST   /v1/auth/logout
├── POST   /v1/auth/refresh
└── POST   /v1/auth/validate-password

User Management:
├── GET    /v1/users
├── GET    /v1/users/:userId
├── PUT    /v1/users/:userId
├── POST   /v1/users/batch
├── GET    /v1/users/search
├── GET    /v1/users/college/:collegeId
└── GET    /v1/users/discovery

College Management:
├── GET    /v1/colleges
├── GET    /v1/colleges/:id
└── GET    /v1/colleges/:id/departments

Multi-Factor Authentication:
├── GET    /v1/mfa/status
├── POST   /v1/mfa/totp/setup
├── POST   /v1/mfa/totp/verify
├── POST   /v1/mfa/sms/setup
├── POST   /v1/mfa/sms/verify
├── POST   /v1/mfa/verify
├── POST   /v1/mfa/backup-codes/regenerate
└── DELETE /v1/mfa/methods/:methodId

Admin Routes:
├── GET    /v1/admin/health
├── GET    /admin/jwt-keys/stats
├── GET    /admin/jwt-keys
├── POST   /admin/jwt-keys/rotate
└── GET    /admin/mfa/stats

Health & Monitoring:
├── GET    /health
├── GET    /health/detailed
├── GET    /ready
├── GET    /live
├── GET    /metrics
└── GET    /monitoring/metrics

Security:
├── GET    /security/csrf-token
├── GET    /security/stats
├── POST   /security/unblock-ip
├── GET    /security/health
├── GET    /security/config
├── GET    /security/audit-logs
└── GET    /security/audit-stats

Special Endpoints:
├── GET    /.well-known/jwks.json
└── GET    /docs (Swagger UI)
```

### Route Registration Pattern

```typescript
// src/index.ts - Standard route registration
await app.register(healthRoutes);     // No prefix - /health, /ready
await app.register(authRoutes);       // No prefix - /v1/auth/*
await app.register(usersRoutes);      // No prefix - /v1/users/*
await app.register(collegeRoutes);    // No prefix - /v1/colleges/*
await app.register(securityRoutes);   // No prefix - /security/*
await app.register(keyManagementRoutes); // No prefix - /admin/jwt-keys/*
await app.register(mfaRoutes);        // No prefix - /v1/mfa/*
```

### Route Definition Pattern

```typescript
// Standard route definition in route files
async function authRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();
  
  // ✅ Correct pattern - include version in path
  f.get("/v1/auth/me", { ... });
  f.post("/v1/auth/login", { ... });
  f.post("/v1/auth/register", { ... });
}

// Health routes - no version
async function healthRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();
  
  // ✅ Correct pattern - no version for health
  f.get("/health", { ... });
  f.get("/ready", { ... });
}
```

---

## 📁 Import Path Standards

### Current Standard (ESM with .js extensions)

```typescript
// ✅ CORRECT - Relative imports with .js extension
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import { prisma } from "./db.js";
import { Logger } from "./utils/logger.js";

// ✅ CORRECT - Deep relative imports
import { prisma } from "../../db.js";
import { hashPassword } from "../../utils/crypto.js";

// ❌ WRONG - Missing .js extension
import { env } from "./config/env";
import { prisma } from "./db";

// ❌ WRONG - Using .ts extension
import { env } from "./config/env.ts";
```

### File Structure Reference

```
src/
├── index.ts                    # Main entry point
├── db.ts                      # Database connection
├── config/
│   ├── env.ts                 # Environment configuration
│   ├── database.ts            # Database configuration
│   └── redis.ts               # Redis configuration
├── routes/
│   ├── auth.routes.ts         # Authentication routes
│   ├── users.routes.ts        # User management routes
│   ├── college.routes.ts      # College routes
│   ├── health.routes.ts       # Health check routes
│   ├── security.routes.ts     # Security routes
│   ├── mfa.routes.ts          # MFA routes
│   └── keyManagement.routes.ts # JWT key management
├── middleware/
│   ├── authMiddleware.ts      # Authentication middleware
│   ├── rateLimitMiddleware.ts # Rate limiting
│   ├── errorHandler.ts        # Error handling
│   └── ...
├── services/
│   ├── MFAService.ts          # MFA business logic
│   ├── JWTKeyRotationService.ts # JWT key rotation
│   └── ...
├── utils/
│   ├── jwt.ts                 # JWT utilities
│   ├── crypto.ts              # Cryptographic functions
│   ├── logger.ts              # Logging utilities
│   └── ...
├── schemas/
│   ├── auth.schemas.ts        # Authentication schemas
│   └── ...
└── admin/
    ├── routes/
    ├── controllers/
    ├── services/
    └── middleware/
```

### Import Patterns by File Location

```typescript
// src/index.ts (root level)
import { env } from "./config/env.js";           // ✅ Same level folder
import authRoutes from "./routes/auth.routes.js"; // ✅ Same level folder
import { prisma } from "./db.js";                // ✅ Same level file

// src/routes/auth.routes.ts (1 level deep)
import { prisma } from "../db.js";               // ✅ Up one level
import { env } from "../config/env.js";          // ✅ Up one level, down one
import { Logger } from "../utils/logger.js";     // ✅ Up one level, down one

// src/admin/controllers/HeadAdminController.ts (2 levels deep)
import { prisma } from "../../db.js";            // ✅ Up two levels
import { env } from "../../config/env.js";       // ✅ Up two levels, down one
import { Logger } from "../../utils/logger.js";  // ✅ Up two levels, down one
```

---

## 🔮 Future Standard (Absolute Imports)

### Proposed TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": "./src",
    "paths": {
      "@/*": ["*"],
      "@/config/*": ["config/*"],
      "@/utils/*": ["utils/*"],
      "@/middleware/*": ["middleware/*"],
      "@/routes/*": ["routes/*"],
      "@/services/*": ["services/*"],
      "@/schemas/*": ["schemas/*"],
      "@/admin/*": ["admin/*"]
    }
  }
}
```

### Proposed Import Patterns

```typescript
// Future standard - Absolute imports with @/ prefix
import { env } from "@/config/env.js";
import { prisma } from "@/db.js";
import { Logger } from "@/utils/logger.js";
import { hashPassword } from "@/utils/crypto.js";
import { authenticateUser } from "@/middleware/authMiddleware.js";

// Admin modules
import { AdminUserService } from "@/admin/services/AdminUserService.js";
import { adminAuth } from "@/admin/middleware/adminAuth.js";
```

### Migration Strategy

1. **Phase 1**: Update `tsconfig.json` with path mapping
2. **Phase 2**: Create migration script to convert relative imports
3. **Phase 3**: Update all files systematically
4. **Phase 4**: Add ESLint rules to enforce absolute imports

---

## 🔧 Development Guidelines

### Adding New Routes

```typescript
// 1. Create route file in src/routes/
// src/routes/newFeature.routes.ts

import type { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

async function newFeatureRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();
  
  // ✅ Always include /v1/ prefix for API routes
  f.get("/v1/new-feature", { ... });
  f.post("/v1/new-feature", { ... });
}

export default newFeatureRoutes;

// 2. Register in src/index.ts
import newFeatureRoutes from "./routes/newFeature.routes.js";
await app.register(newFeatureRoutes);
```

### Adding New Services

```typescript
// src/services/NewService.ts
import { prisma } from "../db.js";              // ✅ Relative import
import { Logger } from "../utils/logger.js";    // ✅ Relative import
import { env } from "../config/env.js";         // ✅ Relative import

export class NewService {
  // Service implementation
}
```

### Adding New Middleware

```typescript
// src/middleware/newMiddleware.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { Logger } from "../utils/logger.js";    // ✅ Relative import

export async function newMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Middleware implementation
}
```

---

## 🧪 Verification & Testing

### Path Verification Script

```bash
#!/bin/bash
# scripts/verify-paths.sh

echo "🔍 Verifying API paths..."

# Test all documented endpoints
endpoints=(
  "/v1/auth/me"
  "/v1/auth/login"
  "/v1/users"
  "/v1/colleges"
  "/health"
  "/ready"
)

for endpoint in "${endpoints[@]}"; do
  echo "Testing: $endpoint"
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:4001$endpoint" || echo "❌ Failed"
done

echo "✅ Path verification complete"
```

### Import Verification

```bash
# Check for missing .js extensions
grep -r "from ['\"]\..*[^\.js]['\"]" src/ && echo "❌ Found imports without .js extension"

# Check for .ts extensions in imports
grep -r "from ['\"].*\.ts['\"]" src/ && echo "❌ Found .ts extensions in imports"

# Verify all imports are valid
npm run build && echo "✅ All imports are valid"
```

### Runtime Testing

```bash
# Build and test for runtime errors
npm run build
node dist/index.js &
SERVER_PID=$!

# Wait for server to start
sleep 5

# Test endpoints
curl http://localhost:4001/health
curl http://localhost:4001/v1/auth/me

# Cleanup
kill $SERVER_PID
```

---

## 📚 Best Practices

### DO ✅

1. **Always use `.js` extensions** for relative imports in TypeScript
2. **Include `/v1/` prefix** for all API routes
3. **Use consistent route registration** without prefixes in main file
4. **Follow the established folder structure**
5. **Use TypeScript strict mode** for better error catching
6. **Test all endpoints** after making path changes

### DON'T ❌

1. **Don't mix import styles** (relative vs absolute) in the same file
2. **Don't use `.ts` extensions** in import statements
3. **Don't omit `.js` extensions** in ESM imports
4. **Don't add `/api` prefix** without updating all routes consistently
5. **Don't move files** without updating all import paths
6. **Don't skip testing** after path changes

---

## 🔄 Migration Checklist

### When Adding New Features

- [ ] Follow established folder structure
- [ ] Use correct import patterns with `.js` extensions
- [ ] Include `/v1/` prefix for API routes
- [ ] Register routes in `src/index.ts`
- [ ] Test endpoints after implementation
- [ ] Update documentation if needed

### When Refactoring Paths

- [ ] Update all import statements
- [ ] Test build process (`npm run build`)
- [ ] Test runtime (`node dist/index.js`)
- [ ] Verify all endpoints work
- [ ] Update documentation
- [ ] Update frontend integration if needed

### When Moving Files

- [ ] Update all files that import the moved file
- [ ] Update route registration if applicable
- [ ] Test build and runtime
- [ ] Update any scripts that reference the file
- [ ] Update documentation

---

## 🆘 Troubleshooting

### Common Issues

**Issue**: `ERR_MODULE_NOT_FOUND` errors
**Solution**: Check all imports have `.js` extensions

**Issue**: 404 errors on API calls
**Solution**: Verify endpoint paths match route definitions

**Issue**: Build failures
**Solution**: Check TypeScript configuration and import paths

**Issue**: Deep relative import complexity
**Solution**: Consider implementing absolute imports with `@/` prefix

### Debug Commands

```bash
# Check all import statements
grep -r "import.*from" src/ | grep -v ".js"

# Find all route definitions
grep -r "f\.get\|f\.post\|f\.put\|f\.delete" src/routes/

# Verify route registration
grep -r "app\.register" src/index.ts

# Test specific endpoint
curl -v http://localhost:4001/v1/auth/me
```

---

**Last Updated**: October 2025  
**Version**: 1.0  
**Maintainer**: Nexus Development Team
