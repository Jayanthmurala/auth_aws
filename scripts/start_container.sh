#!/bin/bash
# =============================================================================
# Production Deployment Script for CodeDeploy - SECURE SECRETS RETRIEVAL
# 1. Retrieves sensitive secrets from AWS Secrets Manager using AWS CLI.
# 2. Builds and runs the Docker container using those secrets.
# =============================================================================

set -e  # Exit immediately if any command fails

APP_DIR="/home/ec2-user/app"
SERVICE_NAME="auth-service"
CONTAINER_NAME="nexus-auth-prod"
APP_PORT=4001

cd "$APP_DIR"

echo "--- Retrieving production secrets from AWS Secrets Manager ---"

# --- SECRET RETRIEVAL VIA AWS CLI ---
get_secret() {
    local SECRET_ID=$1
    echo "Fetching secret: $SECRET_ID"
    aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ID" \
        --query SecretString \
        --output text
}

DB_URL=$(get_secret "prod/auth/database_url")
[ -z "$DB_URL" ] && { echo "ERROR: DATABASE_URL secret could not be retrieved or is empty."; exit 1; }

REDIS_URL=$(get_secret "prod/auth/redis_url")
[ -z "$REDIS_URL" ] && { echo "ERROR: REDIS_URL secret could not be retrieved or is empty."; exit 1; }

JWT_PRIVATE_KEY=$(get_secret "prod/auth/jwt_private_key")
[ -z "$JWT_PRIVATE_KEY" ] && { echo "ERROR: JWT_PRIVATE_KEY secret could not be retrieved or is empty."; exit 1; }

echo "--- 1. Building Docker image for $SERVICE_NAME ---"
docker compose build "$SERVICE_NAME"

echo "--- 2. Stopping and removing old container ($CONTAINER_NAME) ---"
docker compose down || true

echo "--- 3. Starting new production container with SECURE AWS endpoints ---"

# Create an .env.runtime file dynamically for docker-compose to use
cat > .env.runtime <<EOF
NODE_ENV=production
PORT=$APP_PORT

# Secrets (fetched dynamically)
DATABASE_URL=$DB_URL
REDIS_URL=$REDIS_URL
AUTH_JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY

# Static/non-sensitive vars passed from environment
AUTH_JWT_PUBLIC_KEY=${AUTH_JWT_PUBLIC_KEY}
AUTH_JWT_KID=${AUTH_JWT_KID}
AUTH_JWT_ISSUER=${AUTH_JWT_ISSUER}
AUTH_JWT_AUDIENCE=${AUTH_JWT_AUDIENCE}
AUTH_JWT_ACCESS_EXPIRES_IN=${AUTH_JWT_ACCESS_EXPIRES_IN}
AUTH_JWT_REFRESH_EXPIRES_IN=${AUTH_JWT_REFRESH_EXPIRES_IN}
INTERNAL_API_KEY=${INTERNAL_API_KEY}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}
CSRF_SECRET=${CSRF_SECRET}
EXPORT_ENCRYPTION_KEY=${EXPORT_ENCRYPTION_KEY}
EOF

# Run docker compose in detached mode using the generated env file
docker compose --env-file .env.runtime up -d "$SERVICE_NAME"

echo "--- 4. Checking running containers ---"
docker ps

echo "--- ✅ Deployment sequence finished successfully ---"
exit 0