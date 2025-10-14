#!/bin/bash
# =============================================================================
# Production Deployment Script for CodeDeploy
# 1. Ensures we are in the application directory.
# 2. Builds the Docker image for the 'auth-service'.
# 3. Stops/removes old containers.
# 4. Runs the new container using external AWS database/cache endpoints
#    passed via environment variables (must be present in the EC2 shell).
# =============================================================================

set -e # Exit immediately if a command exits with a non-zero status

APP_DIR="/home/ec2-user/app"
SERVICE_NAME="auth-service"
CONTAINER_NAME="nexus-auth-prod"
APP_PORT=4001

cd $APP_DIR

echo "--- 1. Building Docker image for $SERVICE_NAME ---"
# Use 'docker compose build' to execute the Dockerfile specific to the service
docker compose build $SERVICE_NAME

echo "--- 2. Stopping and removing old container ($CONTAINER_NAME) ---"
# Stops and removes the container without relying on the 'up' state.
docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

echo "--- 3. Starting new production container with AWS endpoints ---"

# Retrieve mandatory production environment variables from the EC2 shell environment.
# Note: These variables (PROD_DB_HOST, etc.) MUST be set manually on the EC2 instance 
# OR injected via EC2 User Data/AWS Secrets Manager/Parameter Store.

# The following variables MUST be available in the EC2 instance environment:
# PROD_DB_URL, AUTH_JWT_PRIVATE_KEY, REDIS_URL, etc.
# For simplicity, we assume the environment variables are already set 
# in the shell environment where the CodeDeploy agent runs.

# Run the container, injecting necessary environment variables.
# We are manually injecting the full environment because relying on '.env' 
# is dangerous for production credentials.

docker compose run -d \
    --name $CONTAINER_NAME \
    -p $APP_PORT:$APP_PORT \
    -e NODE_ENV=production \
    -e PORT=$APP_PORT \
    -e DATABASE_URL="${DATABASE_URL}" \
    -e REDIS_URL="${REDIS_URL}" \
    -e AUTH_JWT_PRIVATE_KEY="${AUTH_JWT_PRIVATE_KEY}" \
    -e AUTH_JWT_PUBLIC_KEY="${AUTH_JWT_PUBLIC_KEY}" \
    -e AUTH_JWT_KID="${AUTH_JWT_KID}" \
    -e AUTH_JWT_ISSUER="${AUTH_JWT_ISSUER}" \
    -e AUTH_JWT_AUDIENCE="${AUTH_JWT_AUDIENCE}" \
    -e AUTH_JWT_ACCESS_EXPIRES_IN="${AUTH_JWT_ACCESS_EXPIRES_IN}" \
    -e AUTH_JWT_REFRESH_EXPIRES_IN="${AUTH_JWT_REFRESH_EXPIRES_IN}" \
    -e INTERNAL_API_KEY="${INTERNAL_API_KEY}" \
    -e INTERNAL_API_SECRET="${INTERNAL_API_SECRET}" \
    -e CSRF_SECRET="${CSRF_SECRET}" \
    -e EXPORT_ENCRYPTION_KEY="${EXPORT_ENCRYPTION_KEY}" \
    $SERVICE_NAME

echo "Deployment sequence finished."