@echo off
REM Generate production .env file from .env.example
REM This script creates a production-ready .env file

echo 🔧 Generating production .env file from .env.example...

REM Copy .env.example to .env
copy .env.example .env >nul

REM Update NODE_ENV to production using PowerShell
powershell -Command "(Get-Content .env) -replace 'NODE_ENV=development', 'NODE_ENV=production' | Set-Content .env"

REM Update rate limiting for production scale
powershell -Command "(Get-Content .env) -replace 'RATE_LIMIT_MAX=100', 'RATE_LIMIT_MAX=1000' | Set-Content .env"

echo ✅ Production .env file generated successfully!
echo.
echo 🔐 IMPORTANT: Review and update the following in .env:
echo    - DATABASE_URL (use your production Neon PostgreSQL URL)
echo    - REDIS_URL (use your production Redis Cloud URL)
echo    - JWT keys (AUTH_JWT_PRIVATE_KEY, AUTH_JWT_PUBLIC_KEY)
echo    - SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS)
echo    - FRONTEND_URLS (add your production frontend URLs)
echo    - All secret keys (ensure they are 32+ characters)
echo.
echo 📋 Please manually review the .env file for production values
pause
