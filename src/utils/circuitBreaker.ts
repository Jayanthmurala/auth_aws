import { Logger } from './logger';

/**
 * Circuit breaker pattern implementation for resilient service calls
 */

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;     // Number of failures before opening
  recoveryTimeout: number;      // Time to wait before trying again (ms)
  monitoringPeriod: number;     // Time window for failure counting (ms)
  successThreshold: number;     // Successes needed to close from half-open
  timeout: number;              // Request timeout (ms)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  requests: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  nextAttempt: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 60000,      // 1 minute
  monitoringPeriod: 60000,     // 1 minute
  successThreshold: 3,
  timeout: 10000               // 10 seconds
};

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private requests: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private nextAttempt: number | null = null;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        Logger.info(`Circuit breaker ${this.name} transitioning to HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    this.requests++;
    
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.timeout);
      });

      const result = await Promise.race([fn(), timeoutPromise]);
      
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.failures = 0; // Reset failure count on success
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
        Logger.info(`Circuit breaker ${this.name} closed after recovery`);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failures++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.recoveryTimeout;
      Logger.warn(`Circuit breaker ${this.name} opened from HALF_OPEN after failure`);
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.recoveryTimeout;
      Logger.warn(`Circuit breaker ${this.name} opened after ${this.failures} failures`);
    }
  }

  /**
   * Check if we should attempt to reset the circuit breaker
   */
  private shouldAttemptReset(): boolean {
    return this.nextAttempt !== null && Date.now() >= this.nextAttempt;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttempt: this.nextAttempt
    };
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    Logger.info(`Circuit breaker ${this.name} manually reset`);
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.config.recoveryTimeout;
    Logger.warn(`Circuit breaker ${this.name} manually opened`);
  }
}

/**
 * Circuit breaker registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private static breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  static getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, config));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker statistics
   */
  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  static resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    Logger.info('All circuit breakers reset');
  }

  /**
   * Get circuit breakers in open state
   */
  static getOpenBreakers(): string[] {
    const openBreakers: string[] = [];
    for (const [name, breaker] of this.breakers) {
      if (breaker.getStats().state === CircuitState.OPEN) {
        openBreakers.push(name);
      }
    }
    return openBreakers;
  }
}

/**
 * Predefined circuit breakers for common services
 */
export const CircuitBreakers = {
  // Database operations
  database: CircuitBreakerRegistry.getBreaker('database', {
    failureThreshold: 3,
    recoveryTimeout: 30000,
    timeout: 5000
  }),

  // Redis operations
  redis: CircuitBreakerRegistry.getBreaker('redis', {
    failureThreshold: 5,
    recoveryTimeout: 15000,
    timeout: 2000
  }),

  // Email service
  email: CircuitBreakerRegistry.getBreaker('email', {
    failureThreshold: 3,
    recoveryTimeout: 60000,
    timeout: 10000
  }),

  // External API calls
  externalApi: CircuitBreakerRegistry.getBreaker('external-api', {
    failureThreshold: 5,
    recoveryTimeout: 120000,
    timeout: 15000
  }),

  // File operations
  fileSystem: CircuitBreakerRegistry.getBreaker('file-system', {
    failureThreshold: 3,
    recoveryTimeout: 30000,
    timeout: 5000
  })
};

/**
 * Utility function to wrap async functions with circuit breaker
 */
export function withCircuitBreaker<T extends any[], R>(
  name: string,
  fn: (...args: T) => Promise<R>,
  config?: Partial<CircuitBreakerConfig>
): (...args: T) => Promise<R> {
  const breaker = CircuitBreakerRegistry.getBreaker(name, config);
  
  return async (...args: T): Promise<R> => {
    return breaker.execute(() => fn(...args));
  };
}

/**
 * Decorator for circuit breaker protection
 */
export function circuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const breaker = CircuitBreakerRegistry.getBreaker(name, config);

    descriptor.value = async function (...args: any[]) {
      return breaker.execute(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Health check for circuit breakers
 */
export function getCircuitBreakerHealth(): {
  healthy: boolean;
  openBreakers: string[];
  stats: Record<string, CircuitBreakerStats>;
} {
  const openBreakers = CircuitBreakerRegistry.getOpenBreakers();
  const stats = CircuitBreakerRegistry.getAllStats();
  
  return {
    healthy: openBreakers.length === 0,
    openBreakers,
    stats
  };
}
