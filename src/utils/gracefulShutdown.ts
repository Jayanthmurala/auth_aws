import { FastifyInstance } from 'fastify';
import { Logger } from './logger';
import { DatabaseManager } from '../config/database';
import { RedisManager } from '../config/redis';
import { JWTKeyRotationService } from '../services/JWTKeyRotationService';
import { InstanceRegistry } from './scalability';

/**
 * Graceful shutdown manager for clean application termination
 */

export interface ShutdownConfig {
  gracePeriod: number;        // Time to wait for connections to close (ms)
  forceExitTimeout: number;   // Maximum time before force exit (ms)
  signals: string[];          // Signals to handle
}

const DEFAULT_CONFIG: ShutdownConfig = {
  gracePeriod: 10000,         // 10 seconds
  forceExitTimeout: 30000,    // 30 seconds
  signals: ['SIGTERM', 'SIGINT', 'SIGUSR2']
};

/**
 * Graceful shutdown manager
 */
export class GracefulShutdown {
  private static instance: GracefulShutdown | null = null;
  private config: ShutdownConfig;
  private app: FastifyInstance | null = null;
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownHandlers: Array<() => Promise<void>> = [];

  private constructor(config: Partial<ShutdownConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<ShutdownConfig>): GracefulShutdown {
    if (!this.instance) {
      this.instance = new GracefulShutdown(config);
    }
    return this.instance;
  }

  /**
   * Initialize graceful shutdown for Fastify app
   */
  initialize(app: FastifyInstance): void {
    this.app = app;
    this.setupSignalHandlers();
    this.setupDefaultHandlers();
    
    Logger.info('Graceful shutdown initialized', {
      gracePeriod: this.config.gracePeriod,
      forceExitTimeout: this.config.forceExitTimeout,
      signals: this.config.signals
    });
  }

  /**
   * Setup signal handlers
   */
  private setupSignalHandlers(): void {
    for (const signal of this.config.signals) {
      process.on(signal, () => {
        Logger.info(`Received ${signal}, initiating graceful shutdown...`);
        this.shutdown(signal);
      });
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      Logger.error('Uncaught exception, initiating emergency shutdown', error);
      this.emergencyShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('Unhandled promise rejection, initiating emergency shutdown', 
        reason instanceof Error ? reason : new Error(String(reason)),
        { promise: promise.toString() }
      );
      this.emergencyShutdown('unhandledRejection');
    });
  }

  /**
   * Setup default shutdown handlers
   */
  private setupDefaultHandlers(): void {
    // Deregister from load balancer
    this.addShutdownHandler(async () => {
      Logger.info('Deregistering instance from load balancer...');
      await InstanceRegistry.deregisterInstance?.();
    });

    // Stop accepting new connections
    this.addShutdownHandler(async () => {
      if (this.app) {
        Logger.info('Stopping server from accepting new connections...');
        await this.app.close();
      }
    });

    // Shutdown services
    this.addShutdownHandler(async () => {
      Logger.info('Shutting down services...');
      
      // Shutdown JWT Key Rotation Service
      try {
        JWTKeyRotationService.shutdown();
        Logger.info('JWT Key Rotation Service shutdown complete');
      } catch (error) {
        Logger.error('Error shutting down JWT Key Rotation Service', 
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    // Close database connections
    this.addShutdownHandler(async () => {
      Logger.info('Closing database connections...');
      try {
        await DatabaseManager.shutdown();
        Logger.info('Database connections closed');
      } catch (error) {
        Logger.error('Error closing database connections', 
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    // Close Redis connections
    this.addShutdownHandler(async () => {
      Logger.info('Closing Redis connections...');
      try {
        await RedisManager.disconnect();
        Logger.info('Redis connections closed');
      } catch (error) {
        Logger.error('Error closing Redis connections', 
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });
  }

  /**
   * Add custom shutdown handler
   */
  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Initiate graceful shutdown
   */
  async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      Logger.warn('Shutdown already in progress, ignoring signal');
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    Logger.info('Starting graceful shutdown...', { 
      signal, 
      gracePeriod: this.config.gracePeriod,
      handlersCount: this.shutdownHandlers.length
    });

    this.shutdownPromise = this.performShutdown(startTime);
    return this.shutdownPromise;
  }

  /**
   * Perform the actual shutdown process
   */
  private async performShutdown(startTime: number): Promise<void> {
    // Set up force exit timeout
    const forceExitTimer = setTimeout(() => {
      Logger.error('Force exit timeout reached, terminating process');
      process.exit(1);
    }, this.config.forceExitTimeout);

    try {
      // Execute shutdown handlers in reverse order (LIFO)
      for (let i = this.shutdownHandlers.length - 1; i >= 0; i--) {
        const handler = this.shutdownHandlers[i];
        try {
          await Promise.race([
            handler(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Handler timeout')), 5000)
            )
          ]);
        } catch (error) {
          Logger.error(`Shutdown handler ${i} failed`, 
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }

      // Wait for any remaining connections to close
      await this.waitForConnections();

      const shutdownTime = Date.now() - startTime;
      Logger.info('Graceful shutdown completed', { 
        duration: shutdownTime,
        success: true
      });

      clearTimeout(forceExitTimer);
      process.exit(0);

    } catch (error) {
      Logger.error('Error during graceful shutdown', 
        error instanceof Error ? error : new Error(String(error))
      );
      
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }

  /**
   * Wait for existing connections to close
   */
  private async waitForConnections(): Promise<void> {
    Logger.info(`Waiting ${this.config.gracePeriod}ms for connections to close...`);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        Logger.info('Grace period expired, proceeding with shutdown');
        resolve();
      }, this.config.gracePeriod);

      // In a real implementation, you might check for active connections
      // and resolve early if all connections are closed
      
      // For now, just wait for the grace period
      timeout.unref();
    });
  }

  /**
   * Emergency shutdown for critical errors
   */
  private emergencyShutdown(reason: string): void {
    Logger.error(`Emergency shutdown initiated: ${reason}`);
    
    // Try to cleanup critical resources quickly
    setTimeout(() => {
      Logger.error('Emergency shutdown timeout, force exiting');
      process.exit(1);
    }, 5000);

    // Attempt quick cleanup
    Promise.allSettled([
      DatabaseManager.shutdown().catch(() => {}),
      RedisManager.disconnect().catch(() => {})
    ]).finally(() => {
      Logger.error('Emergency shutdown complete');
      process.exit(1);
    });
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get shutdown status
   */
  getStatus(): {
    isShuttingDown: boolean;
    handlersCount: number;
    config: ShutdownConfig;
  } {
    return {
      isShuttingDown: this.isShuttingDown,
      handlersCount: this.shutdownHandlers.length,
      config: this.config
    };
  }
}

/**
 * Middleware to reject requests during shutdown
 */
export function createShutdownMiddleware() {
  const shutdown = GracefulShutdown.getInstance();

  return async function shutdownMiddleware(request: any, reply: any): Promise<void> {
    if (shutdown.isShutdownInProgress()) {
      Logger.warn('Rejecting request during shutdown', {
        url: request.url,
        method: request.method,
        ip: request.ip
      });

      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        retryAfter: 30
      });
    }
  };
}

/**
 * Health check for shutdown status
 */
export function getShutdownHealth(): {
  accepting: boolean;
  shutdownInProgress: boolean;
  status: string;
} {
  const shutdown = GracefulShutdown.getInstance();
  const isShuttingDown = shutdown.isShutdownInProgress();

  return {
    accepting: !isShuttingDown,
    shutdownInProgress: isShuttingDown,
    status: isShuttingDown ? 'shutting_down' : 'accepting_requests'
  };
}

/**
 * Utility function to setup graceful shutdown for an app
 */
export function setupGracefulShutdown(
  app: FastifyInstance, 
  config?: Partial<ShutdownConfig>
): GracefulShutdown {
  const shutdown = GracefulShutdown.getInstance(config);
  shutdown.initialize(app);
  
  // Add shutdown middleware to reject requests during shutdown
  app.addHook('preHandler', createShutdownMiddleware());
  
  return shutdown;
}

// Export singleton instance
export const gracefulShutdown = GracefulShutdown.getInstance();
export default GracefulShutdown;
