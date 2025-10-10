# 🐳 Nexus Auth Service - Docker Deployment Guide

## 📋 Prerequisites

- Docker installed and running
- Production environment variables configured
- Access to cloud-hosted PostgreSQL (Neon) and Redis

## 🚀 Quick Start

### 1. Generate Production Environment File

**Windows:**
```bash
generate-env.bat
```

**Linux/macOS:**
```bash
chmod +x generate-env.sh
./generate-env.sh
```

### 2. Configure Production Environment

Edit the generated `.env` file with your production values:

```env
# Critical Production Settings
NODE_ENV=production
PORT=4001

# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://username:password@host:5432/database?sslmode=require&schema=authsvc"

# Redis (Redis Cloud)
REDIS_URL="redis://default:password@host:port/0"
REDIS_DISABLED=false

# JWT Keys (Generate new ones for production)
AUTH_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
AUTH_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"

# Frontend URLs (Add your production domains)
FRONTEND_URLS="https://yourdomain.com,https://www.yourdomain.com"

# SMTP (Production email service)
SMTP_HOST="smtp.gmail.com"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"

# Security Keys (Generate strong 32+ character keys)
INTERNAL_API_KEY="your-32-char-internal-api-key-here"
INTERNAL_API_SECRET="your-64-char-internal-api-secret-here"
CSRF_SECRET="your-32-char-csrf-secret-here"
EXPORT_ENCRYPTION_KEY="your-32-char-export-encryption-key"
```

### 3. Build Docker Image

```bash
# Build the production image
docker build -t nexus-auth-service:latest .

# Build with specific tag
docker build -t nexus-auth-service:v0.1.0 .
```

### 4. Run Container

```bash
# Run with environment file
docker run -d \
  --name nexus-auth \
  --env-file .env \
  -p 4001:4001 \
  --restart unless-stopped \
  nexus-auth-service:latest

# Run with custom environment variables
docker run -d \
  --name nexus-auth \
  -e NODE_ENV=production \
  -e DATABASE_URL="your-database-url" \
  -e REDIS_URL="your-redis-url" \
  -p 4001:4001 \
  --restart unless-stopped \
  nexus-auth-service:latest
```

## 🔍 Health Checks & Monitoring

### Health Check Endpoints

The container includes built-in health checks:

- **Basic Health**: `GET /health`
- **Detailed Health**: `GET /health/detailed`
- **Readiness**: `GET /ready` (Kubernetes)
- **Liveness**: `GET /live` (Kubernetes)
- **Metrics**: `GET /metrics` (Prometheus)

### Verify Container Health

```bash
# Check container status
docker ps

# View container logs
docker logs nexus-auth

# Check health endpoint
curl http://localhost:4001/health

# Check detailed health
curl http://localhost:4001/health/detailed
```

## 🏗️ Production Deployment

### Docker Compose (Optional)

If you need orchestration, create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  auth-service:
    build: .
    container_name: nexus-auth
    ports:
      - "4001:4001"
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:4001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nexus-auth-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nexus-auth
  template:
    metadata:
      labels:
        app: nexus-auth
    spec:
      containers:
      - name: auth-service
        image: nexus-auth-service:latest
        ports:
        - containerPort: 4001
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: nexus-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: nexus-secrets
              key: redis-url
        livenessProbe:
          httpGet:
            path: /live
            port: 4001
          initialDelaySeconds: 40
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 4001
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          limits:
            memory: "512Mi"
            cpu: "500m"
          requests:
            memory: "256Mi"
            cpu: "250m"
```

## 🔧 Advanced Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment mode | Yes | `production` |
| `PORT` | Service port | No | `4001` |
| `DATABASE_URL` | PostgreSQL connection | Yes | - |
| `REDIS_URL` | Redis connection | Yes | - |
| `REDIS_DISABLED` | Disable Redis | No | `false` |
| `RATE_LIMIT_MAX` | Rate limit per window | No | `1000` |
| `RATE_LIMIT_WINDOW` | Rate limit window | No | `15 minutes` |

### Performance Tuning

For 10M+ users, consider these optimizations:

```bash
# Run with increased memory and CPU limits
docker run -d \
  --name nexus-auth \
  --env-file .env \
  -p 4001:4001 \
  --memory=1g \
  --cpus=1.0 \
  --restart unless-stopped \
  nexus-auth-service:latest
```

### Scaling

```bash
# Run multiple instances with load balancer
docker run -d --name nexus-auth-1 -p 4001:4001 --env-file .env nexus-auth-service:latest
docker run -d --name nexus-auth-2 -p 4002:4001 --env-file .env nexus-auth-service:latest
docker run -d --name nexus-auth-3 -p 4003:4001 --env-file .env nexus-auth-service:latest
```

## 🛠️ Troubleshooting

### Common Issues

1. **Container won't start**
   ```bash
   docker logs nexus-auth
   ```

2. **Database connection failed**
   - Check `DATABASE_URL` format
   - Ensure database is accessible from container
   - Verify SSL settings

3. **Redis connection failed**
   - Check `REDIS_URL` format
   - Verify Redis Cloud accessibility
   - Check firewall rules

4. **Health check failing**
   ```bash
   # Test health endpoint manually
   docker exec nexus-auth curl http://localhost:4001/health
   ```

### Performance Monitoring

```bash
# Monitor container resources
docker stats nexus-auth

# View detailed metrics
curl http://localhost:4001/metrics
```

## 🔐 Security Considerations

1. **Use non-root user** ✅ (Implemented)
2. **Minimal base image** ✅ (Alpine Linux)
3. **Security updates** ✅ (Applied during build)
4. **Secret management** - Use Docker secrets or Kubernetes secrets
5. **Network security** - Use Docker networks or Kubernetes network policies

## 📊 Production Checklist

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates configured
- [ ] Load balancer configured
- [ ] Monitoring setup (Prometheus/Grafana)
- [ ] Log aggregation setup
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan
- [ ] Security scan completed

## 🚀 Deployment Commands Summary

```bash
# 1. Generate environment
./generate-env.sh  # or generate-env.bat on Windows

# 2. Build image
docker build -t nexus-auth-service:latest .

# 3. Run container
docker run -d --name nexus-auth --env-file .env -p 4001:4001 nexus-auth-service:latest

# 4. Verify deployment
curl http://localhost:4001/health
```

---

**🎉 Your Nexus Auth Service is now ready for production deployment!**

For support, contact the Nexus Development Team.
