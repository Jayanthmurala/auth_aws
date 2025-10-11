# Installation Guide

## 🚀 Quick Start

Get the Nexus Auth Service running locally in under 10 minutes.

## 📋 Prerequisites

### Required Software
- **Node.js**: 20.x LTS or higher
- **npm**: 10.x or higher (comes with Node.js)
- **Docker**: 24.x or higher (for containerized setup)
- **Git**: Latest version

### Required Services
- **PostgreSQL**: 15+ (or use Neon Cloud)
- **Redis**: 7+ (or use Redis Cloud)
- **SMTP Server**: For email functionality (optional for development)

---

## 🛠️ Local Development Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd nexus-auth-service
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Copy the environment template:

```bash
# Windows
copy .env.example .env

# macOS/Linux
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/nexus_auth?schema=authsvc"

# Redis Configuration (optional for development)
REDIS_URL="redis://localhost:6379"
REDIS_DISABLED=true  # Set to false when Redis is available

# JWT Configuration (generate new keys for production)
AUTH_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
AUTH_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"

# Application Settings
PORT=4001
NODE_ENV=development
FRONTEND_URLS="http://localhost:3000,http://127.0.0.1:3000"

# Required Secrets (generate secure values)
INTERNAL_API_KEY="your-32-character-internal-api-key"
INTERNAL_API_SECRET="your-64-character-internal-api-secret"
CSRF_SECRET="your-32-character-csrf-secret"
EXPORT_ENCRYPTION_KEY="your-32-character-export-key"
```

### 4. Generate JWT Keys

Generate RSA key pair for JWT signing:

```bash
# Windows
.\generate-env.bat

# macOS/Linux
./generate-env.sh
```

This will create `generated_keys.env` with secure JWT keys. Copy the keys to your `.env` file.

### 5. Database Setup

#### Option A: Local PostgreSQL

Install PostgreSQL locally and create a database:

```sql
CREATE DATABASE nexus_auth;
CREATE USER nexus_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nexus_auth TO nexus_user;
```

#### Option B: Neon Cloud (Recommended)

1. Sign up at [Neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string to `DATABASE_URL` in `.env`

### 6. Run Database Migrations

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed initial data (optional)
npm run seed
```

### 7. Redis Setup (Optional)

#### Option A: Local Redis

```bash
# Install Redis (macOS with Homebrew)
brew install redis
brew services start redis

# Install Redis (Ubuntu/Debian)
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server

# Install Redis (Windows)
# Download from https://redis.io/download
```

#### Option B: Redis Cloud

1. Sign up at [Redis Cloud](https://redis.com/redis-enterprise-cloud/)
2. Create a new database
3. Copy the connection string to `REDIS_URL` in `.env`
4. Set `REDIS_DISABLED=false`

### 8. Start the Development Server

```bash
npm run dev
```

The service will be available at `http://localhost:4001`

---

## 🐳 Docker Development Setup

### 1. Using Docker Compose (Recommended)

```bash
# Start all services (auth service + Redis)
docker-compose up -d

# View logs
docker-compose logs -f auth-service

# Stop services
docker-compose down
```

### 2. Build and Run Manually

```bash
# Build the Docker image
docker build -t nexus-auth:latest .

# Run the container
docker run --rm -p 4001:4001 --env-file .env --name nexus-auth nexus-auth:latest
```

---

## ✅ Verify Installation

### 1. Health Check

```bash
curl http://localhost:4001/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "version": "0.1.0",
  "uptime": 123.456,
  "checks": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

### 2. API Documentation

Visit `http://localhost:4001/docs` to access the Swagger UI.

### 3. Test Registration

```bash
curl -X POST http://localhost:4001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "firstName": "Test",
    "lastName": "User",
    "collegeId": "default-college-id",
    "role": "STUDENT"
  }'
```

---

## 🔧 Development Tools Setup

### 1. VS Code Extensions (Recommended)

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml",
    "ms-vscode-remote.remote-containers",
    "prisma.prisma"
  ]
}
```

### 2. Git Hooks Setup

```bash
# Install husky for git hooks
npm install --save-dev husky
npx husky install

# Add pre-commit hook
npx husky add .husky/pre-commit "npm run lint && npm run test"
```

### 3. Environment Validation

The service validates environment variables on startup. Missing or invalid variables will cause startup to fail with clear error messages.

---

## 🧪 Running Tests

### Unit Tests

```bash
npm run test
```

### Integration Tests

```bash
npm run test:integration
```

### Test Coverage

```bash
npm run test:coverage
```

### Watch Mode (Development)

```bash
npm run test:watch
```

---

## 📊 Database Management

### View Database Schema

```bash
npx prisma studio
```

This opens a web interface at `http://localhost:5555` to browse your database.

### Reset Database

```bash
npx prisma migrate reset
```

### Generate New Migration

```bash
npx prisma migrate dev --name your_migration_name
```

### Deploy Migrations (Production)

```bash
npx prisma migrate deploy
```

---

## 🔍 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port 4001
lsof -i :4001  # macOS/Linux
netstat -ano | findstr :4001  # Windows

# Kill the process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

#### Database Connection Issues
1. Verify PostgreSQL is running
2. Check `DATABASE_URL` format
3. Ensure database exists
4. Verify user permissions

#### Redis Connection Issues
1. Set `REDIS_DISABLED=true` for development
2. Verify Redis is running: `redis-cli ping`
3. Check `REDIS_URL` format

#### JWT Key Issues
1. Regenerate keys: `./generate-env.sh`
2. Ensure keys are properly formatted in `.env`
3. Check for escaped newlines (`\n`)

#### Permission Errors
```bash
# Fix file permissions
chmod +x generate-env.sh
chmod +x scripts/*.sh
```

### Debug Mode

Enable debug logging:

```bash
NODE_ENV=development DEBUG=* npm run dev
```

### Database Debug

Enable Prisma query logging:

```bash
DATABASE_LOGGING=true npm run dev
```

---

## 🚀 Next Steps

1. **Configure Email**: Set up SMTP for email functionality
2. **Set up Frontend**: Configure CORS for your frontend application
3. **Add Test Data**: Use seeding scripts to add sample data
4. **Configure Monitoring**: Set up health checks and metrics
5. **Security Review**: Review security settings for your environment

---

## 📚 Additional Resources

- [Environment Configuration](./environment.md)
- [API Documentation](./api-overview.md)
- [Frontend Integration](./frontend-integration.md)
- [Docker Deployment](./docker-deployment.md)
- [Troubleshooting Guide](./troubleshooting.md)

---

## 🆘 Getting Help

If you encounter issues:

1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Review the logs: `docker-compose logs -f auth-service`
3. Verify your environment configuration
4. Check the [GitHub Issues](https://github.com/your-repo/issues)

**Need immediate help?** Check our [Discord community](https://discord.gg/your-server) or [Stack Overflow](https://stackoverflow.com/questions/tagged/nexus-auth).
