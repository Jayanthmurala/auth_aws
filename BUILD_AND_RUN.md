# 🚀 Build and Run Guide - Nexus Auth Service

This guide provides exact commands to build, run, and verify the Nexus Auth Service Docker container.

## Prerequisites

- Docker Desktop installed and running
- `.env` file with valid configuration (copy from `.env.local` or `.env.example`)
- Node.js 18+ (for local development)

## Quick Start (TL;DR)

```bash
# Build the image
docker build -t nexus-auth:latest .

# Run the container
docker run --rm -p 4001:4001 --env-file .env --name nexus-auth-local nexus-auth:latest

# Test health endpoint
curl http://localhost:4001/health
```

## Detailed Instructions

### 1. Environment Setup

```bash
# Ensure you have a valid .env file
# Copy from .env.local (recommended) or .env.example
cp .env.local .env

# Verify critical environment variables are set
grep -E "DATABASE_URL|REDIS_URL|PORT" .env
```

### 2. Build Docker Image

```bash
# Build with latest tag
docker build -t nexus-auth:latest .

# Build with version tag (optional)
docker build -t nexus-auth:v0.1.0 .

# Build with no cache (if you had issues)
docker build --no-cache -t nexus-auth:latest .

# Verify image was created
docker images | grep nexus-auth
```

### 3. Run Container Locally

```bash
# Run in foreground (logs visible)
docker run --rm -p 4001:4001 --env-file .env --name nexus-auth-local nexus-auth:latest

# Run in background (detached)
docker run -d -p 4001:4001 --env-file .env --name nexus-auth-local nexus-auth:latest

# Run with custom port mapping
docker run --rm -p 8080:4001 --env-file .env --name nexus-auth-local nexus-auth:latest
```

### 4. Verify Container Health

```bash
# Check if container is running
docker ps | grep nexus-auth

# Test health endpoint
curl http://localhost:4001/health
# Expected response: {"status":"healthy","timestamp":"..."}

# Test API endpoints
curl http://localhost:4001/api/v1/auth/me
curl http://localhost:4001/ready
curl http://localhost:4001/metrics
```

### 5. View Logs and Debug

```bash
# View container logs
docker logs nexus-auth-local

# Follow logs in real-time
docker logs -f nexus-auth-local

# View last 50 lines
docker logs --tail 50 nexus-auth-local

# Get container stats
docker stats nexus-auth-local
```

### 6. Shell into Container (Debugging)

```bash
# Open shell in running container
docker exec -it nexus-auth-local sh

# Run a new container with shell (if main container won't start)
docker run -it --rm --entrypoint sh nexus-auth:latest

# Inside container - verify files exist
ls -la /app/dist/
node --version
npm --version
```

### 7. Container Inspection Commands

```bash
# Inspect container configuration
docker inspect nexus-auth-local

# Check container processes
docker exec nexus-auth-local ps aux

# Check disk usage
docker exec nexus-auth-local df -h

# Check memory usage
docker exec nexus-auth-local free -h

# List files in dist directory
docker exec nexus-auth-local ls -la /app/dist/
```

### 8. Stop and Clean Up

```bash
# Stop running container
docker stop nexus-auth-local

# Remove container
docker rm nexus-auth-local

# Stop and remove in one command
docker rm -f nexus-auth-local

# Remove image
docker rmi nexus-auth:latest

# Clean up all unused containers, networks, images
docker system prune -f
```

## Using Docker Compose (Alternative)

```bash
# Run with cloud services
docker-compose up auth-service

# Run with local Redis
docker-compose --profile local-redis up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f auth-service

# Stop and clean up
docker-compose down
```

## Troubleshooting

### Container Exits Immediately

```bash
# Check exit code and logs
docker logs nexus-auth-local

# Common issues:
# 1. Missing environment variables
# 2. Database connection failed
# 3. Redis connection failed
# 4. Port already in use
```

### Health Check Fails

```bash
# Test manually inside container
docker exec nexus-auth-local curl -f http://localhost:4001/health

# Check if process is running
docker exec nexus-auth-local ps aux | grep node

# Check port binding
docker port nexus-auth-local
```

### Build Fails

```bash
# Build with verbose output
docker build --progress=plain -t nexus-auth:latest .

# Check if required files exist after build
docker run --rm nexus-auth:latest ls -la /app/dist/

# Common build issues:
# 1. TypeScript compilation errors
# 2. Missing Prisma client generation
# 3. Native module build failures
```

### Import/Module Errors

```bash
# Check if ESM imports are fixed
docker run --rm nexus-auth:latest node -e "console.log('Testing imports...')"

# Manually run the import fixer
docker run --rm -v $(pwd):/src node:20-alpine sh -c "cd /src && node scripts/fix-esm-imports.js"
```

## Production Deployment

### Push to Registry

```bash
# Tag for registry (replace with your registry)
docker tag nexus-auth:latest your-registry.com/nexus-auth:latest

# Push to registry
docker push your-registry.com/nexus-auth:latest
```

### AWS ECR Example

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Tag for ECR
docker tag nexus-auth:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/nexus-auth:latest

# Push to ECR
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/nexus-auth:latest
```

## Verification Checklist

- [ ] Container builds successfully without errors
- [ ] Container starts and stays running (check with `docker ps`)
- [ ] Health endpoint returns 200 OK: `curl http://localhost:4001/health`
- [ ] Main API endpoints are accessible
- [ ] No error messages in container logs
- [ ] Container uses non-root user (nexus)
- [ ] Environment variables are properly loaded
- [ ] Database and Redis connections work
- [ ] Container can be stopped gracefully

## Performance Notes

- **Memory Usage**: Container should use ~200-500MB RAM at startup
- **CPU Usage**: Should be <10% CPU when idle
- **Startup Time**: Should be ready within 30-60 seconds
- **Image Size**: Final image should be ~200-300MB

## Security Notes

- Container runs as non-root user (`nexus`)
- No secrets are baked into the image
- Uses `dumb-init` for proper signal handling
- Only necessary ports are exposed
- Uses official Node.js Alpine base image with security updates
