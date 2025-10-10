import 'dotenv/config';
import { Client } from 'pg';

async function run(client: Client, sql: string) {
  await client.query(sql);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const schema = 'authsvc';

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('Connecting to Neon...');
    await run(client, `CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await run(client, `SET search_path TO ${schema}`);
    await run(client, `CREATE EXTENSION IF NOT EXISTS citext`);

    // Enums (idempotent)
    await run(
      client,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'role' AND n.nspname = current_schema()
        ) THEN
          CREATE TYPE role AS ENUM ('STUDENT','FACULTY','DEPT_ADMIN','PLACEMENTS_ADMIN','HEAD_ADMIN');
        END IF;
      END$$;`
    );

    await run(
      client,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'user_status' AND n.nspname = current_schema()
        ) THEN
          CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','DELETED');
        END IF;
      END$$;`
    );

    await run(
      client,
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'token_type' AND n.nspname = current_schema()
        ) THEN
          CREATE TYPE token_type AS ENUM ('EMAIL_VERIFICATION','PASSWORD_RESET','REFRESH_TOKEN');
        END IF;
      END$$;`
    );

    // Tables
    await run(
      client,
      `CREATE TABLE IF NOT EXISTS "User" (
        id TEXT PRIMARY KEY,
        email CITEXT NOT NULL UNIQUE,
        "emailVerifiedAt" TIMESTAMPTZ,
        "passwordHash" TEXT,
        "displayName" TEXT NOT NULL,
        "avatarUrl" TEXT,
        roles role[] NOT NULL DEFAULT '{}',
        status user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
        "tokenVersion" INTEGER NOT NULL DEFAULT 0,
        "lastLoginAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMPTZ
      );`
    );

    await run(
      client,
      `CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User" (status);
       CREATE INDEX IF NOT EXISTS "User_emailVerifiedAt_idx" ON "User" ("emailVerifiedAt");`
    );

    await run(
      client,
      `CREATE TABLE IF NOT EXISTS "OAuthAccount" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        provider TEXT NOT NULL,
        "providerAccountId" TEXT NOT NULL,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "expiresAt" TIMESTAMPTZ,
        CONSTRAINT "OAuthAccount_user_fk" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE,
        CONSTRAINT "OAuthAccount_provider_unique" UNIQUE (provider, "providerAccountId")
      );`
    );

    await run(
      client,
      `CREATE INDEX IF NOT EXISTS "OAuthAccount_userId_idx" ON "OAuthAccount" ("userId");`
    );

    await run(
      client,
      `CREATE TABLE IF NOT EXISTS "SecurityToken" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL UNIQUE,
        type token_type NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "usedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "SecurityToken_user_fk" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
      );`
    );

    await run(
      client,
      `CREATE INDEX IF NOT EXISTS "SecurityToken_user_type_expires_idx" ON "SecurityToken" ("userId", type, "expiresAt");`
    );

    await run(
      client,
      `CREATE TABLE IF NOT EXISTS "UserPreference" (
        "userId" TEXT PRIMARY KEY,
        "enableEmailNotifications" BOOLEAN NOT NULL DEFAULT true,
        "enableInAppNotifications" BOOLEAN NOT NULL DEFAULT true,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        locale TEXT NOT NULL DEFAULT 'en',
        CONSTRAINT "UserPreference_user_fk" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
      );`
    );

    console.log('Migration completed for schema', schema);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
