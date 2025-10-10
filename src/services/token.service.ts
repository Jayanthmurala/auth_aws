import crypto from "node:crypto";
import { prisma } from "../db";
import { TokenType } from "@prisma/client";
import { hashSecret, verifySecret } from "../utils/crypto";
import { env } from "../config/env";
import { Logger } from "../utils/logger";
import { RedisManager } from "../config/redis";

const REFRESH_COOKIE = "rt";

export function getRefreshCookieName() {
  return REFRESH_COOKIE;
}

export function getRefreshCookieOptions() {
  const maxAgeDays = parseExpiryToDays(env.AUTH_JWT_REFRESH_EXPIRES_IN);
  return {
    httpOnly: true,
    secure: env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    domain: env.COOKIE_DOMAIN,
    maxAge: maxAgeDays * 24 * 60 * 60,
  };
}

function parseExpiryToDays(exp: string): number {
  // very small parser supporting d/h/m
  const match = exp.match(/^(\d+)([dhm])$/);
  if (!match) return 30;
  const val = Number(match[1]);
  const unit = match[2];
  if (unit === "d") return val;
  if (unit === "h") return Math.ceil(val / 24);
  return Math.ceil(val / (24 * 60));
}

export async function issueRefreshToken(userId: string) {
  const tokenId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  const value = `${tokenId}.${secret}`;
  const secretHash = await hashSecret(secret);
  const expiresAt = new Date(Date.now() + parseExpiryToDays(env.AUTH_JWT_REFRESH_EXPIRES_IN) * 24 * 60 * 60 * 1000);

  await prisma.securityToken.create({
    data: {
      id: tokenId,
      userId,
      tokenHash: secretHash,
      type: TokenType.REFRESH_TOKEN,
      expiresAt,
    },
  });

  return { token: value, expiresAt };
}

export async function rotateRefreshToken(oldValue: string, clientInfo?: {
  ip?: string;
  userAgent?: string;
}) {
  const parsed = parseRefreshToken(oldValue);
  if (!parsed) {
    Logger.security('Invalid refresh token format', {
      severity: 'medium',
      event: 'refresh_token_invalid_format',
      ...clientInfo
    });
    return null;
  }

  const record = await prisma.securityToken.findUnique({ where: { id: parsed.id } });
  
  if (!record || record.type !== TokenType.REFRESH_TOKEN) {
    Logger.security('Refresh token not found', {
      severity: 'medium',
      event: 'refresh_token_not_found',
      tokenId: parsed.id,
      ...clientInfo
    });
    return null;
  }

  if (record.usedAt) {
    // Token reuse detected - potential security breach
    Logger.security('Refresh token reuse detected - revoking all user tokens', {
      severity: 'high',
      event: 'refresh_token_reuse',
      userId: record.userId,
      tokenId: parsed.id,
      originalUsedAt: record.usedAt,
      ...clientInfo
    });
    
    // Revoke all refresh tokens for this user as a security measure
    await revokeAllRefreshTokens(record.userId);
    
    // Also blacklist any active access tokens for this user
    try {
      if (!env.REDIS_DISABLED) {
        const redis = RedisManager.getInstance();
        await redis.setex(`user_revoked:${record.userId}`, 86400, JSON.stringify({
          reason: 'refresh_token_reuse_detected',
          timestamp: new Date().toISOString(),
          ...clientInfo
        }));
      }
    } catch (error) {
      Logger.error('Failed to blacklist user tokens after reuse detection', 
        error instanceof Error ? error : new Error(String(error)));
    }
    
    return null;
  }

  if (record.expiresAt < new Date()) {
    Logger.security('Expired refresh token used', {
      severity: 'low',
      event: 'refresh_token_expired',
      userId: record.userId,
      tokenId: parsed.id,
      expiredAt: record.expiresAt,
      ...clientInfo
    });
    return null;
  }

  const ok = await verifySecret(record.tokenHash, parsed.secret);
  if (!ok) {
    Logger.security('Invalid refresh token secret', {
      severity: 'high',
      event: 'refresh_token_invalid_secret',
      userId: record.userId,
      tokenId: parsed.id,
      ...clientInfo
    });
    return null;
  }

  // Mark the old token as used
  await prisma.securityToken.update({ 
    where: { id: parsed.id }, 
    data: { usedAt: new Date() } 
  });

  // Issue new refresh token
  const newToken = await issueRefreshToken(record.userId);
  
  Logger.auth('Refresh token rotated successfully', {
    userId: record.userId,
    action: 'refresh',
    success: true,
    oldTokenId: parsed.id,
    newTokenId: newToken.token.split('.')[0],
    ...clientInfo
  });

  return newToken;
}

export function parseRefreshToken(value: string | undefined | null): { id: string; secret: string } | null {
  if (!value) return null;
  const [id, secret] = value.split(".");
  if (!id || !secret) return null;
  return { id, secret };
}

export async function revokeAllRefreshTokens(userId: string) {
  await prisma.securityToken.updateMany({
    where: { userId, type: TokenType.REFRESH_TOKEN, usedAt: null },
    data: { usedAt: new Date() },
  });
}
