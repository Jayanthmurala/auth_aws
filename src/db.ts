import { PrismaClient } from "@prisma/client";
import { env } from "./config/env.js";

// Connection pool configuration for high load
const connectionLimit = parseInt(process.env.DB_CONNECTION_LIMIT || '100');
const poolTimeout = parseInt(process.env.DB_POOL_TIMEOUT || '10000');
const connectionTimeout = parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000');

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.DATABASE_URL
    }
  },
  log: env.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
  errorFormat: 'pretty'
});

// Connection health monitoring
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  connectionCount?: number;
  error?: string;
}> {
  try {
    // Simple connectivity test
    await prisma.$queryRaw`SELECT 1 as health_check`;
    
    // Get connection count if possible
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) as count 
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `;
    
    return {
      healthy: true,
      connectionCount: Number(result[0]?.count || 0)
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  await prisma.$disconnect();
}

// Connection event handlers (commented out due to TypeScript compatibility)
// Note: Connection pooling will be handled at the database URL level
// Example: postgresql://user:pass@host:5432/db?connection_limit=100&pool_timeout=10

// Graceful shutdown handling
process.on("beforeExit", async () => {
  await closeDatabaseConnection();
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connection...'); // Keep for process shutdown
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connection...'); // Keep for process shutdown
  await closeDatabaseConnection();
  process.exit(0);
});
