import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { Logger } from '../utils/logger.js';

/**
 * Database configuration with read replica support for scalability
 */

export interface DatabaseConfig {
  primary: string;
  readReplicas: string[];
  connectionPoolSize: number;
  queryTimeout: number;
  enableReadReplicas: boolean;
}

/**
 * Database manager with read/write splitting
 */
export class DatabaseManager {
  private static primaryClient: PrismaClient | null = null;
  private static readClients: PrismaClient[] = [];
  private static currentReadIndex = 0;
  private static config: DatabaseConfig;

  /**
   * Initialize database connections
   */
  static async initialize(): Promise<void> {
    this.config = {
      primary: env.DATABASE_URL,
      readReplicas: env.DATABASE_READ_REPLICAS?.split(',') || [],
      connectionPoolSize: parseInt(env.DB_CONNECTION_LIMIT || '100'),
      queryTimeout: parseInt(env.DB_CONNECTION_TIMEOUT || '5000'),
      enableReadReplicas: env.NODE_ENV === 'production' && !!env.DATABASE_READ_REPLICAS
    };

    Logger.info('Initializing database connections', {
      primaryUrl: this.config.primary.substring(0, 20) + '...',
      readReplicaCount: this.config.readReplicas.length,
      enableReadReplicas: this.config.enableReadReplicas
    });

    // Initialize primary connection
    await this.initializePrimaryConnection();

    // Initialize read replica connections if enabled
    if (this.config.enableReadReplicas) {
      await this.initializeReadReplicas();
    }
  }

  /**
   * Initialize primary database connection
   */
  private static async initializePrimaryConnection(): Promise<void> {
    this.primaryClient = new PrismaClient({
      datasources: {
        db: {
          url: this.config.primary
        }
      },
      log: env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
      errorFormat: 'pretty'
    });

    try {
      await this.primaryClient.$connect();
      Logger.info('Primary database connected successfully');
    } catch (error) {
      Logger.error('Failed to connect to primary database', 
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Initialize read replica connections
   */
  private static async initializeReadReplicas(): Promise<void> {
    for (let i = 0; i < this.config.readReplicas.length; i++) {
      const replicaUrl = this.config.readReplicas[i];
      
      try {
        const readClient = new PrismaClient({
          datasources: {
            db: {
              url: replicaUrl
            }
          },
          log: env.NODE_ENV === 'development' 
            ? ['warn', 'error']
            : ['error'],
          errorFormat: 'pretty'
        });

        await readClient.$connect();
        this.readClients.push(readClient);
        
        Logger.info(`Read replica ${i + 1} connected successfully`, {
          replicaUrl: replicaUrl.substring(0, 20) + '...'
        });
      } catch (error) {
        Logger.error(`Failed to connect to read replica ${i + 1}`, 
          error instanceof Error ? error : new Error(String(error)),
          { replicaUrl: replicaUrl.substring(0, 20) + '...' }
        );
        // Continue with other replicas even if one fails
      }
    }

    Logger.info(`Initialized ${this.readClients.length} read replicas`);
  }

  /**
   * Get primary database client (for writes)
   */
  static getPrimaryClient(): PrismaClient {
    if (!this.primaryClient) {
      throw new Error('Primary database client not initialized');
    }
    return this.primaryClient;
  }

  /**
   * Get read database client (for reads) with load balancing
   */
  static getReadClient(): PrismaClient {
    // If no read replicas available, use primary
    if (!this.config.enableReadReplicas || this.readClients.length === 0) {
      return this.getPrimaryClient();
    }

    // Round-robin load balancing
    const client = this.readClients[this.currentReadIndex];
    this.currentReadIndex = (this.currentReadIndex + 1) % this.readClients.length;
    
    return client;
  }

  /**
   * Execute read query with automatic failover
   */
  static async executeReadQuery<T>(
    queryFn: (client: PrismaClient) => Promise<T>,
    fallbackToPrimary: boolean = true
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const readClient = this.getReadClient();
      const result = await queryFn(readClient);
      
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        Logger.performance('Slow read query detected', {
          operation: 'read_query',
          duration,
          client: 'read_replica'
        });
      }
      
      return result;
    } catch (error) {
      Logger.warn('Read query failed on replica', {
        error: error instanceof Error ? error.message : String(error),
        fallbackToPrimary
      });

      // Fallback to primary if enabled
      if (fallbackToPrimary) {
        try {
          const result = await queryFn(this.getPrimaryClient());
          
          Logger.info('Read query succeeded on primary after replica failure');
          return result;
        } catch (primaryError) {
          Logger.error('Read query failed on both replica and primary', 
            primaryError instanceof Error ? primaryError : new Error(String(primaryError))
          );
          throw primaryError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Execute write query on primary
   */
  static async executeWriteQuery<T>(
    queryFn: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await queryFn(this.getPrimaryClient());
      
      const duration = Date.now() - startTime;
      if (duration > 2000) {
        Logger.performance('Slow write query detected', {
          operation: 'write_query',
          duration,
          client: 'primary'
        });
      }
      
      return result;
    } catch (error) {
      Logger.error('Write query failed', 
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Health check for all database connections
   */
  static async healthCheck(): Promise<{
    primary: { healthy: boolean; responseTime: number };
    readReplicas: Array<{ healthy: boolean; responseTime: number; index: number }>;
  }> {
    const results = {
      primary: { healthy: false, responseTime: 0 },
      readReplicas: [] as Array<{ healthy: boolean; responseTime: number; index: number }>
    };

    // Check primary
    const primaryStart = Date.now();
    try {
      if (this.primaryClient) {
        await this.primaryClient.$queryRaw`SELECT 1 as health_check`;
      }
      results.primary = {
        healthy: true,
        responseTime: Date.now() - primaryStart
      };
    } catch (error) {
      results.primary = {
        healthy: false,
        responseTime: Date.now() - primaryStart
      };
    }

    // Check read replicas
    for (let i = 0; i < this.readClients.length; i++) {
      const replicaStart = Date.now();
      try {
        await this.readClients[i].$queryRaw`SELECT 1 as health_check`;
        results.readReplicas.push({
          healthy: true,
          responseTime: Date.now() - replicaStart,
          index: i
        });
      } catch (error) {
        results.readReplicas.push({
          healthy: false,
          responseTime: Date.now() - replicaStart,
          index: i
        });
      }
    }

    return results;
  }

  /**
   * Get database statistics
   */
  static async getStats(): Promise<{
    connections: {
      primary: number;
      readReplicas: number[];
    };
    performance: {
      avgReadTime: number;
      avgWriteTime: number;
    };
  }> {
    try {
      // Get connection counts from primary
      let primaryConnections: Array<{ count: bigint }> = [];
      if (this.primaryClient) {
        primaryConnections = await this.primaryClient.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) as count 
          FROM pg_stat_activity 
          WHERE datname = current_database()
        `;
      }

      const replicaConnections: number[] = [];
      for (const replica of this.readClients) {
        try {
          const connections = await replica.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) as count 
            FROM pg_stat_activity 
            WHERE datname = current_database()
          `;
          replicaConnections.push(Number(connections[0]?.count || 0));
        } catch {
          replicaConnections.push(0);
        }
      }

      return {
        connections: {
          primary: Number(primaryConnections?.[0]?.count || 0),
          readReplicas: replicaConnections
        },
        performance: {
          avgReadTime: 0, // Would need to implement query timing tracking
          avgWriteTime: 0
        }
      };
    } catch (error) {
      Logger.error('Failed to get database stats', 
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        connections: { primary: 0, readReplicas: [] },
        performance: { avgReadTime: 0, avgWriteTime: 0 }
      };
    }
  }

  /**
   * Graceful shutdown of all connections
   */
  static async shutdown(): Promise<void> {
    Logger.info('Shutting down database connections...');

    const shutdownPromises: Promise<void>[] = [];

    // Shutdown primary
    if (this.primaryClient) {
      shutdownPromises.push(
        this.primaryClient.$disconnect().catch(error => 
          Logger.error('Error disconnecting primary database', 
            error instanceof Error ? error : new Error(String(error))
          )
        )
      );
    }

    // Shutdown read replicas
    for (let i = 0; i < this.readClients.length; i++) {
      shutdownPromises.push(
        this.readClients[i].$disconnect().catch(error => 
          Logger.error(`Error disconnecting read replica ${i + 1}`, 
            error instanceof Error ? error : new Error(String(error))
          )
        )
      );
    }

    await Promise.all(shutdownPromises);
    
    this.primaryClient = null;
    this.readClients = [];
    
    Logger.info('Database connections shutdown complete');
  }
}

/**
 * Convenience functions for common operations
 */

// Read operations (use read replicas)
export const readQuery = DatabaseManager.executeReadQuery;

// Write operations (use primary)
export const writeQuery = DatabaseManager.executeWriteQuery;

// Get appropriate client for operation type
export function getDbClient(operation: 'read' | 'write' = 'read'): PrismaClient {
  return operation === 'write' 
    ? DatabaseManager.getPrimaryClient()
    : DatabaseManager.getReadClient();
}

// Export for backward compatibility
export const prisma = DatabaseManager.getPrimaryClient;
export default DatabaseManager;
