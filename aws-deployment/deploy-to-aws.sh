#!/bin/bash

# Nexus Auth Service - AWS ECS Deployment Script
# This script deploys the auth service to AWS ECS with Fargate

set -e

# Configuration
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="YOUR_ACCOUNT_ID"
ECR_REPOSITORY="nexus-auth-service"
ECS_CLUSTER="nexus-cluster"
ECS_SERVICE="nexus-auth-service"
TASK_DEFINITION="nexus-auth-service"

echo "🚀 Deploying Nexus Auth Service to AWS ECS..."

# Step 1: Build and tag Docker image
echo "📦 Building Docker image..."
docker build -t $ECR_REPOSITORY:latest .

# Step 2: Tag for ECR
ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"
docker tag $ECR_REPOSITORY:latest $ECR_URI:latest
docker tag $ECR_REPOSITORY:latest $ECR_URI:$(date +%Y%m%d%H%M%S)

echo "🔐 Logging into AWS ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Step 3: Push to ECR
echo "📤 Pushing image to ECR..."
docker push $ECR_URI:latest
docker push $ECR_URI:$(date +%Y%m%d%H%M%S)

# Step 4: Update task definition
echo "📝 Updating ECS task definition..."
# Replace YOUR_ACCOUNT_ID in task definition
sed "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" ecs-task-definition.json > ecs-task-definition-updated.json

# Register new task definition
aws ecs register-task-definition --cli-input-json file://ecs-task-definition-updated.json --region $AWS_REGION

# Step 5: Update ECS service
echo "🔄 Updating ECS service..."
aws ecs update-service \
    --cluster $ECS_CLUSTER \
    --service $ECS_SERVICE \
    --task-definition $TASK_DEFINITION \
    --region $AWS_REGION

# Step 6: Wait for deployment to complete
echo "⏳ Waiting for deployment to complete..."
aws ecs wait services-stable \
    --cluster $ECS_CLUSTER \
    --services $ECS_SERVICE \
    --region $AWS_REGION

# Step 7: Get service status
echo "✅ Deployment complete! Getting service status..."
aws ecs describe-services \
    --cluster $ECS_CLUSTER \
    --services $ECS_SERVICE \
    --region $AWS_REGION \
    --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,TaskDefinition:taskDefinition}'

echo "🎉 Nexus Auth Service deployed successfully!"
echo "🔍 Check logs: aws logs tail /ecs/nexus-auth-service --follow --region $AWS_REGION"

# Cleanup
rm -f ecs-task-definition-updated.json
