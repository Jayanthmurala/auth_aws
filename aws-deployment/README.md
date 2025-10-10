# 🚀 AWS Deployment Guide - Nexus Auth Service

## 📋 Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed and running
- Your production environment variables ready

## 🎯 Quick Deployment (3 Steps)

### Step 1: Setup AWS Infrastructure
```bash
cd aws-deployment
chmod +x setup-aws-infrastructure.sh
./setup-aws-infrastructure.sh
```

### Step 2: Add Secrets to AWS Parameter Store
```bash
# Add your production secrets to AWS Systems Manager Parameter Store
aws ssm put-parameter --name "/nexus/auth/database-url" --value "your-neon-db-url" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/redis-url" --value "your-redis-cloud-url" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/jwt-private-key" --value "your-jwt-private-key" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/jwt-public-key" --value "your-jwt-public-key" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/internal-api-key" --value "your-32-char-api-key" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/internal-api-secret" --value "your-64-char-api-secret" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/csrf-secret" --value "your-32-char-csrf-secret" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/export-encryption-key" --value "your-32-char-encryption-key" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/smtp-user" --value "your-smtp-user" --type "SecureString"
aws ssm put-parameter --name "/nexus/auth/smtp-pass" --value "your-smtp-password" --type "SecureString"
```

### Step 3: Deploy to ECS
```bash
# Update ecs-task-definition.json with your AWS Account ID first
chmod +x deploy-to-aws.sh
./deploy-to-aws.sh
```

## 🏗️ Architecture Overview

```
Internet → ALB → ECS Fargate → Auth Service (Port 4001)
                     ↓
              CloudWatch Logs
                     ↓
            Systems Manager (Secrets)
```

## 📊 Monitoring & Logs

### CloudWatch Logs
```bash
# View real-time logs
aws logs tail /ecs/nexus-auth-service --follow --region us-east-1
```

### Health Checks
```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers --names nexus-auth-alb --query 'LoadBalancers[0].DNSName' --output text)

# Test health endpoints
curl http://$ALB_DNS/health
curl http://$ALB_DNS/ready
curl http://$ALB_DNS/metrics
```

## 🔧 Configuration

### Environment Variables (Set in Parameter Store)
| Parameter | Description | Required |
|-----------|-------------|----------|
| `/nexus/auth/database-url` | Neon PostgreSQL URL | ✅ |
| `/nexus/auth/redis-url` | Redis Cloud URL | ✅ |
| `/nexus/auth/jwt-private-key` | JWT signing key | ✅ |
| `/nexus/auth/jwt-public-key` | JWT verification key | ✅ |
| `/nexus/auth/internal-api-key` | Internal API key | ✅ |
| `/nexus/auth/internal-api-secret` | Internal API secret | ✅ |
| `/nexus/auth/csrf-secret` | CSRF protection secret | ✅ |
| `/nexus/auth/export-encryption-key` | Data export encryption | ✅ |
| `/nexus/auth/smtp-user` | Email service user | ✅ |
| `/nexus/auth/smtp-pass` | Email service password | ✅ |

### ECS Task Configuration
- **CPU**: 512 (0.5 vCPU)
- **Memory**: 1024 MB (1 GB)
- **Network**: awsvpc mode
- **Platform**: Fargate

## 🔄 Scaling & Updates

### Auto Scaling
```bash
# Enable auto scaling (optional)
aws application-autoscaling register-scalable-target \
    --service-namespace ecs \
    --scalable-dimension ecs:service:DesiredCount \
    --resource-id service/nexus-cluster/nexus-auth-service \
    --min-capacity 2 \
    --max-capacity 10
```

### Rolling Updates
```bash
# Deploy new version
./deploy-to-aws.sh
```

## 🛡️ Security Features

### ✅ Implemented
- Non-root container user
- VPC with private subnets
- Security groups (ports 4001, 443 only)
- Secrets in Parameter Store (encrypted)
- Application Load Balancer with health checks
- CloudWatch logging

### 🔒 Additional Security (Recommended)
- **WAF**: Add AWS WAF for DDoS protection
- **Certificate**: Add SSL/TLS certificate to ALB
- **VPC Endpoints**: For private AWS service access
- **Network ACLs**: Additional network security

## 💰 Cost Optimization

### Current Setup Cost (Estimated)
- **Fargate**: ~$30-50/month (1 task, 0.5 vCPU, 1GB RAM)
- **ALB**: ~$16/month
- **CloudWatch Logs**: ~$5/month
- **Data Transfer**: Variable

### Cost Reduction Tips
- Use Spot instances for non-critical environments
- Set up CloudWatch alarms for cost monitoring
- Use reserved capacity for predictable workloads

## 🚨 Troubleshooting

### Common Issues

1. **Task fails to start**
   ```bash
   aws ecs describe-tasks --cluster nexus-cluster --tasks TASK_ID
   ```

2. **Health check failing**
   ```bash
   # Check logs
   aws logs tail /ecs/nexus-auth-service --follow
   
   # Test health endpoint directly
   curl http://TASK_IP:4001/health
   ```

3. **Database connection issues**
   - Verify DATABASE_URL in Parameter Store
   - Check security group rules
   - Ensure Neon database allows connections

4. **Redis connection issues**
   - Verify REDIS_URL in Parameter Store
   - Check Redis Cloud firewall settings

### Debug Commands
```bash
# Get service status
aws ecs describe-services --cluster nexus-cluster --services nexus-auth-service

# Get task details
aws ecs list-tasks --cluster nexus-cluster --service-name nexus-auth-service
aws ecs describe-tasks --cluster nexus-cluster --tasks TASK_ARN

# Check ALB health
aws elbv2 describe-target-health --target-group-arn TARGET_GROUP_ARN
```

## 🎉 Success Indicators

✅ **Deployment Successful When:**
- ECS service shows "ACTIVE" status
- Tasks are in "RUNNING" state
- Health checks pass (2/2 healthy targets)
- ALB returns 200 OK for `/health`
- CloudWatch logs show startup messages

## 📞 Support

For deployment issues:
1. Check CloudWatch logs first
2. Verify all Parameter Store values
3. Ensure AWS permissions are correct
4. Contact Nexus Development Team

---

**🚀 Your Nexus Auth Service is now running on AWS at enterprise scale!**
