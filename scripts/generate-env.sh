#!/bin/bash

# =============================================================================
# Generate .env from .env.local - Nexus Auth Service
# This script safely copies .env.local to .env while preserving multiline values
# =============================================================================

set -e

echo "🔧 Generating .env from .env.local..."

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ Error: .env.local file not found!"
    echo "Please ensure .env.local exists in the current directory."
    exit 1
fi

# Backup existing .env if it exists
if [ -f ".env" ]; then
    echo "📋 Backing up existing .env to .env.backup"
    cp .env .env.backup
fi

# Copy .env.local to .env (preserves multiline JWT keys)
cp .env.local .env

# Update NODE_ENV for production container use
sed -i.bak 's/NODE_ENV=development/NODE_ENV=production/' .env && rm .env.bak

# Update rate limiting for production scale
sed -i.bak 's/RATE_LIMIT_MAX=100/RATE_LIMIT_MAX=1000/' .env && rm .env.bak

echo "✅ .env file generated successfully!"
echo ""
echo "🔐 SECURITY REMINDER:"
echo "   - .env contains sensitive data - never commit to git"
echo "   - Delete .env.local after deployment setup"
echo "   - Use AWS Secrets Manager for production secrets"
echo ""
echo "📋 Environment file ready for Docker:"
echo "   - NODE_ENV set to 'production'"
echo "   - Rate limiting increased for production scale"
echo "   - All secrets preserved from .env.local"
echo ""
echo "🚀 Next steps:"
echo "   1. Build Docker image: docker build -t nexus-auth-service ."
echo "   2. Run locally: docker run --env-file .env -p 4001:4001 nexus-auth-service"
echo "   3. Test health: curl http://localhost:4001/health"
echo ""
echo "⚠️  Remember to delete .env.local when done: rm .env.local"
