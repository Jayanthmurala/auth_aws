#!/bin/bash
# =============================================================================
# Production Deployment Script - SECURE SECRETS RETRIEVAL (FINAL)
# 1. Retrieves ALL key material secrets from AWS Secrets Manager.
# 2. Loads ALL static config variables from the local .env file.
# 3. Builds and runs the Docker container with a complete environment.
# =============================================================================

set -e # Exit immediately if a command fails

APP_DIR="/home/ec2-user/app"
SERVICE_NAME="auth-service"
CONTAINER_NAME="nexus-auth-prod"
APP_PORT=4001

cd $APP_DIR

# --- Set File Permissions (Already included, keep for robustness) ---
echo "--- Fixing file permissions for deployment files ---"
sudo chown -R ec2-user:ec2-user $APP_DIR
sudo chmod -R 755 $APP_DIR


# --- 2. Retrieve SENSITIVE Secrets from AWS Secrets Manager ---
echo "--- Retrieving production secrets from AWS Secrets Manager ---"

function get_secret() {
    SECRET_ID=$1
    aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ID" \
        --query SecretString \
        --output text
}

# Retrieve all sensitive and key material secrets
DB_URL=$(get_secret "prod/auth/database_url")
REDIS_URL=$(get_secret "prod/auth/redis_url")
JWT_PRIVATE_KEY=$(get_secret "prod/auth/jwt_private_key")
# CRITICAL FIX: Retrieve the public key from Secrets Manager
JWT_PUBLIC_KEY=$(get_secret "prod/auth/jwt_public_key") 

if [ -z "$DB_URL" ] || [ -z "$REDIS_URL" ] || [ -z "$JWT_PRIVATE_KEY" ] || [ -z "$JWT_PUBLIC_KEY" ]; then 
    echo "ERROR: One or more critical secrets could not be retrieved."
    exit 1
fi

echo "--- 3. Building Docker image for $SERVICE_NAME ---"
docker compose build $SERVICE_NAME

echo "--- 4. Stopping and removing old container ($CONTAINER_NAME) ---"
docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

echo "--- 5. Starting new production container with SECURE and STATIC endpoints ---"

# Set all environment variables before running compose up
export DATABASE_URL="${DB_URL}"
export REDIS_URL="${REDIS_URL}"
export AUTH_JWT_PRIVATE_KEY="${JWT_PRIVATE_KEY}"
export AUTH_JWT_PUBLIC_KEY="${JWT_PUBLIC_KEY}"
export NODE_ENV=production
export PORT=$APP_PORT
export AUTH_JWT_KID="${AUTH_JWT_KID}"
export AUTH_JWT_ISSUER="${AUTH_JWT_ISSUER}"
export AUTH_JWT_AUDIENCE="${AUTH_JWT_AUDIENCE}"
export AUTH_JWT_ACCESS_EXPIRES_IN="${AUTH_JWT_ACCESS_EXPIRES_IN}"
export AUTH_JWT_REFRESH_EXPIRES_IN="${AUTH_JWT_REFRESH_EXPIRES_IN}"
export INTERNAL_API_KEY="${INTERNAL_API_KEY}"
export INTERNAL_API_SECRET="${INTERNAL_API_SECRET}"
export CSRF_SECRET="${CSRF_SECRET}"
export EXPORT_ENCRYPTION_KEY="${EXPORT_ENCRYPTION_KEY}"
export FRONTEND_URL="${FRONTEND_URL}"
export FRONTEND_URLS="${FRONTEND_URLS}"

docker compose up -d $SERVICE_NAME

echo "Deployment sequence finished."