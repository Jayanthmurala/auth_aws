#!/bin/bash

# Nexus Auth Service - AWS Infrastructure Setup
# This script creates the necessary AWS infrastructure for the auth service

set -e

# Configuration
AWS_REGION="us-east-1"
VPC_CIDR="10.0.0.0/16"
PUBLIC_SUBNET_1_CIDR="10.0.1.0/24"
PUBLIC_SUBNET_2_CIDR="10.0.2.0/24"
PRIVATE_SUBNET_1_CIDR="10.0.3.0/24"
PRIVATE_SUBNET_2_CIDR="10.0.4.0/24"

echo "🏗️ Setting up AWS infrastructure for Nexus Auth Service..."

# Step 1: Create ECR Repository
echo "📦 Creating ECR repository..."
aws ecr create-repository \
    --repository-name nexus-auth-service \
    --region $AWS_REGION \
    --image-scanning-configuration scanOnPush=true \
    || echo "ECR repository already exists"

# Step 2: Create CloudWatch Log Group
echo "📊 Creating CloudWatch log group..."
aws logs create-log-group \
    --log-group-name /ecs/nexus-auth-service \
    --region $AWS_REGION \
    || echo "Log group already exists"

# Step 3: Create ECS Cluster
echo "🚀 Creating ECS cluster..."
aws ecs create-cluster \
    --cluster-name nexus-cluster \
    --capacity-providers FARGATE \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
    --region $AWS_REGION \
    || echo "ECS cluster already exists"

# Step 4: Create VPC (if needed)
echo "🌐 Creating VPC..."
VPC_ID=$(aws ec2 create-vpc \
    --cidr-block $VPC_CIDR \
    --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=nexus-vpc}]' \
    --region $AWS_REGION \
    --query 'Vpc.VpcId' \
    --output text 2>/dev/null || echo "")

if [ -z "$VPC_ID" ]; then
    echo "Using existing VPC or failed to create"
    VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=nexus-vpc" --query 'Vpcs[0].VpcId' --output text --region $AWS_REGION)
fi

echo "VPC ID: $VPC_ID"

# Step 5: Create Internet Gateway
echo "🌍 Creating Internet Gateway..."
IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=nexus-igw}]' \
    --region $AWS_REGION \
    --query 'InternetGateway.InternetGatewayId' \
    --output text 2>/dev/null || echo "")

if [ -n "$IGW_ID" ]; then
    aws ec2 attach-internet-gateway \
        --internet-gateway-id $IGW_ID \
        --vpc-id $VPC_ID \
        --region $AWS_REGION
fi

# Step 6: Create Subnets
echo "🏠 Creating subnets..."
PUBLIC_SUBNET_1=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_1_CIDR \
    --availability-zone ${AWS_REGION}a \
    --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=nexus-public-1}]' \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text 2>/dev/null || echo "")

PUBLIC_SUBNET_2=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_2_CIDR \
    --availability-zone ${AWS_REGION}b \
    --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=nexus-public-2}]' \
    --region $AWS_REGION \
    --query 'Subnet.SubnetId' \
    --output text 2>/dev/null || echo "")

# Step 7: Create Security Group
echo "🔒 Creating security group..."
SG_ID=$(aws ec2 create-security-group \
    --group-name nexus-auth-sg \
    --description "Security group for Nexus Auth Service" \
    --vpc-id $VPC_ID \
    --region $AWS_REGION \
    --query 'GroupId' \
    --output text 2>/dev/null || echo "")

if [ -n "$SG_ID" ]; then
    # Allow HTTP traffic on port 4001
    aws ec2 authorize-security-group-ingress \
        --group-id $SG_ID \
        --protocol tcp \
        --port 4001 \
        --cidr 0.0.0.0/0 \
        --region $AWS_REGION

    # Allow HTTPS traffic on port 443
    aws ec2 authorize-security-group-ingress \
        --group-id $SG_ID \
        --protocol tcp \
        --port 443 \
        --cidr 0.0.0.0/0 \
        --region $AWS_REGION
fi

# Step 8: Create Application Load Balancer
echo "⚖️ Creating Application Load Balancer..."
ALB_ARN=$(aws elbv2 create-load-balancer \
    --name nexus-auth-alb \
    --subnets $PUBLIC_SUBNET_1 $PUBLIC_SUBNET_2 \
    --security-groups $SG_ID \
    --region $AWS_REGION \
    --query 'LoadBalancers[0].LoadBalancerArn' \
    --output text 2>/dev/null || echo "")

# Step 9: Create Target Group
echo "🎯 Creating target group..."
TG_ARN=$(aws elbv2 create-target-group \
    --name nexus-auth-tg \
    --protocol HTTP \
    --port 4001 \
    --vpc-id $VPC_ID \
    --target-type ip \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 10 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region $AWS_REGION \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text 2>/dev/null || echo "")

# Step 10: Create ALB Listener
if [ -n "$ALB_ARN" ] && [ -n "$TG_ARN" ]; then
    echo "👂 Creating ALB listener..."
    aws elbv2 create-listener \
        --load-balancer-arn $ALB_ARN \
        --protocol HTTP \
        --port 80 \
        --default-actions Type=forward,TargetGroupArn=$TG_ARN \
        --region $AWS_REGION
fi

# Step 11: Store parameters in Systems Manager
echo "🔐 Storing secrets in AWS Systems Manager..."
echo "Please manually add these parameters to AWS Systems Manager Parameter Store:"
echo "- /nexus/auth/database-url (SecureString)"
echo "- /nexus/auth/redis-url (SecureString)"
echo "- /nexus/auth/jwt-private-key (SecureString)"
echo "- /nexus/auth/jwt-public-key (SecureString)"
echo "- /nexus/auth/internal-api-key (SecureString)"
echo "- /nexus/auth/internal-api-secret (SecureString)"
echo "- /nexus/auth/csrf-secret (SecureString)"
echo "- /nexus/auth/export-encryption-key (SecureString)"
echo "- /nexus/auth/smtp-user (SecureString)"
echo "- /nexus/auth/smtp-pass (SecureString)"

echo ""
echo "✅ AWS infrastructure setup complete!"
echo "📝 Summary:"
echo "   - VPC ID: $VPC_ID"
echo "   - Security Group ID: $SG_ID"
echo "   - Public Subnets: $PUBLIC_SUBNET_1, $PUBLIC_SUBNET_2"
echo "   - Load Balancer ARN: $ALB_ARN"
echo "   - Target Group ARN: $TG_ARN"
echo ""
echo "🚀 Next steps:"
echo "   1. Add secrets to AWS Systems Manager Parameter Store"
echo "   2. Update ecs-task-definition.json with your AWS Account ID"
echo "   3. Run deploy-to-aws.sh to deploy the service"
