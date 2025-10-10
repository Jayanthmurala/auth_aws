import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function requireSecret(name: string, minLength: number = 32): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in all environments`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters`);
  }
  // Validate entropy for production
  if (process.env.NODE_ENV === 'production') {
    if (value.includes('dev-') || value.includes('fallback') || value.includes('change-in-production')) {
      throw new Error(`${name} contains insecure fallback value in production`);
    }
    // Ensure proper base64 encoding for secrets
    if (name.includes('SECRET') || name.includes('KEY')) {
      if (!/^[A-Za-z0-9+/=]{32,}$/.test(value)) {
        throw new Error(`${name} must be a properly encoded secret in production`);
      }
    }
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4001),
  DATABASE_URL: requireEnv("DATABASE_URL"),
  
  // Support keys stored in .env with escaped newlines ("\n")
  AUTH_JWT_PRIVATE_KEY: requireEnv("AUTH_JWT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  AUTH_JWT_PUBLIC_KEY: requireEnv("AUTH_JWT_PUBLIC_KEY").replace(/\\n/g, "\n"),
  AUTH_JWT_KID: process.env.AUTH_JWT_KID ?? "auth-key-1",
  AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER ?? "nexus-auth",
  AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE ?? "nexus",
  AUTH_JWT_ACCESS_EXPIRES_IN: process.env.AUTH_JWT_ACCESS_EXPIRES_IN ?? "15m",
  AUTH_JWT_REFRESH_EXPIRES_IN: process.env.AUTH_JWT_REFRESH_EXPIRES_IN ?? "30d",

  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN ?? "",

  // Frontend origin for building verification/reset URLs
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",
  
  // CORS origins (comma-separated)
  FRONTEND_URLS: process.env.FRONTEND_URLS ?? "http://localhost:3000,http://127.0.0.1:3000",
  
  // Rate limiting
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 100),
  RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW ?? "15 minutes",
  
  // Redis configuration
  REDIS_URL: process.env.REDIS_URL ?? "",
  REDIS_DISABLED: /^(true|1)$/i.test(String(process.env.REDIS_DISABLED ?? "true")),
  
  // Redis Cluster (for production scale)
  REDIS_CLUSTER_NODES: process.env.REDIS_CLUSTER_NODES ?? "",
  REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? "",

  // Internal API Key for cron jobs and internal services
  INTERNAL_API_KEY: requireSecret("INTERNAL_API_KEY", 32),
  
  // Internal API Secret for HMAC request signing
  INTERNAL_API_SECRET: requireSecret("INTERNAL_API_SECRET", 64),
  
  // CSRF Secret for token generation
  CSRF_SECRET: requireSecret("CSRF_SECRET", 32),

  // One-time token expirations
  EMAIL_VERIFICATION_EXPIRES_IN: process.env.EMAIL_VERIFICATION_EXPIRES_IN ?? "24h",
  PASSWORD_RESET_EXPIRES_IN: process.env.PASSWORD_RESET_EXPIRES_IN ?? "1h",

  // Mailing configuration
  APP_NAME: process.env.APP_NAME ?? "Nexus",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "Nexus <no-reply@localhost>",
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL ?? "support@localhost",
  SMTP_HOST: process.env.SMTP_HOST ?? "",
  SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
  SMTP_SECURE: /^(true|1)$/i.test(String(process.env.SMTP_SECURE ?? "false")),
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",

  // Admin confirmation settings
  CONFIRMATION_TOKEN_TIMEOUT_MINUTES: process.env.CONFIRMATION_TOKEN_TIMEOUT_MINUTES ?? "10",
  MFA_CHALLENGE_TIMEOUT_MINUTES: process.env.MFA_CHALLENGE_TIMEOUT_MINUTES ?? "5",
  MAX_BULK_OPERATION_SIZE: Number(process.env.MAX_BULK_OPERATION_SIZE ?? 1000),

  // Export encryption key - REQUIRED: 32+ characters
  EXPORT_ENCRYPTION_KEY: requireSecret('EXPORT_ENCRYPTION_KEY', 32),

  // Database scaling configuration
  DATABASE_READ_REPLICAS: process.env.DATABASE_READ_REPLICAS,
  DB_CONNECTION_LIMIT: process.env.DB_CONNECTION_LIMIT || '100',
  DB_CONNECTION_TIMEOUT: process.env.DB_CONNECTION_TIMEOUT || '5000',
};
