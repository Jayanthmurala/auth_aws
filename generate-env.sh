#!/bin/bash

# Generate production .env file from .env.example
# This script creates a production-ready .env file

echo "🔧 Generating production .env file from .env.example..."

# Copy .env.example to .env
cp .env.example .env

# Update NODE_ENV to production
sed -i 's/NODE_ENV=development/NODE_ENV=production/' .env

# Update Redis disabled flag for production
sed -i 's/REDIS_DISABLED=false/REDIS_DISABLED=false/' .env

# Update rate limiting for production scale
sed -i 's/RATE_LIMIT_MAX=100/RATE_LIMIT_MAX=1000/' .env

echo "✅ Production .env file generated successfully!"
echo ""
echo "🔐 IMPORTANT: Review and update the following in .env:"
echo "   - DATABASE_URL (use your production Neon PostgreSQL URL)"
echo "   - REDIS_URL (use your production Redis Cloud URL)"
echo "   - JWT keys (AUTH_JWT_PRIVATE_KEY, AUTH_JWT_PUBLIC_KEY)"
echo "   - SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS)"
echo "   - FRONTEND_URLS (add your production frontend URLs)"
echo "   - All secret keys (ensure they are 32+ characters)"
echo ""
echo "📋 Current environment variables that need review:"
grep -E "^(DATABASE_URL|REDIS_URL|AUTH_JWT_|SMTP_|FRONTEND_URL|.*_SECRET|.*_KEY)" .env
