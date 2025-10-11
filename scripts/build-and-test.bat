@echo off
REM =============================================================================
REM Build and Test Script - Nexus Auth Service (Windows)
REM =============================================================================

setlocal enabledelayedexpansion

echo 🚀 Building and Testing Nexus Auth Service Docker Container
echo ============================================================

REM Configuration
set IMAGE_NAME=nexus-auth-service
set CONTAINER_NAME=nexus-auth-test
set TEST_PORT=4001

REM Step 1: Cleanup any existing containers
echo =^> Cleaning up existing containers...
docker stop %CONTAINER_NAME% 2>nul
docker rm %CONTAINER_NAME% 2>nul

REM Step 2: Check for .env file
echo =^> Checking environment configuration...
if not exist ".env" (
    if exist ".env.example" (
        echo ⚠️  .env not found, copying from .env.example
        copy ".env.example" ".env" >nul
        echo ⚠️  Please update .env with your actual values before running in production
    ) else (
        echo ❌ .env and .env.example not found!
        exit /b 1
    )
)

REM Step 3: Build Docker image
echo =^> Building Docker image...
docker build -f Dockerfile.production -t %IMAGE_NAME%:latest .
if errorlevel 1 (
    echo ❌ Docker build failed!
    exit /b 1
)
echo ✅ Docker image built successfully

REM Step 4: Run container for testing
echo =^> Starting container for testing...
docker run -d --name %CONTAINER_NAME% --env-file .env -p %TEST_PORT%:4001 %IMAGE_NAME%:latest
if errorlevel 1 (
    echo ❌ Failed to start container!
    exit /b 1
)

REM Step 5: Wait for container to be ready
echo =^> Waiting for service to be ready...
timeout /t 15 /nobreak >nul

REM Check if container is running
docker ps | findstr %CONTAINER_NAME% >nul
if errorlevel 1 (
    echo ❌ Container failed to start!
    echo Container logs:
    docker logs %CONTAINER_NAME%
    exit /b 1
)

REM Step 6: Health check
echo =^> Testing health endpoints...
curl -s -o nul -w "%%{http_code}" http://localhost:%TEST_PORT%/health > temp_response.txt
set /p HEALTH_RESPONSE=<temp_response.txt
del temp_response.txt

if "%HEALTH_RESPONSE%"=="200" (
    echo ✅ Health check passed (HTTP %HEALTH_RESPONSE%)
) else (
    echo ❌ Health check failed (HTTP %HEALTH_RESPONSE%)
    echo Container logs:
    docker logs %CONTAINER_NAME%
    docker stop %CONTAINER_NAME%
    docker rm %CONTAINER_NAME%
    exit /b 1
)

REM Step 7: Success summary
echo ✅ Container is running successfully!
echo.
echo 📊 Container Details:
echo    - Image: %IMAGE_NAME%:latest
echo    - Container: %CONTAINER_NAME%
echo    - Port: http://localhost:%TEST_PORT%
echo    - Health: http://localhost:%TEST_PORT%/health
echo.
echo 🔧 Management Commands:
echo    - View logs: docker logs -f %CONTAINER_NAME%
echo    - Stop container: docker stop %CONTAINER_NAME%
echo    - Remove container: docker rm %CONTAINER_NAME%
echo    - Shell access: docker exec -it %CONTAINER_NAME% sh
echo.
echo 🎉 Build and test completed successfully!

REM Optional: Keep container running or stop it
set /p KEEP_RUNNING="Keep container running? (y/N): "
if /i not "%KEEP_RUNNING%"=="y" (
    echo =^> Stopping and removing test container...
    docker stop %CONTAINER_NAME%
    docker rm %CONTAINER_NAME%
    echo ✅ Test container cleaned up
)

pause
