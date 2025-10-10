# =============================================================================
# Nexus Auth Service - Production Dockerfile
# Multi-stage build for optimal image size and security
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage
# -----------------------------------------------------------------------------
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies for native Node.js modules
# Required for: argon2 (password hashing), @prisma/client, pg (PostgreSQL), ioredis
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python

# Copy package files first (for better Docker layer caching)
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client (required for database operations)
RUN npx prisma generate

# Build TypeScript to JavaScript
RUN npm run build

# Verify build output exists
RUN ls -la dist/

# -----------------------------------------------------------------------------
# Stage 2: Production Stage
# -----------------------------------------------------------------------------
FROM node:18-alpine AS production

# Install security updates and dumb-init for proper signal handling
RUN apk update && apk upgrade && \
    apk add --no-cache \
        dumb-init \
        curl \
    && rm -rf /var/cache/apk/*

# Create non-root user for security (following security best practices)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nexus -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (smaller image size)
RUN npm ci --only=production --frozen-lockfile && \
    npm cache clean --force

# Copy built application and necessary files from builder stage
COPY --from=builder --chown=nexus:nodejs /app/dist ./dist
COPY --from=builder --chown=nexus:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nexus:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Change ownership to non-root user
RUN chown -R nexus:nodejs /app

# Switch to non-root user (security best practice)
USER nexus

# Expose port (auth service runs on 4001)
EXPOSE 4001

# Health check (used by Docker and orchestrators like ECS/Kubernetes)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:4001/health || exit 1

# Use dumb-init for proper signal handling (graceful shutdowns)
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# Metadata labels
LABEL maintainer="Nexus Development Team"
LABEL version="0.1.0"
LABEL description="Nexus Authentication Service - Production Ready for 10M+ Users"
LABEL org.opencontainers.image.title="nexus-auth-service"
LABEL org.opencontainers.image.description="Enterprise-grade authentication service with Redis clustering and PostgreSQL"
LABEL org.opencontainers.image.version="0.1.0"
