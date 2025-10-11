# =============================================================================
# Nexus Auth Service - Production Dockerfile
# Multi-stage build optimized for 10M+ users with Node.js 20 LTS
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies and build application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install build dependencies for native modules (argon2, @prisma/client, pg, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    openssl-dev \
    openssl \
    libssl3 \
    && ln -sf python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code and configuration files
COPY . .

# Generate Prisma client (must be done before TypeScript compilation)
# This ensures the client is generated inside Docker, not from local machine
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript to JavaScript with import fixes
RUN npm run build

# Verify critical files exist - fail build early if missing
RUN test -f dist/index.js || (echo "ERROR: dist/index.js missing after build" && exit 1)
RUN test -f dist/db.js || (echo "ERROR: dist/db.js missing after build" && exit 1)
RUN test -d dist/routes || (echo "ERROR: dist/routes directory missing after build" && exit 1)
RUN test -d dist/config || (echo "ERROR: dist/config directory missing after build" && exit 1)

# List built files for debugging
RUN echo "=== Build Verification ===" && \
    ls -la dist/ && \
    echo "=== Routes ===" && \
    ls -la dist/routes/ && \
    echo "=== Config ===" && \
    ls -la dist/config/

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime - Minimal image with only runtime dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install runtime dependencies and security updates
RUN apk update && apk upgrade && \
    apk add --no-cache \
        dumb-init \
        curl \
        ca-certificates \
        openssl \
        libssl3 \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nexus -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files for production dependency installation
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production && \
    npm cache clean --force

# Copy built application and necessary files from builder stage
COPY --from=builder --chown=nexus:nodejs /app/dist ./dist
COPY --from=builder --chown=nexus:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nexus:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Ensure all files are owned by nexus user
RUN chown -R nexus:nodejs /app

# Switch to non-root user
USER nexus

# Set production environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Expose application port
EXPOSE 4001

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:4001/health || exit 1

# Use dumb-init for proper signal handling and process management
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# Metadata labels
LABEL maintainer="Nexus Development Team"
LABEL version="0.1.0"
LABEL description="Nexus Authentication Service - Production Ready for 10M+ Users"
LABEL org.opencontainers.image.title="nexus-auth-service"
LABEL org.opencontainers.image.description="Enterprise authentication service with Redis clustering and PostgreSQL"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/nexus/auth-service"
