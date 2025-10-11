#!/bin/bash

# =============================================================================
# Build and Test Script - Nexus Auth Service
# =============================================================================

set -e

echo "🚀 Building and Testing Nexus Auth Service Docker Container"
echo "============================================================"

# Configuration
IMAGE_NAME="nexus-auth-service"
CONTAINER_NAME="nexus-auth-test"
TEST_PORT="4001"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

# Step 1: Cleanup any existing containers
print_step "Cleaning up existing containers..."
docker stop $CONTAINER_NAME 2>/dev/null || true
docker rm $CONTAINER_NAME 2>/dev/null || true

# Step 2: Check for .env file
print_step "Checking environment configuration..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        print_warning ".env not found, copying from .env.example"
        cp .env.example .env
        print_warning "Please update .env with your actual values before running in production"
    else
        print_error ".env and .env.example not found!"
        exit 1
    fi
fi

# Step 3: Build Docker image
print_step "Building Docker image..."
docker build -f Dockerfile.production -t $IMAGE_NAME:latest .
print_success "Docker image built successfully"

# Step 4: Verify image size
print_step "Checking image size..."
IMAGE_SIZE=$(docker images $IMAGE_NAME:latest --format "table {{.Size}}" | tail -n 1)
print_success "Image size: $IMAGE_SIZE"

# Step 5: Run container for testing
print_step "Starting container for testing..."
docker run -d \
    --name $CONTAINER_NAME \
    --env-file .env \
    -p $TEST_PORT:4001 \
    $IMAGE_NAME:latest

# Step 6: Wait for container to be ready
print_step "Waiting for service to be ready..."
sleep 10

# Check if container is running
if ! docker ps | grep -q $CONTAINER_NAME; then
    print_error "Container failed to start!"
    echo "Container logs:"
    docker logs $CONTAINER_NAME
    exit 1
fi

# Step 7: Health check
print_step "Testing health endpoints..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$TEST_PORT/health || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    print_success "Health check passed (HTTP $HEALTH_RESPONSE)"
else
    print_error "Health check failed (HTTP $HEALTH_RESPONSE)"
    echo "Container logs:"
    docker logs $CONTAINER_NAME
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
    exit 1
fi

# Step 8: Test additional endpoints
print_step "Testing additional endpoints..."

# Test ready endpoint
READY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$TEST_PORT/ready || echo "000")
if [ "$READY_RESPONSE" = "200" ]; then
    print_success "Ready endpoint working (HTTP $READY_RESPONSE)"
else
    print_warning "Ready endpoint not available (HTTP $READY_RESPONSE)"
fi

# Test metrics endpoint
METRICS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$TEST_PORT/metrics || echo "000")
if [ "$METRICS_RESPONSE" = "200" ]; then
    print_success "Metrics endpoint working (HTTP $METRICS_RESPONSE)"
else
    print_warning "Metrics endpoint not available (HTTP $METRICS_RESPONSE)"
fi

# Step 9: Check container resources
print_step "Checking container resources..."
docker stats $CONTAINER_NAME --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

# Step 10: Success summary
print_success "Container is running successfully!"
echo ""
echo "📊 Container Details:"
echo "   - Image: $IMAGE_NAME:latest"
echo "   - Container: $CONTAINER_NAME"
echo "   - Port: http://localhost:$TEST_PORT"
echo "   - Health: http://localhost:$TEST_PORT/health"
echo ""
echo "🔧 Management Commands:"
echo "   - View logs: docker logs -f $CONTAINER_NAME"
echo "   - Stop container: docker stop $CONTAINER_NAME"
echo "   - Remove container: docker rm $CONTAINER_NAME"
echo "   - Shell access: docker exec -it $CONTAINER_NAME sh"
echo ""
echo "🎉 Build and test completed successfully!"

# Optional: Keep container running or stop it
read -p "Keep container running? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_step "Stopping and removing test container..."
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
    print_success "Test container cleaned up"
fi
