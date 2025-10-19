import type { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../config/env.js";
import { Role, UserStatus } from "@prisma/client";
import { hashPassword, verifyPassword, hashSecret, verifySecret } from "../utils/crypto.js";
import { signAccessToken, verifyAccessToken, blacklistToken } from "../utils/jwt.js";
import { Logger } from "../utils/logger.js";
import { InputSanitizers, createXSSValidator } from "../middleware/inputSanitization.js";
import { validatePassword, DEFAULT_PASSWORD_POLICY, getPasswordStrengthText } from "../utils/passwordValidation.js";
import { findUserByEmail, withPerformanceMonitoring } from "../utils/queryOptimization.js";
import { CacheConfigs } from "../middleware/responseCaching.js";
import { authSuccessResponseSchema, loginBodySchema, errorResponseSchema, authErrorResponseSchema, oauthExchangeBodySchema, forgotPasswordBodySchema, resetPasswordBodySchema, verifyEmailBodySchema, resendVerificationBodySchema, messageResponseSchema, registerBodySchema } from "../schemas/auth.schemas.js";
import { ProfileInitializationService } from "../services/ProfileInitializationService.js";
import { authenticateUser, authenticateApiKey } from "../middleware/authMiddleware.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../emails/simple-mailer.js";
import { RateLimiters, createEmailRateLimit } from "../middleware/rateLimitMiddleware.js";
import { rotateRefreshToken as rotateRefreshTokenService } from "../services/token.service.js";

const usersQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  q: z.string().optional(),
  role: z.enum(["STUDENT", "FACULTY"]).optional(),
});

const REFRESH_COOKIE = "rt";

function parseExpiryToMs(input: string): number {
  const m = input.trim().match(/^(\d+)([smhd])$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "s": return n * 1000;
    case "m": return n * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    case "d": return n * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

function buildCookieOptions(expiresAt: Date) {
  const secure = env.NODE_ENV === "production";
  const opts: any = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
  if (env.COOKIE_DOMAIN) {
    opts.domain = env.COOKIE_DOMAIN;
  }
  return opts;
}

async function issueRefreshTokenCookie(userId: string, reply: any) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const expiresInMs = parseExpiryToMs(env.AUTH_JWT_REFRESH_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + (expiresInMs || 30 * 24 * 60 * 60 * 1000));

  const token = await prisma.securityToken.create({
    data: {
      userId,
      tokenHash: await hashSecret(secret),
      type: "REFRESH_TOKEN",
      expiresAt,
    },
  });

  const cookieVal = `${token.id}.${secret}`;
  reply.setCookie(REFRESH_COOKIE, cookieVal, buildCookieOptions(expiresAt));
}

async function rotateRefreshToken(oldCookie: string | undefined, reply: any) {
  if (!oldCookie) return null;
  const [id, secret] = oldCookie.split(".");
  if (!id || !secret) return null;

  const record = await prisma.securityToken.findUnique({ where: { id } });
  if (!record || record.type !== "REFRESH_TOKEN") return null;
  if (record.usedAt || record.expiresAt < new Date()) return null;

  const ok = await verifySecret(record.tokenHash, secret);
  if (!ok) return null;

  // mark old token used and create a new one (rotation)
  await prisma.securityToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  await issueRefreshTokenCookie(record.userId, reply);
  return record.userId;
}

// Fetch minimal profile from OAuth providers
async function initializeUserProfile(userId: string, accessToken: string) {
  const profileServiceUrl = process.env.PROFILE_SERVICE_URL || "http://localhost:4002";
  
  try {
    const response = await fetch(`${profileServiceUrl}/v1/profiles/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}), // Empty profile data to initialize
    });

    if (!response.ok) {
      throw new Error(`Profile initialization failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Profile initialization error:", error);
    throw error;
  }
}

async function getGoogleProfile(accessToken: string) {
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  const j: any = await resp.json();
  return {
    providerId: j.sub as string,
    email: j.email as string | null,
    emailVerified: Boolean(j.email_verified),
    name: (j.name as string) || null,
    avatarUrl: (j.picture as string) || null,
  };
}

async function getGithubProfile(accessToken: string) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "nexus-auth-service",
    Accept: "application/vnd.github+json",
  } as any;
  const uResp = await fetch("https://api.github.com/user", { headers });
  if (!uResp.ok) return null;
  const u: any = await uResp.json();
  let email: string | null = u.email ?? null;
  if (!email) {
    const eResp = await fetch("https://api.github.com/user/emails", { headers });
    if (eResp.ok) {
      const emails: any[] = await eResp.json();
      const primary = Array.isArray(emails)
        ? emails.find((e: any) => e.primary && e.verified) || emails.find((e: any) => e.verified) || emails[0]
        : null;
      email = primary?.email ?? null;
    }
  }
  return {
    providerId: String(u.id),
    email,
    emailVerified: true,
    name: (u.name as string) || (u.login as string) || null,
    avatarUrl: (u.avatar_url as string) || null,
  };
}

async function authRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // GET /v1/auth/me  // Get current user profile (cached for performance)
  f.get("/v1/auth/me", {
    preHandler: [authenticateUser, CacheConfigs.userSpecific],
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      response: {
        200: z.object({
          id: z.string(),
          email: z.string(),
          displayName: z.string(),
          roles: z.array(z.string()),
          collegeId: z.string().optional(),
          collegeMemberId: z.string().optional(),
          isEmailVerified: z.boolean(),
          createdAt: z.string(),
          updatedAt: z.string()
        }),
        401: errorResponseSchema
      }
    }
  }, async (req, reply) => {
    // User is already authenticated and populated by middleware
    const user = req.user!;
    
    // Fetch additional fields not in middleware
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        collegeId: true,
        collegeMemberId: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    if (!fullUser) {
      return reply.code(401).send({ 
        message: 'User not found'
      });
    }
    
    return reply.send({
      id: fullUser.id,
      email: fullUser.email,
      displayName: fullUser.displayName,
      roles: fullUser.roles,
      collegeId: fullUser.collegeId || undefined,
      collegeMemberId: fullUser.collegeMemberId || undefined,
      isEmailVerified: !!fullUser.emailVerifiedAt,
      createdAt: fullUser.createdAt.toISOString(),
      updatedAt: fullUser.updatedAt.toISOString()
    });
  });

  // Password validation endpoint for real-time feedback
  f.post("/v1/auth/validate-password", {
    preHandler: [RateLimiters.general],
    schema: {
      tags: ["auth"],
      body: z.object({
        password: z.string(),
        email: z.string().email().optional(),
        displayName: z.string().optional()
      }),
      response: {
        200: z.object({
          isValid: z.boolean(),
          score: z.number(),
          strength: z.string(),
          errors: z.array(z.string()),
          warnings: z.array(z.string()),
          suggestions: z.array(z.string())
        })
      }
    }
  }, async (req, reply) => {
    const { password, email, displayName } = req.body;
    
    const validation = validatePassword(password, DEFAULT_PASSWORD_POLICY, {
      email,
      displayName,
      firstName: displayName?.split(' ')[0],
      lastName: displayName?.split(' ').slice(1).join(' ')
    });

    return reply.send({
      isValid: validation.isValid,
      score: validation.score,
      strength: getPasswordStrengthText(validation.score),
      errors: validation.errors,
      warnings: validation.warnings,
      suggestions: validation.suggestions
    });
  });

  f.post("/v1/auth/register", {
    preHandler: [RateLimiters.register, InputSanitizers.strict, createXSSValidator()],
    schema: {
      tags: ["auth"],
      body: registerBodySchema,
      response: { 201: authSuccessResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema },
    },
  }, async (req, reply) => {
    const { displayName, email, password, role, collegeId, department, collegeMemberId, year } = req.body as z.infer<typeof registerBodySchema>;
    
    try {
      // Validate password complexity
      const passwordValidation = validatePassword(password, DEFAULT_PASSWORD_POLICY, {
        email,
        displayName,
        firstName: displayName.split(' ')[0],
        lastName: displayName.split(' ').slice(1).join(' ')
      });

      if (!passwordValidation.isValid) {
        return reply.code(400).send({
          message: `Password does not meet security requirements: ${passwordValidation.errors.join(', ')}`
        });
      }

      if (passwordValidation.score < 60) {
        Logger.security('Weak password used in registration', {
          severity: 'medium',
          event: 'weak_password_registration',
          score: passwordValidation.score,
          email: email.substring(0, 3) + '***' // Partial email for logging
        });
      }

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return reply.code(409).send({ 
          message: `Registration failed: The email address '${email}' is already registered. Please use a different email or try logging in.` 
        });
      }

      // Validate college exists and is active
      const college = await prisma.college.findUnique({ where: { id: collegeId } });
      if (!college) {
        return reply.code(400).send({ 
          message: `Registration failed: College with ID '${collegeId}' not found. Please contact your administrator or verify the college ID.` 
        });
      }
      if (!college.isActive) {
        return reply.code(400).send({ 
          message: `Registration failed: College '${college.name}' is currently inactive. Please contact your administrator.` 
        });
      }

      // Validate department exists in college
      if (!college.departments.includes(department)) {
        return reply.code(400).send({ 
          message: `Registration failed: Department '${department}' is not available in '${college.name}'. Available departments: ${college.departments.join(', ')}.` 
        });
      }

      // Check if collegeMemberId is unique within the college (if provided)
      if (collegeMemberId) {
        const existingMember = await prisma.user.findFirst({
          where: {
            collegeId,
            collegeMemberId,
          },
        });
        if (existingMember) {
          return reply.code(409).send({ 
            message: `Registration failed: College member ID '${collegeMemberId}' already exists in '${college.name}'. Please use a different member ID.` 
          });
        }
      }

      // Validate year is provided for students
      if (role === "STUDENT" && !year) {
        return reply.code(400).send({ 
          message: "Registration failed: Year is required for student registration. Please provide your academic year (1-6)." 
        });
      }
    } catch (validationError: any) {
      // Handle Zod validation errors with clear field-specific messages
      if (validationError.issues) {
        const fieldErrors = validationError.issues.map((issue: any) => {
          const field = issue.path.join('.');
          switch (field) {
            case 'email':
              return `Email: ${issue.message.toLowerCase()}. Please provide a valid email address.`;
            case 'password':
              return `Password: Must be at least 8 characters long.`;
            case 'displayName':
              return `Display Name: ${issue.message.toLowerCase()}. Please provide your full name.`;
            case 'collegeId':
              return `College: This field is required. Please select your college.`;
            case 'department':
              return `Department: This field is required. Please select your department.`;
            case 'role':
              return `Role: Invalid role selected. Available roles: STUDENT, FACULTY.`;
            case 'year':
              return `Year: Must be a number between 1 and 6.`;
            default:
              return `${field}: ${issue.message}`;
          }
        });
        
        return reply.code(400).send({ 
          message: `Registration failed due to validation errors:\nâ€¢ ${fieldErrors.join('\nâ€¢ ')}` 
        });
      }
      
      return reply.code(400).send({ 
        message: "Registration failed: Invalid request data. Please check all required fields and try again." 
      });
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        displayName,
        roles: [role],
        status: "ACTIVE",
        collegeId,
        department,
        year: role === "STUDENT" ? year : undefined,
        collegeMemberId,
        preferences: { create: {} },
      },
    });

    // Log registration success
    Logger.auth('User registered successfully', {
      userId: user.id,
      action: 'register',
      success: true
    }, req);

    const accessToken = await signAccessToken(user.id, {
      email: user.email,
      roles: user.roles,
      displayName: user.displayName,
      profile: {
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
      },
    });

    await issueRefreshTokenCookie(user.id, reply);

    // Initialize user profile asynchronously for new registration
    ProfileInitializationService.initializeUserProfileAsync({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      avatarUrl: user.avatarUrl,
      collegeId: user.collegeId,
      department: user.department,
      year: user.year,
      collegeMemberId: user.collegeMemberId,
    });

    return reply.code(201).send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        avatarUrl: user.avatarUrl ?? null,
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
        collegeMemberId: user.collegeMemberId,
      },
    });
  });

  // OAuth exchange: client sends provider accessToken; we return backend-issued tokens
  f.post("/v1/auth/oauth/exchange", {
    schema: {
      tags: ["auth"],
      body: oauthExchangeBodySchema,
      response: { 200: authSuccessResponseSchema, 400: errorResponseSchema, 403: authErrorResponseSchema },
    },
  }, async (req, reply) => {
    const { provider, accessToken: providerToken } = req.body as z.infer<typeof oauthExchangeBodySchema>;
    let profile: any = null;
    try {
      profile = provider === "google" ? await getGoogleProfile(providerToken) : await getGithubProfile(providerToken);
    } catch {
      profile = null;
    }
    if (!profile || !profile.email) {
      return reply.code(400).send({ message: "Invalid provider token or email not available" });
    }

    // Find existing user by email - DO NOT CREATE NEW USERS
    let user = await prisma.user.findUnique({ 
      where: { email: profile.email },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        roles: true,
        status: true,
        collegeId: true,
        department: true,
        year: true,
        tokenVersion: true,
        deletedAt: true
      }
    });
    
    if (!user) {
      // User doesn't exist - reject OAuth login
      Logger.security('OAuth login attempt for non-existing user', {
        severity: 'medium',
        event: 'oauth_user_not_found',
        email: profile.email.substring(0, 3) + '***', // Partial email for logging
        provider
      });
      return reply.code(403).send({ 
        message: "Account not found. Contact your administrator to create an account.",
        code: "ACCOUNT_NOT_FOUND"
      });
    }

    // Check if user account is active
    if (user.status !== "ACTIVE" || user.deletedAt) {
      Logger.security('OAuth login attempt for inactive user', {
        severity: 'medium',
        event: 'oauth_inactive_user',
        userId: user.id,
        status: user.status,
        provider
      });
      return reply.code(403).send({ 
        message: "Account is not active. Contact your administrator.",
        code: "ACCOUNT_INACTIVE"
      });
    }

    // Upsert OAuthAccount link
    await prisma.oAuthAccount.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerId } },
      update: { userId: user.id, accessToken: providerToken },
      create: { userId: user.id, provider, providerAccountId: profile.providerId, accessToken: providerToken },
    });

    const accessToken = await signAccessToken(user.id, {
      email: user.email,
      roles: user.roles,
      displayName: user.displayName,
      tokenVersion: user.tokenVersion,
      // profile: {
      //   collegeId: user.collegeId,
      //   department: user.department,
      //   year: user.year,
      // },
      profile: {
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
      },
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await issueRefreshTokenCookie(user.id, reply);

    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        avatarUrl: user.avatarUrl ?? null,
        collegeId: user.collegeId ?? null,
        department: user.department ?? null,
        year: user.year ?? null,
      },
    });
  });

  // Token refresh endpoint
  f.post("/v1/auth/refresh", {
    schema: {
      tags: ["auth"],
      response: { 200: authSuccessResponseSchema, 401: errorResponseSchema },
    },
  }, async (req, reply) => {
    const oldCookie = req.cookies[REFRESH_COOKIE];
    const result = await rotateRefreshTokenService(oldCookie || '', {
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string
    });
    
    if (!result) {
      return reply.code(401).send({ message: "Invalid or expired refresh token" });
    }

    // Set the new refresh token cookie
    reply.setCookie(REFRESH_COOKIE, result.token, buildCookieOptions(result.expiresAt));
    
    // Get user ID from the new token
    const tokenId = result.token.split('.')[0];
    const tokenRecord = await prisma.securityToken.findUnique({
      where: { id: tokenId },
      select: { userId: true }
    });
    
    if (!tokenRecord) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }

    const user = await prisma.user.findUnique({ where: { id: tokenRecord.userId } });
    if (!user) {
      return reply.code(401).send({ message: "User not found" });
    }

    // Log login success
    Logger.auth('User logged in successfully', {
      userId: user.id,
      action: 'login',
      success: true
    }, req);

    const accessToken = await signAccessToken(user.id, {
      email: user.email,
      roles: user.roles,
      displayName: user.displayName,
      profile: {
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
      },
    });

    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        avatarUrl: user.avatarUrl ?? null,
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
        collegeMemberId: user.collegeMemberId,
      },
    });
  });

  // Logout endpoint with token blacklisting
  f.post("/v1/auth/logout", {
    preHandler: [authenticateUser],
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      response: { 200: z.object({ success: z.boolean(), message: z.string() }) },
    },
  }, async (req: any, reply: any) => {
    const userId = req.user!.id;
    
    try {
      // Extract and blacklist the access token
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const accessToken = authHeader.substring(7);
        
        // Verify token to get expiry (we need this for TTL)
        try {
          const payload = await verifyAccessToken(accessToken);
          const expiresAt = new Date(payload.exp! * 1000);
          
          // Blacklist the access token
          await blacklistToken(accessToken, expiresAt);
        } catch (tokenError) {
          // Token might already be invalid, but continue with logout
          req.log.warn({ error: tokenError }, 'Failed to blacklist token during logout');
        }
      }
      
      // Mark current refresh token used
      const raw = req.cookies[REFRESH_COOKIE];
      if (raw) {
        const id = raw.split(".")[0];
        await prisma.securityToken.updateMany({ 
          where: { 
            id,
            userId // Ensure we only invalidate tokens for the authenticated user
          }, 
          data: { usedAt: new Date() } 
        });
      }
      
      // Clear the refresh token cookie
      const cookieOptions = {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
      };
      
      if (env.COOKIE_DOMAIN) {
        (cookieOptions as any).domain = env.COOKIE_DOMAIN;
      }
      
      reply.clearCookie(REFRESH_COOKIE, cookieOptions);
      
      // Log logout (without sensitive data)
      req.log.info({
        userId,
        action: 'logout',
        timestamp: new Date().toISOString()
      }, 'User logged out successfully');
      
      reply.send({ 
        success: true, 
        message: 'Logged out successfully' 
      });
      
    } catch (error) {
      req.log.error({ error, userId }, 'Logout failed');
      reply.status(500).send({
        success: false,
        error: 'Logout failed'
      });
    }
  });

  f.post("/v1/auth/login", {
    preHandler: [RateLimiters.auth, InputSanitizers.strict, createXSSValidator()],
    schema: {
      tags: ["auth"],
      body: loginBodySchema,
      response: { 200: authSuccessResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 429: errorResponseSchema },
    },
  }, async (req: any, reply: any) => {
    const { email, password } = req.body as z.infer<typeof loginBodySchema>;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await issueRefreshTokenCookie(user.id, reply);

    // Initialize user profile asynchronously (doesn't block login)
    ProfileInitializationService.initializeUserProfileAsync({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      avatarUrl: user.avatarUrl,
      collegeId: user.collegeId,
      department: user.department,
      year: user.year,
      collegeMemberId: user.collegeMemberId,
    });

    const accessToken = await signAccessToken(user.id, {
      email: user.email,
      roles: user.roles,
      displayName: user.displayName,
      profile: {
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
      },
    });

    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        avatarUrl: user.avatarUrl ?? null,
        collegeId: user.collegeId,
        department: user.department,
        year: user.year,
        collegeMemberId: user.collegeMemberId,
      },
    });
  });
}

export default authRoutes;
