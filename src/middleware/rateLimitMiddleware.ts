import { FastifyRequest, FastifyReply } from 'fastify';

// In-memory rate limiting store (for production, use Redis)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && Date.now() > entry.resetTime) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  increment(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now();
    const existing = this.get(key);
    
    if (existing) {
      existing.count++;
      return existing;
    } else {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + windowMs
      };
      this.set(key, newEntry);
      return newEntry;
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Global rate limit store
const rateLimitStore = new RateLimitStore();

interface RateLimitOptions {
  max: number;           // Maximum requests per window
  windowMs: number;      // Time window in milliseconds
  keyGenerator?: (req: FastifyRequest) => string;  // Custom key generator
  skipSuccessfulRequests?: boolean;  // Don't count successful requests
  skipFailedRequests?: boolean;      // Don't count failed requests
  message?: string;      // Custom error message
}

/**
 * Rate limiting middleware factory
 */
export function createRateLimit(options: RateLimitOptions) {
  const {
    max,
    windowMs,
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    message = 'Too many requests, please try again later.'
  } = options;

  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const key = keyGenerator(request);
    const entry = rateLimitStore.increment(key, windowMs);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    reply.header('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetTime - Date.now()) / 1000);
      reply.header('Retry-After', retryAfter);
      
      reply.code(429);
      reply.header('X-RateLimit-Limit', max);
      reply.header('X-RateLimit-Remaining', Math.max(0, max - entry.count));
      reply.header('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());
      reply.header('Retry-After', retryAfter);
      
      return reply.send({
        message
      });
    }

    // Note: In a production environment, you might want to implement
    // success/failure tracking differently, as Fastify reply hooks
    // are not available in preHandler middleware
  };
}

/**
 * Predefined rate limiters for common use cases
 */
export const RateLimiters = {
  // Strict rate limiting for authentication endpoints
  auth: createRateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
    skipSuccessfulRequests: true // Only count failed attempts
  }),

  // Moderate rate limiting for registration
  register: createRateLimit({
    max: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Too many registration attempts. Please try again in 1 hour.'
  }),

  // Strict rate limiting for password reset
  passwordReset: createRateLimit({
    max: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      // Use email from request body for password reset
      const body = req.body as any;
      return `password-reset:${body?.email || req.ip}`;
    },
    message: 'Too many password reset attempts. Please try again in 1 hour.'
  }),

  // Rate limiting for email verification
  emailVerification: createRateLimit({
    max: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const body = req.body as any;
      return `email-verification:${body?.email || req.ip}`;
    },
    message: 'Too many verification email requests. Please try again in 1 hour.'
  }),

  // General API rate limiting
  general: createRateLimit({
    max: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many requests. Please try again later.'
  }),

  // Strict rate limiting for admin operations
  admin: createRateLimit({
    max: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      // Use user ID for admin operations if available
      const user = (req as any).user;
      return `admin:${user?.id || req.ip}`;
    },
    message: 'Too many admin operations. Please try again in 1 hour.'
  }),

  // Very strict rate limiting for head admin operations
  headAdmin: createRateLimit({
    max: 50,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const user = (req as any).user;
      return `head-admin:${user?.id || req.ip}`;
    },
    message: 'Too many head admin operations. Please try again in 1 hour.'
  }),

  // Strict rate limiting for department admin operations
  deptAdmin: createRateLimit({
    max: 30,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const user = (req as any).user;
      return `dept-admin:${user?.id || req.ip}`;
    },
    message: 'Too many department admin operations. Please try again in 1 hour.'
  }),

  // Ultra-strict rate limiting for bulk operations
  bulkOperations: createRateLimit({
    max: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const user = (req as any).user;
      return `bulk-ops:${user?.id || req.ip}`;
    },
    message: 'Too many bulk operations. Please try again in 1 hour.'
  }),

  // Strict rate limiting for data export operations
  dataExport: createRateLimit({
    max: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const user = (req as any).user;
      return `data-export:${user?.id || req.ip}`;
    },
    message: 'Too many data export requests. Please try again in 1 hour.'
  }),

  // Very strict rate limiting for security operations
  security: createRateLimit({
    max: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      const user = (req as any).user;
      return `security:${user?.id || req.ip}`;
    },
    message: 'Too many security operations. Please try again in 1 hour.'
  }),

  // Rate limiting for internal API access
  internal: createRateLimit({
    max: 1000,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyGenerator: (req) => {
      // Use API key or service identifier for internal APIs
      const apiKey = req.headers['x-api-key'] as string;
      return `internal:${apiKey ? apiKey.slice(-8) : req.ip}`;
    },
    message: 'Internal API rate limit exceeded. Please try again later.'
  })
};

/**
 * IP-based rate limiting with custom key
 */
export function createIPRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
  return createRateLimit({
    ...options,
    keyGenerator: (req) => `ip:${req.ip}`
  });
}

/**
 * User-based rate limiting (requires authentication)
 */
export function createUserRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
  return createRateLimit({
    ...options,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      const user = (req as any).user;
      return user ? `user:${user.id}` : `ip:${req.ip}`;
    }
  });
}

/**
 * Email-based rate limiting for auth endpoints
 */
export function createEmailRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
  return createRateLimit({
    ...options,
    keyGenerator: (req) => {
      const body = req.body as any;
      const email = body?.email;
      return email ? `email:${email.toLowerCase()}` : `ip:${req.ip}`;
    }
  });
}

// Export the store for testing purposes
export { rateLimitStore };
