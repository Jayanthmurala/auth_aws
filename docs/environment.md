# Environment Configuration

## 🔧 Complete Environment Variables Reference

This guide covers all environment variables used by the Nexus Auth Service, including required settings, optional configurations, and production considerations.

---

## 📋 Environment Files

### Development
- `.env` - Local development configuration
- `.env.example` - Template with example values
- `.env.template` - Minimal template for quick setup

### Production
- Environment variables should be managed through:
  - AWS Secrets Manager
  - Azure Key Vault
  - Kubernetes Secrets
  - Docker Swarm Secrets

---

## 🔐 Required Variables

### Database Configuration

#### `DATABASE_URL` (Required)
PostgreSQL connection string.

```bash
# Local PostgreSQL
DATABASE_URL="postgresql://username:password@localhost:5432/nexus_auth?schema=authsvc"

# Neon Cloud (Recommended)
DATABASE_URL="postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require&schema=authsvc"

# AWS RDS
DATABASE_URL="postgresql://user:pass@nexus-db.cluster-xyz.us-east-1.rds.amazonaws.com:5432/nexus_auth"
```

**Format**: `postgresql://[user[:password]@][host][:port][/dbname][?param1=value1&...]`

### JWT Configuration

#### `AUTH_JWT_PRIVATE_KEY` (Required)
RSA private key for JWT signing (RS256 algorithm).

```bash
AUTH_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
-----END PRIVATE KEY-----"
```

**Generation**:
```bash
# Generate RSA key pair
openssl genpkey -algorithm RSA -out private.pem -pkcs8 -aes256
openssl rsa -pubout -in private.pem -out public.pem
```

#### `AUTH_JWT_PUBLIC_KEY` (Required)
RSA public key for JWT verification.

```bash
AUTH_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqzeWSrli...
-----END PUBLIC KEY-----"
```

### Security Secrets

#### `INTERNAL_API_KEY` (Required)
32+ character secret for internal service authentication.

```bash
INTERNAL_API_KEY="your-secure-32-character-api-key-here"
```

#### `INTERNAL_API_SECRET` (Required)
64+ character secret for HMAC request signing.

```bash
INTERNAL_API_SECRET="your-secure-64-character-hmac-secret-for-internal-requests"
```

#### `CSRF_SECRET` (Required)
32+ character secret for CSRF token generation.

```bash
CSRF_SECRET="your-secure-32-character-csrf-secret"
```

#### `EXPORT_ENCRYPTION_KEY` (Required)
32+ character key for encrypting exported data.

```bash
EXPORT_ENCRYPTION_KEY="your-secure-32-character-export-key"
```

---

## ⚙️ Application Settings

### Basic Configuration

#### `NODE_ENV`
Application environment mode.

```bash
NODE_ENV=development  # development | production | test
```

**Default**: `development`

#### `PORT`
Port number for the HTTP server.

```bash
PORT=4001
```

**Default**: `4001`

### Frontend Integration

#### `FRONTEND_URL`
Primary frontend URL for email links and redirects.

```bash
FRONTEND_URL="https://app.nexus.edu"
```

**Default**: `http://localhost:3000`

#### `FRONTEND_URLS`
Comma-separated list of allowed CORS origins.

```bash
FRONTEND_URLS="http://localhost:3000,http://127.0.0.1:3000,https://app.nexus.edu,https://admin.nexus.edu"
```

**Default**: `http://localhost:3000,http://127.0.0.1:3000`

---

## 🔑 JWT Token Configuration

### Token Settings

#### `AUTH_JWT_KID`
Key ID for JWT header.

```bash
AUTH_JWT_KID="auth-key-1"
```

**Default**: `auth-key-1`

#### `AUTH_JWT_ISSUER`
JWT issuer claim.

```bash
AUTH_JWT_ISSUER="nexus-auth"
```

**Default**: `nexus-auth`

#### `AUTH_JWT_AUDIENCE`
JWT audience claim.

```bash
AUTH_JWT_AUDIENCE="nexus"
```

**Default**: `nexus`

### Token Expiration

#### `AUTH_JWT_ACCESS_EXPIRES_IN`
Access token expiration time.

```bash
AUTH_JWT_ACCESS_EXPIRES_IN="15m"  # 15 minutes (recommended)
```

**Default**: `15m`  
**Format**: `1s`, `1m`, `1h`, `1d`

#### `AUTH_JWT_REFRESH_EXPIRES_IN`
Refresh token expiration time.

```bash
AUTH_JWT_REFRESH_EXPIRES_IN="30d"  # 30 days
```

**Default**: `30d`

---

## 🍪 Cookie Configuration

#### `COOKIE_DOMAIN`
Domain for authentication cookies.

```bash
COOKIE_DOMAIN=".nexus.edu"  # For subdomain sharing
```

**Default**: `""` (current domain only)

---

## 📊 Redis Configuration

### Basic Redis

#### `REDIS_URL`
Redis connection string.

```bash
# Local Redis
REDIS_URL="redis://localhost:6379"

# Redis Cloud
REDIS_URL="redis://default:password@redis-12345.c1.us-east-1-2.ec2.cloud.redislabs.com:12345"

# Redis with AUTH
REDIS_URL="redis://:password@localhost:6379"
```

#### `REDIS_DISABLED`
Disable Redis for development.

```bash
REDIS_DISABLED=true   # Disable Redis
REDIS_DISABLED=false  # Enable Redis
```

**Default**: `true`

### Redis Cluster (Production)

#### `REDIS_CLUSTER_NODES`
Comma-separated list of Redis cluster nodes.

```bash
REDIS_CLUSTER_NODES="redis-1.cluster.local:6379,redis-2.cluster.local:6379,redis-3.cluster.local:6379"
```

#### `REDIS_PASSWORD`
Password for Redis cluster authentication.

```bash
REDIS_PASSWORD="your-redis-cluster-password"
```

---

## 🚦 Rate Limiting

#### `RATE_LIMIT_MAX`
Maximum requests per time window.

```bash
RATE_LIMIT_MAX=100
```

**Default**: `100`

#### `RATE_LIMIT_WINDOW`
Time window for rate limiting.

```bash
RATE_LIMIT_WINDOW="15 minutes"
```

**Default**: `15 minutes`

---

## 📧 Email Configuration

### SMTP Settings

#### `SMTP_HOST`
SMTP server hostname.

```bash
SMTP_HOST="smtp.gmail.com"
```

#### `SMTP_PORT`
SMTP server port.

```bash
SMTP_PORT=587  # TLS
SMTP_PORT=465  # SSL
SMTP_PORT=25   # Plain (not recommended)
```

**Default**: `587`

#### `SMTP_SECURE`
Use SSL/TLS encryption.

```bash
SMTP_SECURE=true   # Use SSL (port 465)
SMTP_SECURE=false  # Use STARTTLS (port 587)
```

**Default**: `false`

#### `SMTP_USER`
SMTP authentication username.

```bash
SMTP_USER="your-email@gmail.com"
```

#### `SMTP_PASS`
SMTP authentication password.

```bash
SMTP_PASS="your-app-password"
```

### Email Content

#### `APP_NAME`
Application name for emails.

```bash
APP_NAME="Nexus Education Platform"
```

**Default**: `Nexus`

#### `EMAIL_FROM`
From address for outgoing emails.

```bash
EMAIL_FROM="Nexus <no-reply@nexus.edu>"
```

**Default**: `Nexus <no-reply@localhost>`

#### `SUPPORT_EMAIL`
Support email address.

```bash
SUPPORT_EMAIL="support@nexus.edu"
```

**Default**: `support@localhost`

---

## ⏱️ Token Expiration Settings

#### `EMAIL_VERIFICATION_EXPIRES_IN`
Email verification token expiration.

```bash
EMAIL_VERIFICATION_EXPIRES_IN="24h"
```

**Default**: `24h`

#### `PASSWORD_RESET_EXPIRES_IN`
Password reset token expiration.

```bash
PASSWORD_RESET_EXPIRES_IN="1h"
```

**Default**: `1h`

#### `CONFIRMATION_TOKEN_TIMEOUT_MINUTES`
Admin confirmation token timeout.

```bash
CONFIRMATION_TOKEN_TIMEOUT_MINUTES="10"
```

**Default**: `10`

#### `MFA_CHALLENGE_TIMEOUT_MINUTES`
MFA challenge timeout.

```bash
MFA_CHALLENGE_TIMEOUT_MINUTES="5"
```

**Default**: `5`

---

## 📊 Database Scaling

#### `DATABASE_READ_REPLICAS`
Comma-separated list of read replica URLs.

```bash
DATABASE_READ_REPLICAS="postgresql://user:pass@replica1.example.com/db,postgresql://user:pass@replica2.example.com/db"
```

#### `DB_CONNECTION_LIMIT`
Maximum database connections.

```bash
DB_CONNECTION_LIMIT="100"
```

**Default**: `100`

#### `DB_CONNECTION_TIMEOUT`
Database connection timeout (milliseconds).

```bash
DB_CONNECTION_TIMEOUT="5000"
```

**Default**: `5000`

---

## 🔒 Security Settings

#### `MAX_BULK_OPERATION_SIZE`
Maximum items in bulk operations.

```bash
MAX_BULK_OPERATION_SIZE=1000
```

**Default**: `1000`

---

## 🌍 Production Environment Examples

### AWS Deployment

```bash
# Application
NODE_ENV=production
PORT=4001

# Database (RDS)
DATABASE_URL="postgresql://nexus:${DB_PASSWORD}@nexus-prod.cluster-xyz.us-east-1.rds.amazonaws.com:5432/nexus_auth"

# Redis (ElastiCache)
REDIS_URL="redis://nexus-prod.abc123.cache.amazonaws.com:6379"
REDIS_DISABLED=false

# Frontend
FRONTEND_URL="https://app.nexus.edu"
FRONTEND_URLS="https://app.nexus.edu,https://admin.nexus.edu"

# Email (SES)
SMTP_HOST="email-smtp.us-east-1.amazonaws.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="${SES_USERNAME}"
SMTP_PASS="${SES_PASSWORD}"
EMAIL_FROM="Nexus <no-reply@nexus.edu>"

# Secrets (from AWS Secrets Manager)
AUTH_JWT_PRIVATE_KEY="${JWT_PRIVATE_KEY}"
AUTH_JWT_PUBLIC_KEY="${JWT_PUBLIC_KEY}"
INTERNAL_API_KEY="${INTERNAL_API_KEY}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET}"
CSRF_SECRET="${CSRF_SECRET}"
EXPORT_ENCRYPTION_KEY="${EXPORT_ENCRYPTION_KEY}"
```

### Docker Compose

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  auth-service:
    image: nexus-auth:latest
    environment:
      - NODE_ENV=production
      - PORT=4001
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - FRONTEND_URLS=${FRONTEND_URLS}
    secrets:
      - jwt_private_key
      - jwt_public_key
      - internal_api_key
      - csrf_secret

secrets:
  jwt_private_key:
    external: true
  jwt_public_key:
    external: true
  internal_api_key:
    external: true
  csrf_secret:
    external: true
```

### Kubernetes

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-service-config
data:
  NODE_ENV: "production"
  PORT: "4001"
  FRONTEND_URLS: "https://app.nexus.edu,https://admin.nexus.edu"
  REDIS_DISABLED: "false"

---
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-service-secrets
type: Opaque
data:
  DATABASE_URL: <base64-encoded-url>
  JWT_PRIVATE_KEY: <base64-encoded-key>
  JWT_PUBLIC_KEY: <base64-encoded-key>
  INTERNAL_API_KEY: <base64-encoded-key>
```

---

## ✅ Environment Validation

The service validates all environment variables on startup:

### Required Variable Checks
- Ensures all required variables are present
- Validates minimum length for secrets (32+ characters)
- Checks proper formatting for keys and URLs

### Production Checks
- Prevents insecure fallback values in production
- Validates proper base64 encoding for secrets
- Ensures strong entropy for security keys

### Startup Errors
```bash
# Missing required variable
Error: Missing env var DATABASE_URL

# Weak secret in production
Error: INTERNAL_API_KEY must be at least 32 characters

# Insecure fallback value
Error: CSRF_SECRET contains insecure fallback value in production
```

---

## 🔧 Environment Generation Scripts

### Generate Secure Keys

```bash
# Windows
.\generate-env.bat

# macOS/Linux
./generate-env.sh
```

This creates `generated_keys.env` with:
- RSA key pair for JWT signing
- Secure random secrets
- Proper formatting for environment variables

### Validate Environment

```bash
npm run validate-env
```

Checks all environment variables and reports issues.

---

## 📚 Best Practices

### Development
1. Use `.env` for local configuration
2. Never commit secrets to version control
3. Use `REDIS_DISABLED=true` for simple development
4. Generate new JWT keys for each environment

### Production
1. Use external secret management (AWS Secrets Manager, etc.)
2. Rotate secrets regularly
3. Use strong, unique secrets for each environment
4. Enable Redis for session management
5. Configure proper CORS origins
6. Use HTTPS for all frontend URLs

### Security
1. Use minimum 32-character secrets
2. Generate cryptographically secure random values
3. Rotate JWT keys periodically
4. Monitor for suspicious activity
5. Use environment-specific database credentials

---

## 🆘 Troubleshooting

### Common Issues

#### Invalid JWT Keys
```bash
# Regenerate keys
./generate-env.sh
# Copy keys to .env file
```

#### Database Connection
```bash
# Test connection
npx prisma db pull
```

#### Redis Connection
```bash
# Test Redis
redis-cli -u $REDIS_URL ping
```

#### CORS Issues
```bash
# Check FRONTEND_URLS includes your domain
FRONTEND_URLS="http://localhost:3000,https://yourdomain.com"
```

For more troubleshooting help, see [Troubleshooting Guide](./troubleshooting.md).
