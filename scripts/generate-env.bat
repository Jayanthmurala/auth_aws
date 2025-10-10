@echo off
REM =============================================================================
REM Generate .env from .env.local - Nexus Auth Service (Windows)
REM This script safely copies .env.local to .env while preserving multiline values
REM =============================================================================

echo 🔧 Generating .env from .env.local...

REM Check if .env.local exists
if not exist ".env.local" (
    echo ❌ Error: .env.local file not found!
    echo Please ensure .env.local exists in the current directory.
    pause
    exit /b 1
)

REM Backup existing .env if it exists
if exist ".env" (
    echo 📋 Backing up existing .env to .env.backup
    copy ".env" ".env.backup" >nul
)

REM Copy .env.local to .env (preserves multiline JWT keys)
copy ".env.local" ".env" >nul

REM Update NODE_ENV for production container use
powershell -Command "(Get-Content .env) -replace 'NODE_ENV=development', 'NODE_ENV=production' | Set-Content .env"

REM Update rate limiting for production scale
powershell -Command "(Get-Content .env) -replace 'RATE_LIMIT_MAX=100', 'RATE_LIMIT_MAX=1000' | Set-Content .env"

echo ✅ .env file generated successfully!
echo.
echo 🔐 SECURITY REMINDER:
echo    - .env contains sensitive data - never commit to git
echo    - Delete .env.local after deployment setup
echo    - Use AWS Secrets Manager for production secrets
echo.
echo 📋 Environment file ready for Docker:
echo    - NODE_ENV set to 'production'
echo    - Rate limiting increased for production scale
echo    - All secrets preserved from .env.local
echo.
echo 🚀 Next steps:
echo    1. Build Docker image: docker build -t nexus-auth-service .
echo    2. Run locally: docker run --env-file .env -p 4001:4001 nexus-auth-service
echo    3. Test health: curl http://localhost:4001/health
echo.
echo ⚠️  Remember to delete .env.local when done: del .env.local
pause
