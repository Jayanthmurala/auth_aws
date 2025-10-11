# Docker Deployment Guide

## 🐳 Production Docker Deployment

This guide covers deploying the Nexus Auth Service using Docker in production environments, including best practices, security considerations, and scaling strategies.

---

## 🏗️ Docker Architecture

### Multi-Stage Build

The Dockerfile uses a multi-stage build for optimal production images:

```dockerfile
# Stage 1: Builder - Install dependencies and build
FROM node:20-alpine AS builder
# ... build steps ...

# Stage 2: Production - Minimal runtime image
FROM node:20-alpine AS production
# ... runtime setup ...
```

**Benefits**:
- Smaller production image (~200-300MB)
- No build dependencies in final image
- Better security (no dev tools)
- Faster deployment and scaling

---

## 🚀 Quick Deployment

### 1. Build Production Image

```bash
# Build the Docker image
docker build -t nexus-auth:latest .

# Build with version tag
docker build -t nexus-auth:v0.1.0 .

# Build with no cache (if needed)
docker build --no-cache -t nexus-auth:latest .
```

### 2. Run Single Container

```bash
# Run with environment file
docker run -d \
  --name nexus-auth-prod \
  -p 4001:4001 \
  --env-file .env.production \
  --restart unless-stopped \
  nexus-auth:latest

# Run with inline environment variables
docker run -d \
  --name nexus-auth-prod \
  -p 4001:4001 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://..." \
  -e REDIS_URL="redis://..." \
  --restart unless-stopped \
  nexus-auth:latest
```

### 3. Verify Deployment

```bash
# Check container status
docker ps | grep nexus-auth

# Check logs
docker logs nexus-auth-prod

# Test health endpoint
curl http://localhost:4001/health
```

---

## 🔧 Docker Compose Production

### Production Compose File

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  auth-service:
    image: nexus-auth:latest
    container_name: nexus-auth-prod
    restart: unless-stopped
    ports:
      - "4001:4001"
    environment:
      - NODE_ENV=production
      - PORT=4001
    env_file:
      - .env.production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - nexus-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7-alpine
    container_name: nexus-redis-prod
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: >
      redis-server 
      --appendonly yes 
      --maxmemory 512mb 
      --maxmemory-policy allkeys-lru
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - nexus-network

  nginx:
    image: nginx:alpine
    container_name: nexus-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - auth-service
    networks:
      - nexus-network

networks:
  nexus-network:
    driver: bridge
    name: nexus-network

volumes:
  redis_data:
    driver: local
    name: nexus_redis_data
```

### Nginx Configuration

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream auth_service {
        server auth-service:4001;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;

    server {
        listen 80;
        server_name api.nexus.edu;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name api.nexus.edu;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

        # Auth endpoints (stricter rate limiting)
        location ~ ^/api/v1/auth/(login|register|forgot-password) {
            limit_req zone=auth burst=5 nodelay;
            proxy_pass http://auth_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # General API endpoints
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://auth_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health checks (no rate limiting)
        location ~ ^/(health|ready|metrics) {
            proxy_pass http://auth_service;
            access_log off;
        }
    }
}
```

### Deploy with Compose

```bash
# Deploy production stack
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Scale auth service
docker-compose -f docker-compose.prod.yml up -d --scale auth-service=3

# Stop and remove
docker-compose -f docker-compose.prod.yml down
```

---

## ☸️ Kubernetes Deployment

### Namespace and ConfigMap

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: nexus-auth

---
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-service-config
  namespace: nexus-auth
data:
  NODE_ENV: "production"
  PORT: "4001"
  FRONTEND_URLS: "https://app.nexus.edu,https://admin.nexus.edu"
  REDIS_DISABLED: "false"
  RATE_LIMIT_MAX: "100"
  RATE_LIMIT_WINDOW: "15 minutes"
```

### Secrets

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-service-secrets
  namespace: nexus-auth
type: Opaque
data:
  DATABASE_URL: <base64-encoded-database-url>
  REDIS_URL: <base64-encoded-redis-url>
  JWT_PRIVATE_KEY: <base64-encoded-private-key>
  JWT_PUBLIC_KEY: <base64-encoded-public-key>
  INTERNAL_API_KEY: <base64-encoded-api-key>
  INTERNAL_API_SECRET: <base64-encoded-api-secret>
  CSRF_SECRET: <base64-encoded-csrf-secret>
  EXPORT_ENCRYPTION_KEY: <base64-encoded-export-key>
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  namespace: nexus-auth
  labels:
    app: auth-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: auth-service
  template:
    metadata:
      labels:
        app: auth-service
    spec:
      containers:
      - name: auth-service
        image: nexus-auth:latest
        ports:
        - containerPort: 4001
        envFrom:
        - configMapRef:
            name: auth-service-config
        - secretRef:
            name: auth-service-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 4001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 4001
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
```

### Service and Ingress

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  namespace: nexus-auth
spec:
  selector:
    app: auth-service
  ports:
  - port: 4001
    targetPort: 4001
  type: ClusterIP

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: auth-service-ingress
  namespace: nexus-auth
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
spec:
  tls:
  - hosts:
    - api.nexus.edu
    secretName: auth-service-tls
  rules:
  - host: api.nexus.edu
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: auth-service
            port:
              number: 4001
```

### Deploy to Kubernetes

```bash
# Apply all manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -n nexus-auth

# View logs
kubectl logs -f deployment/auth-service -n nexus-auth

# Scale deployment
kubectl scale deployment auth-service --replicas=5 -n nexus-auth
```

---

## 🏗️ AWS ECS Deployment

### Task Definition

```json
{
  "family": "nexus-auth-service",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/nexus-auth-task-role",
  "containerDefinitions": [
    {
      "name": "auth-service",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/nexus-auth:latest",
      "portMappings": [
        {
          "containerPort": 4001,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "4001"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:nexus/database-url"
        },
        {
          "name": "JWT_PRIVATE_KEY",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:nexus/jwt-private-key"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -f http://localhost:4001/health || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/nexus-auth-service",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### ECS Service

```json
{
  "serviceName": "nexus-auth-service",
  "cluster": "nexus-cluster",
  "taskDefinition": "nexus-auth-service:1",
  "desiredCount": 3,
  "launchType": "FARGATE",
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": [
        "subnet-12345678",
        "subnet-87654321"
      ],
      "securityGroups": [
        "sg-auth-service"
      ],
      "assignPublicIp": "DISABLED"
    }
  },
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:REGION:ACCOUNT:targetgroup/nexus-auth/1234567890123456",
      "containerName": "auth-service",
      "containerPort": 4001
    }
  ],
  "serviceRegistries": [
    {
      "registryArn": "arn:aws:servicediscovery:REGION:ACCOUNT:service/srv-auth"
    }
  ]
}
```

---

## 🔒 Security Best Practices

### Container Security

1. **Non-root User**:
   ```dockerfile
   # Create and use non-root user
   RUN addgroup -g 1001 -S nodejs && \
       adduser -S nexus -u 1001 -G nodejs
   USER nexus
   ```

2. **Read-only Root Filesystem**:
   ```yaml
   # Kubernetes
   securityContext:
     readOnlyRootFilesystem: true
   ```

3. **No Privileged Containers**:
   ```yaml
   securityContext:
     allowPrivilegeEscalation: false
     runAsNonRoot: true
   ```

### Secrets Management

1. **External Secret Stores**:
   ```bash
   # AWS Secrets Manager
   aws secretsmanager get-secret-value --secret-id nexus/database-url
   
   # Azure Key Vault
   az keyvault secret show --vault-name nexus-vault --name database-url
   
   # HashiCorp Vault
   vault kv get secret/nexus/database-url
   ```

2. **Environment Variable Injection**:
   ```yaml
   # Kubernetes with External Secrets Operator
   apiVersion: external-secrets.io/v1beta1
   kind: SecretStore
   metadata:
     name: aws-secrets-manager
   spec:
     provider:
       aws:
         service: SecretsManager
         region: us-east-1
   ```

### Network Security

1. **Private Networks**:
   ```yaml
   # Docker Compose
   networks:
     nexus-network:
       driver: bridge
       internal: true  # No external access
   ```

2. **Firewall Rules**:
   ```bash
   # Only allow necessary ports
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw deny 4001/tcp  # Block direct access to app
   ```

---

## 📊 Monitoring and Logging

### Health Checks

```yaml
# Docker Compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:4001/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

### Logging Configuration

```yaml
# Centralized logging
logging:
  driver: "fluentd"
  options:
    fluentd-address: "fluentd.logging.svc.cluster.local:24224"
    tag: "nexus.auth.{{.ID}}"
```

### Metrics Collection

```yaml
# Prometheus monitoring
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "4001"
  prometheus.io/path: "/metrics"
```

---

## 🚀 Scaling Strategies

### Horizontal Scaling

1. **Load Balancer Configuration**:
   ```nginx
   upstream auth_service {
       least_conn;
       server auth-service-1:4001 max_fails=3 fail_timeout=30s;
       server auth-service-2:4001 max_fails=3 fail_timeout=30s;
       server auth-service-3:4001 max_fails=3 fail_timeout=30s;
   }
   ```

2. **Auto-scaling (Kubernetes)**:
   ```yaml
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: auth-service-hpa
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: auth-service
     minReplicas: 3
     maxReplicas: 10
     metrics:
     - type: Resource
       resource:
         name: cpu
         target:
           type: Utilization
           averageUtilization: 70
     - type: Resource
       resource:
         name: memory
         target:
           type: Utilization
           averageUtilization: 80
   ```

### Database Scaling

```yaml
# Read replicas configuration
environment:
  - DATABASE_URL=postgresql://primary.db.nexus.edu/nexus_auth
  - DATABASE_READ_REPLICAS=postgresql://replica1.db.nexus.edu/nexus_auth,postgresql://replica2.db.nexus.edu/nexus_auth
```

### Redis Clustering

```yaml
# Redis Cluster
environment:
  - REDIS_CLUSTER_NODES=redis-1.cluster.local:6379,redis-2.cluster.local:6379,redis-3.cluster.local:6379
  - REDIS_PASSWORD=cluster-password
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v1
    
    - name: Build and push Docker image
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: nexus-auth
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
        docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
    
    - name: Deploy to ECS
      run: |
        aws ecs update-service \
          --cluster nexus-cluster \
          --service nexus-auth-service \
          --force-new-deployment
```

---

## 📋 Deployment Checklist

### Pre-deployment

- [ ] Environment variables configured
- [ ] Secrets stored securely
- [ ] Database migrations applied
- [ ] SSL certificates configured
- [ ] Monitoring and logging set up
- [ ] Health checks configured
- [ ] Backup strategy in place

### Post-deployment

- [ ] Health endpoints responding
- [ ] Authentication flow working
- [ ] Database connectivity verified
- [ ] Redis connectivity verified
- [ ] Email functionality tested
- [ ] Performance metrics within acceptable range
- [ ] Security scan passed
- [ ] Load testing completed

### Rollback Plan

- [ ] Previous image tagged and available
- [ ] Database rollback scripts ready
- [ ] Monitoring alerts configured
- [ ] Rollback procedure documented
- [ ] Team notified of deployment

---

For more information, see:
- [Installation Guide](./installation.md)
- [Environment Configuration](./environment.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Security Guide](./security.md)
