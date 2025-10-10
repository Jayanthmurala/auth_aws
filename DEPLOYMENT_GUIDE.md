# 🚀 Nexus Auth Service - Complete Docker Deployment Guide

**For Beginners: Step-by-Step Instructions**

This guide will help you containerize and deploy your Nexus Auth Service to production, even if you've never used Docker or AWS before.

## 📋 Prerequisites & Installation

### Step 1: Install Required Tools

**Windows:**
```powershell
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop/

# Install AWS CLI
# Download from: https://aws.amazon.com/cli/
# Or use: winget install Amazon.AWSCLI

# Install Git (if not already installed)
# Download from: https://git-scm.com/download/win
```

**macOS:**
```bash
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop/

# Install AWS CLI using Homebrew
brew install awscli

# Install jq (JSON processor - optional but helpful)
brew install jq
```

**Linux (Ubuntu/Debian):**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect

# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Install jq
sudo apt-get update && sudo apt-get install -y jq curl
```

### Step 2: Verify Installations

**Command:** Test all tools are working
```bash
docker --version
aws --version
git --version
```

**Expected Output:**
```
Docker version 24.0.x, build xxx
aws-cli/2.x.x Python/3.x.x
git version 2.x.x
```

## 🔧 Local Development Setup

### Step 3: Prepare Environment Variables

**⚠️ SECURITY WARNING:** Never commit `.env` files to git. Always use `.env.local` as your source.

**Command:** Generate `.env` from `.env.local` (preserving newlines)
```bash
# Navigate to auth-service directory
cd /path/to/nexusbackend/auth-service

# Copy .env.local to .env (this preserves multiline JWT keys)
cp .env.local .env

# Update NODE_ENV for container use
sed -i 's/NODE_ENV=development/NODE_ENV=production/' .env

# Verify the file was created correctly
head -10 .env
```

**Windows PowerShell:**
```powershell
# Navigate to auth-service directory
cd C:\path\to\nexusbackend\auth-service

# Copy .env.local to .env
Copy-Item .env.local .env

# Update NODE_ENV
(Get-Content .env) -replace 'NODE_ENV=development', 'NODE_ENV=production' | Set-Content .env
```

### Step 4: Build Docker Image Locally

**Command:** Build the production image
```bash
# Build the image (this will take 3-5 minutes first time)
docker build -t nexus-auth-service:latest .

# Verify the image was created
docker images | grep nexus-auth
```

**Expected Output:**
```
nexus-auth-service   latest    abc123def456   2 minutes ago   150MB
```

### Step 5: Run Container Locally

**Command:** Start the container with your environment
```bash
# Run the container with your .env file
docker run -d \
  --name nexus-auth-local \
  --env-file .env \
  -p 4001:4001 \
  nexus-auth-service:latest

# Check if container is running
docker ps
```

**Expected Output:**
```
CONTAINER ID   IMAGE                    COMMAND                  STATUS
abc123def456   nexus-auth-service:latest   "dumb-init -- node …"   Up 30 seconds
```

### Step 6: Test the Service

**Command:** Test health endpoints
```bash
# Test basic health check
curl http://localhost:4001/health

# Test detailed health check
curl http://localhost:4001/health/detailed

# Test readiness probe
curl http://localhost:4001/ready
```

**Expected Output:**
```json
{"status":"healthy","timestamp":"2024-01-10T12:00:00.000Z"}
```

### Step 7: Monitor and Debug

**Command:** View container logs
```bash
# View real-time logs
docker logs -f nexus-auth-local

# View last 50 lines
docker logs --tail 50 nexus-auth-local

# Execute commands inside container (for debugging)
docker exec -it nexus-auth-local sh
```

**Command:** Stop and clean up
```bash
# Stop the container
docker stop nexus-auth-local

# Remove the container
docker rm nexus-auth-local

# Remove the image (if needed)
docker rmi nexus-auth-service:latest
```

## 📤 Push to Container Registries

### Option A: Docker Hub (Simple)

**Command:** Login and push to Docker Hub
```bash
# Login to Docker Hub
docker login

# Tag your image for Docker Hub
docker tag nexus-auth-service:latest yourusername/nexus-auth-service:latest

# Push to Docker Hub
docker push yourusername/nexus-auth-service:latest
```

### Option B: AWS ECR (Recommended for AWS deployment)

**Command:** Setup AWS ECR
```bash
# Configure AWS CLI (you'll need AWS Access Key ID and Secret)
aws configure

# Create ECR repository
aws ecr create-repository --repository-name nexus-auth-service --region us-east-1

# Get login token and login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Tag image for ECR
docker tag nexus-auth-service:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nexus-auth-service:latest

# Push to ECR
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nexus-auth-service:latest
```

**Replace `<AWS_ACCOUNT_ID>` with your actual AWS Account ID (12-digit number)**

## 🚀 Deploy to AWS ECS Fargate

### Step 8: Setup AWS Infrastructure

**Command:** Create ECS cluster
```bash
# Create ECS cluster
aws ecs create-cluster --cluster-name nexus-cluster --region us-east-1

# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/nexus-auth-service --region us-east-1
```

### Step 9: Store Secrets in AWS Secrets Manager

**⚠️ SECURITY:** Never put secrets directly in task definitions

**Command:** Store your database and Redis URLs
```bash
# Store database URL
aws secretsmanager create-secret \
  --name "nexus/auth/database-url" \
  --description "Neon PostgreSQL connection URL" \
  --secret-string "postgresql://username:password@host:5432/database?sslmode=require" \
  --region us-east-1

# Store Redis URL
aws secretsmanager create-secret \
  --name "nexus/auth/redis-url" \
  --description "Redis Cloud connection URL" \
  --secret-string "redis://default:password@host:port/0" \
  --region us-east-1

# Store JWT private key (multiline secret)
aws secretsmanager create-secret \
  --name "nexus/auth/jwt-private-key" \
  --description "JWT signing private key" \
  --secret-string file://jwt-private-key.txt \
  --region us-east-1
```

### Step 10: Create ECS Task Definition

**File:** `task-definition.json`
```json
{
  "family": "nexus-auth-service",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "nexus-auth-service",
      "image": "<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nexus-auth-service:latest",
      "portMappings": [{"containerPort": 4001, "protocol": "tcp"}],
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/nexus-auth-service",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:4001/health || exit 1"],
        "interval": 30,
        "timeout": 10,
        "retries": 3,
        "startPeriod": 40
      },
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "4001"}
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:nexus/auth/database-url"
        },
        {
          "name": "REDIS_URL", 
          "valueFrom": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:nexus/auth/redis-url"
        }
      ]
    }
  ]
}
```

**Command:** Register task definition
```bash
# Replace <AWS_ACCOUNT_ID> in the file first
sed -i 's/<AWS_ACCOUNT_ID>/123456789012/g' task-definition.json

# Register the task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json --region us-east-1
```

### Step 11: Create ECS Service with Load Balancer

**Command:** Create Application Load Balancer
```bash
# Create security group for ALB
aws ec2 create-security-group \
  --group-name nexus-alb-sg \
  --description "Security group for Nexus ALB" \
  --vpc-id <VPC_ID>

# Allow HTTP traffic
aws ec2 authorize-security-group-ingress \
  --group-id <SECURITY_GROUP_ID> \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

# Create Application Load Balancer
aws elbv2 create-load-balancer \
  --name nexus-auth-alb \
  --subnets <SUBNET_ID_1> <SUBNET_ID_2> \
  --security-groups <SECURITY_GROUP_ID>
```

**Command:** Create ECS service
```bash
# Create ECS service
aws ecs create-service \
  --cluster nexus-cluster \
  --service-name nexus-auth-service \
  --task-definition nexus-auth-service \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_ID_1>,<SUBNET_ID_2>],securityGroups=[<SECURITY_GROUP_ID>],assignPublicIp=ENABLED}" \
  --region us-east-1
```

### Step 12: Verify Deployment

**Command:** Check service status
```bash
# Check service status
aws ecs describe-services \
  --cluster nexus-cluster \
  --services nexus-auth-service \
  --region us-east-1

# Get ALB DNS name
aws elbv2 describe-load-balancers \
  --names nexus-auth-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text
```

**Command:** Test deployed service
```bash
# Test health endpoint (replace with your ALB DNS)
curl http://nexus-auth-alb-123456789.us-east-1.elb.amazonaws.com/health
```

## 🔄 GitHub Actions CI/CD

**File:** `.github/workflows/deploy.yml`
```yaml
name: Deploy to AWS ECS

on:
  push:
    branches: [main]

jobs:
  deploy:
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

    - name: Build and push image
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: nexus-auth-service
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

    - name: Update ECS service
      run: |
        aws ecs update-service \
          --cluster nexus-cluster \
          --service nexus-auth-service \
          --force-new-deployment
```

## 🛠️ Troubleshooting

### Common Issues and Solutions

**Issue:** Container fails to start
```bash
# Check logs
docker logs nexus-auth-local

# Common causes:
# 1. Missing environment variables
# 2. Database connection failed
# 3. Redis connection failed
```

**Issue:** Health check failing
```bash
# Test health endpoint directly
curl http://localhost:4001/health

# Check if service is binding to correct port
docker exec -it nexus-auth-local netstat -tlnp
```

**Issue:** AWS deployment fails
```bash
# Check ECS service events
aws ecs describe-services --cluster nexus-cluster --services nexus-auth-service

# Check CloudWatch logs
aws logs tail /ecs/nexus-auth-service --follow
```

### Rollback Procedure

**Command:** Rollback to previous version
```bash
# List previous task definitions
aws ecs list-task-definitions --family-prefix nexus-auth-service

# Update service to use previous task definition
aws ecs update-service \
  --cluster nexus-cluster \
  --service nexus-auth-service \
  --task-definition nexus-auth-service:PREVIOUS_REVISION
```

## 🔐 Security & Production Notes

### Security Checklist
- ✅ **Delete `.env.local`** after generating `.env`
- ✅ **Never commit `.env`** to git (add to `.gitignore`)
- ✅ **Use AWS Secrets Manager** for production secrets
- ✅ **Enable CloudWatch logging** for monitoring
- ✅ **Use IAM roles** with least privilege
- ✅ **Enable VPC** for network isolation
- ✅ **Rotate credentials** regularly

### Production Configuration
```bash
# Enable auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/nexus-cluster/nexus-auth-service \
  --min-capacity 2 \
  --max-capacity 10
```

## 📊 Scaling for 10M+ Users

### Performance Recommendations

**ECS Configuration:**
- **CPU**: 1 vCPU (1024 CPU units)
- **Memory**: 2 GB (2048 MB)
- **Instances**: Start with 3-5, auto-scale to 20+

**Database Optimization:**
- Use connection pooling (already configured)
- Enable read replicas for Neon PostgreSQL
- Monitor connection count and query performance

**Redis Configuration:**
- Use Redis Cluster mode for horizontal scaling
- Enable persistence for critical data
- Monitor memory usage and eviction policies

**Monitoring Metrics:**
- Response time (target: <200ms p95)
- Error rate (target: <0.1%)
- CPU utilization (target: <70%)
- Memory utilization (target: <80%)

### Auto-scaling Rules
```bash
# Scale up when CPU > 70%
aws application-autoscaling put-scaling-policy \
  --policy-name nexus-auth-scale-up \
  --service-namespace ecs \
  --resource-id service/nexus-cluster/nexus-auth-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    }
  }'
```

## 🎯 Alternative Deployment Options

### DigitalOcean App Platform (Simpler)
```bash
# Create app.yaml
spec:
  name: nexus-auth-service
  services:
  - name: auth-service
    source_dir: /
    github:
      repo: your-username/nexus-auth-service
      branch: main
    run_command: node dist/index.js
    environment_slug: node-js
    instance_count: 2
    instance_size_slug: basic-xxs
    envs:
    - key: DATABASE_URL
      value: ${DATABASE_URL}
    - key: REDIS_URL
      value: ${REDIS_URL}
```

### Google Cloud Run (Serverless)
```bash
# Deploy to Cloud Run
gcloud run deploy nexus-auth-service \
  --image gcr.io/PROJECT_ID/nexus-auth-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## ✅ Next Steps Checklist

Run these commands on your machine:

```bash
# 1. Verify Docker is running
docker --version

# 2. Navigate to your auth-service directory
cd /path/to/nexusbackend/auth-service

# 3. Generate .env from .env.local
cp .env.local .env

# 4. Build Docker image
docker build -t nexus-auth-service:latest .

# 5. Test locally
docker run -d --name nexus-auth-test --env-file .env -p 4001:4001 nexus-auth-service:latest

# 6. Test health endpoint
curl http://localhost:4001/health

# 7. Clean up test
docker stop nexus-auth-test && docker rm nexus-auth-test

# 8. Delete .env.local (security)
rm .env.local
```

**🎉 Congratulations! Your Nexus Auth Service is now containerized and ready for production deployment!**

For Kubernetes migration later: Your Docker image and ECR repository are fully compatible with EKS, GKE, or any Kubernetes cluster.
