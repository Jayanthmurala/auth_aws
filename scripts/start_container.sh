#!/bin/bash
# =============================================================================
# Production Deployment Script for CodeDeploy - SECURE SECRETS RETRIEVAL
# 1. Retrieves sensitive secrets from AWS Secrets Manager using AWS CLI.
# 2. Builds and runs the Docker container using those secrets.
# =============================================================================

set -e  # Exit immediately if a command exits with a non-zero status

APP_DIR="/home/ec2-user/app"
SERVICE_NAME="auth-service"
CONTAINER_NAME="nexus-auth-prod"
APP_PORT=4001

cd $APP_DIR

echo "--- Fixing file permissions for deployment files ---"
sudo chown -R ec2-user:ec2-user $APP_DIR
sudo chmod -R 755 $APP_DIR

echo "--- Retrieving production secrets from AWS Secrets Manager ---"

function get_secret() {
    SECRET_ID=$1
    echo "Fetching secret: $SECRET_ID"
    aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ID" \
        --query SecretString \
        --output text
}

DB_URL=$(get_secret "prod/auth/database_url")
if [ -z "$DB_URL" ]; then 
    echo "ERROR: DATABASE_URL secret could not be retrieved or is empty."
    exit 1
fi

REDIS_URL=$(get_secret "prod/auth/redis_url")
if [ -z "$REDIS_URL" ]; then 
    echo "ERROR: REDIS_URL secret could not be retrieved or is empty."
    exit 1
fi

JWT_PRIVATE_KEY=$(get_secret "prod/auth/jwt_private_key")
if [ -z "$JWT_PRIVATE_KEY" ]; then 
    echo "ERROR: JWT_PRIVATE_KEY secret could not be retrieved or is empty."
    exit 1
fi

echo "--- 1. Building Docker image for $SERVICE_NAME ---"
docker compose build $SERVICE_NAME

echo "--- 2. Stopping and removing old container ($CONTAINER_NAME) ---"
docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

echo "--- 3. Starting new production container with SECURE AWS endpoints ---"

docker compose run -d \
    --name $CONTAINER_NAME \
    -p $APP_PORT:$APP_PORT \
    -e NODE_ENV=production \
    -e PORT=$APP_PORT \
    \
    -e DATABASE_URL="${DB_URL}" \
    -e REDIS_URL="${REDIS_URL}" \
    -e AUTH_JWT_PRIVATE_KEY="${JWT_PRIVATE_KEY}" \
    \
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

echo "Deployment sequence finished."