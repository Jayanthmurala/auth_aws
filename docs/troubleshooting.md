# Troubleshooting Guide

## 🚨 Common Issues & Solutions

This guide covers the most common issues you might encounter with the Nexus Auth Service and their solutions.

---

## 🔐 Authentication Issues

### JWT Token Problems

#### Issue: "Token expired" or "Token invalid"
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "JWT token has expired"
  }
}
```

**Solutions:**
1. **Check token expiration settings**:
   ```bash
   # In .env
   AUTH_JWT_ACCESS_EXPIRES_IN="15m"  # Default: 15 minutes
   AUTH_JWT_REFRESH_EXPIRES_IN="30d" # Default: 30 days
   ```

2. **Implement automatic token refresh**:
   ```javascript
   // Frontend: Refresh token before expiration
   const refreshToken = async () => {
     const response = await fetch('/api/v1/auth/refresh', {
       method: 'POST',
       body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') })
     });
     // Handle response...
   };
   ```

3. **Verify JWT key configuration**:
   ```bash
   # Regenerate JWT keys
   ./generate-env.sh
   # Copy keys to .env file
   ```

#### Issue: "Invalid JWT signature"
**Cause**: Mismatched public/private key pair or corrupted keys.

**Solutions:**
1. **Regenerate key pair**:
   ```bash
   openssl genpkey -algorithm RSA -out private.pem -pkcs8
   openssl rsa -pubout -in private.pem -out public.pem
   ```

2. **Check key format in .env**:
   ```bash
   # Ensure proper newline escaping
   AUTH_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----"
   ```

### Login Failures

#### Issue: "Invalid credentials" for valid users
**Debugging steps:**
1. **Check password hashing**:
   ```bash
   # Test password verification
   npm run test -- --grep "password"
   ```

2. **Verify database connection**:
   ```bash
   npx prisma db pull
   ```

3. **Check user status**:
   ```sql
   SELECT id, email, status, emailVerified FROM "User" WHERE email = 'user@example.com';
   ```

#### Issue: Account locked after failed attempts
```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_LOCKED",
    "message": "Account temporarily locked due to failed login attempts"
  }
}
```

**Solutions:**
1. **Wait for lockout period** (default: 15 minutes)
2. **Admin unlock** (if you have admin access):
   ```bash
   npm run unlock-account -- user@example.com
   ```
3. **Adjust rate limiting**:
   ```bash
   # In .env
   RATE_LIMIT_MAX=100
   RATE_LIMIT_WINDOW="15 minutes"
   ```

---

## 🌐 CORS Issues

### Preflight Request Failures

#### Issue: CORS preflight request blocked
```
Access to fetch at 'http://localhost:4001/api/v1/auth/login' from origin 'http://localhost:3001' has been blocked by CORS policy
```

**Solutions:**
1. **Add frontend URL to allowed origins**:
   ```bash
   # In .env
   FRONTEND_URLS="http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000"
   ```

2. **Check CORS configuration**:
   ```typescript
   // Verify in src/index.ts
   await app.register(cors, {
     origin: env.FRONTEND_URLS.split(',').map(url => url.trim()),
     credentials: true,
     allowedHeaders: ["Authorization", "Content-Type", "X-Request-ID"]
   });
   ```

3. **Test CORS manually**:
   ```bash
   curl -X OPTIONS http://localhost:4001/api/v1/auth/login \
     -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type"
   ```

#### Issue: Credentials not allowed
```
The value of the 'Access-Control-Allow-Credentials' header is '' which must be 'true'
```

**Solution:**
Ensure `credentials: 'include'` in frontend requests:
```javascript
fetch('/api/v1/auth/login', {
  method: 'POST',
  credentials: 'include', // Required!
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

---

## 🗄️ Database Issues

### Connection Problems

#### Issue: "Can't reach database server"
```
Error: Can't reach database server at `localhost:5432`
```

**Solutions:**
1. **Check PostgreSQL status**:
   ```bash
   # macOS/Linux
   sudo systemctl status postgresql
   
   # Windows
   net start postgresql-x64-15
   ```

2. **Verify connection string**:
   ```bash
   # Test connection
   psql "postgresql://username:password@localhost:5432/nexus_auth"
   ```

3. **Check firewall/network**:
   ```bash
   # Test port connectivity
   telnet localhost 5432
   ```

#### Issue: "Database does not exist"
**Solutions:**
1. **Create database**:
   ```sql
   CREATE DATABASE nexus_auth;
   ```

2. **Run migrations**:
   ```bash
   npx prisma migrate dev --name init
   ```

### Migration Issues

#### Issue: "Migration failed" or schema conflicts
**Solutions:**
1. **Reset database** (development only):
   ```bash
   npx prisma migrate reset
   ```

2. **Manual migration fix**:
   ```bash
   # Check migration status
   npx prisma migrate status
   
   # Mark migration as applied
   npx prisma migrate resolve --applied "migration_name"
   ```

3. **Force migration** (dangerous):
   ```bash
   npx prisma db push --force-reset
   ```

---

## 🔴 Redis Issues

### Connection Problems

#### Issue: Redis connection refused
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solutions:**
1. **Disable Redis for development**:
   ```bash
   # In .env
   REDIS_DISABLED=true
   ```

2. **Start Redis server**:
   ```bash
   # macOS with Homebrew
   brew services start redis
   
   # Ubuntu/Debian
   sudo systemctl start redis-server
   
   # Windows
   redis-server.exe
   ```

3. **Test Redis connection**:
   ```bash
   redis-cli ping
   # Expected: PONG
   ```

#### Issue: Redis authentication failed
```
Error: NOAUTH Authentication required
```

**Solutions:**
1. **Check Redis URL format**:
   ```bash
   # With password
   REDIS_URL="redis://:password@localhost:6379"
   
   # Without password
   REDIS_URL="redis://localhost:6379"
   ```

2. **Configure Redis AUTH**:
   ```bash
   # In redis.conf
   requirepass your_password
   ```

---

## 📧 Email Issues

### SMTP Configuration

#### Issue: Email not sending
**Debugging steps:**
1. **Check SMTP settings**:
   ```bash
   # In .env
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER="your-email@gmail.com"
   SMTP_PASS="your-app-password"
   ```

2. **Test SMTP connection**:
   ```bash
   npm run test-email -- user@example.com
   ```

3. **Check email logs**:
   ```bash
   docker logs nexus-auth-service | grep -i email
   ```

#### Issue: Gmail authentication failed
**Solutions:**
1. **Use App Password** (not regular password):
   - Enable 2FA on Gmail
   - Generate App Password
   - Use App Password in `SMTP_PASS`

2. **Enable "Less secure app access"** (not recommended):
   - Go to Google Account settings
   - Enable less secure app access

---

## 🐳 Docker Issues

### Build Problems

#### Issue: Docker build fails with package errors
```
ERROR: unable to select packages:
  libssl1.1 (no such package):
    required by: world[libssl1.1]
```

**Solutions:**
1. **Use correct Alpine packages**:
   ```dockerfile
   # ✅ Correct for Alpine 3.22+
   RUN apk add --no-cache openssl libssl3
   
   # ❌ Wrong (old packages)
   RUN apk add --no-cache openssl1.1-compat libssl1.1
   ```

2. **Update Prisma binary target**:
   ```prisma
   generator client {
     provider = "prisma-client-js"
     binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
   }
   ```

#### Issue: Prisma client generation fails in Docker
**Solutions:**
1. **Generate Prisma client in Docker**:
   ```dockerfile
   # Ensure this runs in builder stage
   RUN npx prisma generate --schema=./prisma/schema.prisma
   ```

2. **Copy Prisma artifacts correctly**:
   ```dockerfile
   COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
   ```

### Runtime Problems

#### Issue: Container exits immediately
**Debugging steps:**
1. **Check container logs**:
   ```bash
   docker logs container_name
   ```

2. **Run container interactively**:
   ```bash
   docker run -it --entrypoint sh nexus-auth:latest
   ```

3. **Check file permissions**:
   ```bash
   # Inside container
   ls -la /app/dist/
   node --version
   ```

#### Issue: Health check fails
```bash
# Test health endpoint manually
docker exec container_name curl -f http://localhost:4001/health
```

**Solutions:**
1. **Check if service is running**:
   ```bash
   docker exec container_name ps aux | grep node
   ```

2. **Verify port binding**:
   ```bash
   docker port container_name
   ```

---

## 🔧 Development Issues

### TypeScript Compilation

#### Issue: Build fails with type errors
**Solutions:**
1. **Check TypeScript configuration**:
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ES2022",
       "moduleResolution": "Node"
     }
   }
   ```

2. **Update import paths**:
   ```typescript
   // ✅ Correct ES module imports
   import { prisma } from './db.js';
   
   // ❌ Wrong (missing .js extension)
   import { prisma } from './db';
   ```

3. **Run import fixer**:
   ```bash
   npm run prebuild  # Runs fix-imports script
   ```

### Environment Variables

#### Issue: "Missing env var" errors on startup
**Solutions:**
1. **Check required variables**:
   ```bash
   # Required variables
   DATABASE_URL
   AUTH_JWT_PRIVATE_KEY
   AUTH_JWT_PUBLIC_KEY
   INTERNAL_API_KEY
   INTERNAL_API_SECRET
   CSRF_SECRET
   EXPORT_ENCRYPTION_KEY
   ```

2. **Generate missing secrets**:
   ```bash
   ./generate-env.sh
   ```

3. **Validate environment**:
   ```bash
   npm run validate-env
   ```

---

## 🧪 Testing Issues

### Test Failures

#### Issue: Tests fail with database errors
**Solutions:**
1. **Use test database**:
   ```bash
   # Create test environment
   cp .env .env.test
   # Update DATABASE_URL for test database
   ```

2. **Reset test database**:
   ```bash
   NODE_ENV=test npx prisma migrate reset
   ```

#### Issue: Tests timeout
**Solutions:**
1. **Increase timeout**:
   ```javascript
   // vitest.config.ts
   export default defineConfig({
     test: {
       timeout: 30000 // 30 seconds
     }
   });
   ```

2. **Mock external services**:
   ```javascript
   // Mock Redis in tests
   vi.mock('./utils/redis', () => ({
     redis: {
       get: vi.fn(),
       set: vi.fn(),
       del: vi.fn()
     }
   }));
   ```

---

## 📊 Performance Issues

### Slow Response Times

#### Issue: API responses are slow (>1s)
**Debugging steps:**
1. **Check database queries**:
   ```bash
   # Enable query logging
   DATABASE_LOGGING=true npm run dev
   ```

2. **Monitor database connections**:
   ```sql
   SELECT count(*) FROM pg_stat_activity WHERE datname = 'nexus_auth';
   ```

3. **Check Redis performance**:
   ```bash
   redis-cli --latency-history -i 1
   ```

**Solutions:**
1. **Add database indexes**:
   ```sql
   CREATE INDEX idx_user_email ON "User"(email);
   CREATE INDEX idx_user_college ON "User"("collegeId");
   ```

2. **Optimize Prisma queries**:
   ```typescript
   // ✅ Use select to limit fields
   const user = await prisma.user.findUnique({
     where: { email },
     select: { id: true, email: true, role: true }
   });
   ```

3. **Enable Redis caching**:
   ```bash
   REDIS_DISABLED=false
   ```

---

## 🔍 Debugging Tools

### Enable Debug Logging

```bash
# Full debug mode
DEBUG=* npm run dev

# Specific modules
DEBUG=prisma:query,fastify:* npm run dev

# Database queries only
DATABASE_LOGGING=true npm run dev
```

### Health Check Endpoints

```bash
# Service health
curl http://localhost:4001/health

# Detailed status
curl http://localhost:4001/ready

# Metrics
curl http://localhost:4001/metrics
```

### Database Inspection

```bash
# Open Prisma Studio
npx prisma studio

# Check database schema
npx prisma db pull

# View migration status
npx prisma migrate status
```

### Redis Inspection

```bash
# Connect to Redis CLI
redis-cli

# Check Redis info
redis-cli info

# Monitor Redis commands
redis-cli monitor
```

---

## 🆘 Getting Help

### Log Collection

When reporting issues, include:

1. **Service logs**:
   ```bash
   docker logs nexus-auth-service > service.log 2>&1
   ```

2. **Environment info**:
   ```bash
   node --version
   npm --version
   docker --version
   ```

3. **Database status**:
   ```bash
   npx prisma migrate status > db-status.txt
   ```

### Common Log Patterns

#### Authentication Success
```json
{
  "level": "info",
  "message": "User login successful",
  "userId": "clh7x8y9z0a1b2c3d4e5f6g7",
  "email": "user@example.com"
}
```

#### Authentication Failure
```json
{
  "level": "warn",
  "message": "Login attempt failed",
  "email": "user@example.com",
  "reason": "invalid_credentials",
  "ip": "192.168.1.100"
}
```

#### Database Error
```json
{
  "level": "error",
  "message": "Database connection failed",
  "error": "connect ECONNREFUSED 127.0.0.1:5432"
}
```

### Support Channels

1. **Documentation**: Check relevant docs first
2. **GitHub Issues**: Search existing issues
3. **Stack Overflow**: Tag with `nexus-auth`
4. **Discord Community**: Real-time help

---

## 📋 Troubleshooting Checklist

### Before Reporting Issues

- [ ] Check this troubleshooting guide
- [ ] Verify environment variables are set correctly
- [ ] Ensure all required services (PostgreSQL, Redis) are running
- [ ] Check service logs for error messages
- [ ] Try restarting the service
- [ ] Verify network connectivity and firewall settings
- [ ] Test with a minimal configuration
- [ ] Check if the issue is reproducible

### Information to Include

- [ ] Exact error message and stack trace
- [ ] Steps to reproduce the issue
- [ ] Environment details (OS, Node.js version, etc.)
- [ ] Configuration (sanitized, no secrets)
- [ ] Service logs (relevant portions)
- [ ] Expected vs actual behavior

---

For more specific help, see:
- [Installation Guide](./installation.md)
- [Environment Configuration](./environment.md)
- [Frontend Integration](./frontend-integration.md)
- [Docker Deployment](./docker-deployment.md)
