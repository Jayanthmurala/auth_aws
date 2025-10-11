import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { ZodTypeProvider, serializerCompiler, validatorCompiler, jsonSchemaTransform } from "fastify-type-provider-zod";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import collegeRoutes from "./routes/college.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import adminRoutes from "./admin/routes/index.js";
import monitoringRoutes from "./routes/monitoring.routes.js";
import securityRoutes from "./routes/security.routes.js";
import { getJWKS } from "./utils/jwt.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { responseWrapperPlugin, responseFormatMiddleware } from "./middleware/responseWrapper.js";
import { monitoringMiddleware } from "./middleware/monitoring.js";
import { CacheMiddlewares, CacheWarmer, cacheInvalidationMiddleware } from "./middleware/caching.js";
import { securityHeadersMiddleware } from "./middleware/advancedSecurity.js";
import { auditLoggingMiddleware } from "./middleware/auditLogger.js";
import { JWTKeyRotationService } from "./services/JWTKeyRotationService.js";
import { MFAService } from "./services/MFAService.js";
import { Logger } from "./utils/logger.js";
import keyManagementRoutes from "./routes/keyManagement.routes.js";
import mfaRoutes from "./routes/mfa.routes.js";
import healthRoutes from "./routes/health.routes.js";
import { InstanceRegistry } from "./utils/scalability.js";

async function buildServer() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  // Enable Zod validation/serialization
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Security middleware - helmet for security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow Swagger UI to work
  });

  // Rate limiting - protect against brute force attacks
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (req: any) => req.ip,
    errorResponseBuilder: (req: any, context: any) => ({
      success: false,
      error: {
        message: "Too many requests",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.round(context.ttl / 1000),
      },
    }),
  });

  // CORS configuration using environment variables
  await app.register(cors, {
    origin: env.FRONTEND_URLS.split(',').map(url => url.trim()),
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  await app.register(cookie);

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Response wrapper plugin - temporarily disabled to avoid Zod conflicts
  // await app.register(responseWrapperPlugin);

  // Response format middleware - temporarily disabled
  // app.addHook('onRequest', responseFormatMiddleware);

  // Monitoring middleware
  app.addHook('onRequest', monitoringMiddleware);

  // Additional security headers
  app.addHook('onRequest', securityHeadersMiddleware);

  // Audit logging middleware
  app.addHook('onRequest', auditLoggingMiddleware({
    excludePaths: ['/health', '/metrics', '/docs', '/'],
    includeBody: false, // Don't log request bodies for privacy
    sensitiveFields: ['password', 'token', 'secret', 'key']
  }));

  // Cache invalidation middleware for write operations
  app.addHook('onRequest', cacheInvalidationMiddleware(['users', 'colleges', 'auth']));

  // Cache middleware for specific routes - temporarily disabled for health endpoints
  app.addHook('onRequest', async (request, reply) => {
    // Apply caching based on route patterns
    // Temporarily disable health caching due to Zod schema conflicts
    // if (request.url.includes('/health') || request.url.includes('/metrics')) {
    //   await CacheMiddlewares.health(request, reply);
    // } else 
    if (request.url.includes('/colleges')) {
      await CacheMiddlewares.colleges(request, reply);
    } else if (request.url.includes('/version') || request.url.includes('/.well-known/')) {
      await CacheMiddlewares.publicData(request, reply);
    }
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { 
        title: "Nexus Auth Service API",
        version: "0.1.0",
        description: `
# Nexus Authentication Service

A comprehensive authentication and authorization service for the Nexus platform.

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication
- 👥 **Role-based Access Control** - Support for students, faculty, and admin roles
- 🏫 **Multi-college Support** - Manage users across multiple educational institutions
- 🛡️ **Security First** - Rate limiting, input validation, and security headers
- 📊 **Monitoring** - Health checks and performance metrics
- 🔄 **Real-time Updates** - WebSocket support for live notifications

## Authentication

All protected endpoints require a valid JWT token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Rate Limiting

API endpoints are rate-limited to prevent abuse:
- Authentication endpoints: 5 requests per 15 minutes
- General endpoints: 100 requests per 15 minutes

## Error Handling

All errors follow a consistent format with appropriate HTTP status codes.
        `,
        contact: {
          name: "Nexus Development Team",
          email: "support@nexus.edu"
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT"
        }
      },
      servers: [
        { 
          url: `http://localhost:${env.PORT}`,
          description: "Development server"
        },
        {
          url: "https://api.nexus.edu",
          description: "Production server"
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token obtained from login endpoint'
          }
        },
        responses: {
          UnauthorizedError: {
            description: 'Authentication required',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                      type: 'object',
                      properties: {
                        message: { type: 'string', example: 'Authentication required' },
                        code: { type: 'string', example: 'UNAUTHORIZED' },
                        timestamp: { type: 'string', example: '2024-01-15T10:30:00Z' }
                      }
                    }
                  }
                }
              }
            }
          },
          ValidationError: {
            description: 'Validation failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                      type: 'object',
                      properties: {
                        message: { type: 'string', example: 'Validation failed' },
                        code: { type: 'string', example: 'VALIDATION_ERROR' },
                        validationErrors: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              field: { type: 'string', example: 'email' },
                              message: { type: 'string', example: 'Invalid email format' }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          RateLimitError: {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                      type: 'object',
                      properties: {
                        message: { type: 'string', example: 'Too many requests' },
                        code: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
                        details: {
                          type: 'object',
                          properties: {
                            retryAfter: { type: 'number', example: 900 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { 
          name: "auth", 
          description: "Authentication and authorization endpoints",
          externalDocs: {
            description: "Authentication Guide",
            url: "https://docs.nexus.edu/auth"
          }
        },
        { 
          name: "colleges", 
          description: "College management endpoints" 
        },
        { 
          name: "head-admin", 
          description: "HEAD_ADMIN management endpoints - highest level administration" 
        },
        { 
          name: "dept-admin", 
          description: "DEPT_ADMIN management endpoints - department level administration" 
        },
        { 
          name: "placements-admin", 
          description: "PLACEMENTS_ADMIN management endpoints - placement coordination" 
        },
        { 
          name: "monitoring", 
          description: "Health checks, metrics, and monitoring endpoints",
          externalDocs: {
            description: "Monitoring Guide",
            url: "https://docs.nexus.edu/monitoring"
          }
        },
        { name: "security", description: "Security management and CSRF token endpoints" },
        { name: "key-management", description: "JWT key rotation and management endpoints (Super Admin only)" },
        { name: "mfa", description: "Multi-Factor Authentication endpoints for enhanced security" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });
  app.get("/.well-known/jwks.json", async () => await getJWKS());

  // Initialize instance registry for load balancing
  await InstanceRegistry.initialize(app);

  // Register routes
  await app.register(healthRoutes); // Health checks first for load balancers
  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(collegeRoutes);
  await app.register(securityRoutes);
  await app.register(keyManagementRoutes);
  await app.register(mfaRoutes);

  // Initialize JWT Key Rotation Service
  await JWTKeyRotationService.initialize({
    rotationIntervalHours: 24 * 7, // Weekly rotation
    keyOverlapHours: 24, // 24-hour overlap
    maxActiveKeys: 3,
    algorithm: 'RS256',
    keySize: 2048
  });

  // Initialize MFA Service
  await MFAService.initialize({
    enforceForRoles: ['HEAD_ADMIN', 'SUPER_ADMIN'],
    enforceForNewUsers: false,
    gracePeriodDays: 7,
    allowedMethods: ['totp', 'sms', 'backup_codes'],
    requireMultipleMethods: false,
    maxBackupCodes: 10
  });

  // Warm cache with frequently accessed data
  await CacheWarmer.warmCache();

  return app;
}

// Export the buildServer function for testing
export default buildServer;

// Start the server
buildServer()
  .then((app) => {
    // Graceful shutdown handling
    const gracefulShutdown = (signal: string) => {
      Logger.info(`Received ${signal}, shutting down gracefully...`, { operation: 'shutdown', signal });
      
      // Shutdown JWT Key Rotation Service
      JWTKeyRotationService.shutdown();
      
      app.close(() => {
        Logger.info('Auth service shutdown complete', { operation: 'shutdown' });
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return app.listen({ port: env.PORT, host: "0.0.0.0" });
  })
  .then((address) => {
    Logger.info(`Auth service listening at ${address}`, { 
      operation: 'startup', 
      address, 
      port: env.PORT,
      nodeEnv: env.NODE_ENV 
    });
    Logger.info('JWT Key Rotation Service initialized with weekly rotation', { 
      operation: 'startup',
      service: 'jwt_key_rotation' 
    });
  })
  .catch((err) => {
    Logger.error('Failed to start auth service', err instanceof Error ? err : new Error(String(err)), { operation: 'startup' });
    process.exit(1);
  });
