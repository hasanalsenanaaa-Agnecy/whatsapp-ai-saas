import postgres from 'postgres';
import { recordQuery } from './query-logger.js';

/**
 * Connection Pool Configuration
 * Optimized for production workloads
 */
export interface PoolConfig {
  min: number;
  max: number;
  idleTimeout: number; // milliseconds
  connectionTimeout: number;
  queryTimeout: number;
}

const defaultConfig: PoolConfig = {
  min: 2,
  max: 20,
  idleTimeout: 30 * 60 * 1000, // 30 minutes
  connectionTimeout: 10 * 1000, // 10 seconds
  queryTimeout: 30 * 1000 // 30 seconds
};

let pool: ReturnType<typeof postgres> | null = null;
let inFlightQueries = 0;
let poolMetrics = {
  created: 0,
  reused: 0,
  failed: 0,
  closed: 0,
  minConnections: 0,
  maxConnections: 0,
  totalConnections: 0,
  availableConnections: 0,
  inFlightQueries: 0,
  totalQueries: 0,
  slowQueries: 0,
  totalQueryTimeMs: 0,
  avgQueryTimeMs: 0
};

function wrapPromise<T>(result: Promise<T>, onComplete: (durationMs: number) => void): Promise<T> {
  const start = Date.now();
  return result
    .then(value => {
      onComplete(Date.now() - start);
      return value;
    })
    .catch(error => {
      onComplete(Date.now() - start);
      throw error;
    });
}

function extractSqlText(args: any[]): string {
  if (!args.length) return '';
  const [first] = args;
  if (typeof first === 'string') {
    return first;
  }
  if (Array.isArray(first)) {
    return first.join('?');
  }
  return '';
}

function createInstrumentedPool(rawPool: ReturnType<typeof postgres>): ReturnType<typeof postgres> {
  const handler: ProxyHandler<any> = {
    apply(target, thisArg, args) {
      const sqlText = extractSqlText(args);
      const paramsCount = Math.max(0, args.length - 1);
      inFlightQueries += 1;
      poolMetrics.inFlightQueries = inFlightQueries;
      poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
      const result = Reflect.apply(target, thisArg, args);
      if (result && typeof result.then === 'function') {
        return wrapPromise(result, (durationMs) => {
          inFlightQueries -= 1;
          poolMetrics.inFlightQueries = inFlightQueries;
          poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
          poolMetrics.totalQueries += 1;
          poolMetrics.totalQueryTimeMs += durationMs;
          poolMetrics.avgQueryTimeMs = Math.round(poolMetrics.totalQueryTimeMs / poolMetrics.totalQueries);
          if (durationMs >= 1000) {
            poolMetrics.slowQueries += 1;
          }
          recordQuery({
            sql: sqlText,
            durationMs,
            paramsCount,
            timestamp: new Date().toISOString()
          });
        });
      }
      inFlightQueries -= 1;
      poolMetrics.inFlightQueries = inFlightQueries;
      poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
      return result;
    },
    get(target, prop, receiver) {
      if (prop === 'unsafe') {
        return (...args: any[]) => {
          const sqlText = extractSqlText(args);
          const paramsCount = Math.max(0, args.length - 1);
          inFlightQueries += 1;
          poolMetrics.inFlightQueries = inFlightQueries;
          poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
          const result = (target as any).unsafe(...args);
          if (result && typeof result.then === 'function') {
            return wrapPromise(result, (durationMs) => {
              inFlightQueries -= 1;
              poolMetrics.inFlightQueries = inFlightQueries;
              poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
              poolMetrics.totalQueries += 1;
              poolMetrics.totalQueryTimeMs += durationMs;
              poolMetrics.avgQueryTimeMs = Math.round(poolMetrics.totalQueryTimeMs / poolMetrics.totalQueries);
              if (durationMs >= 1000) {
                poolMetrics.slowQueries += 1;
              }
              recordQuery({
                sql: sqlText,
                durationMs,
                paramsCount,
                timestamp: new Date().toISOString()
              });
            });
          }
          inFlightQueries -= 1;
          poolMetrics.inFlightQueries = inFlightQueries;
          poolMetrics.availableConnections = Math.max(0, poolMetrics.maxConnections - inFlightQueries);
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  };

  return new Proxy(rawPool as any, handler);
}

/**
 * Initialize connection pool with health checks
 */
export async function initializePool(config: Partial<PoolConfig> = {}): Promise<ReturnType<typeof postgres>> {
  const finalConfig = { ...defaultConfig, ...config };
  const connectionUrl = process.env.DATABASE_URL;

  if (!connectionUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  try {
    const rawPool = postgres(connectionUrl, {
      ssl: 'require',
      max: finalConfig.max,
      idle_timeout: finalConfig.idleTimeout,
      connect_timeout: finalConfig.connectionTimeout,
      statement_timeout: finalConfig.queryTimeout
    });

    poolMetrics.created = 1;
    poolMetrics.minConnections = finalConfig.min;
    poolMetrics.maxConnections = finalConfig.max;
    poolMetrics.totalConnections = finalConfig.max;
    poolMetrics.availableConnections = finalConfig.max;

    pool = createInstrumentedPool(rawPool);

    // Test connection
    const result = await pool`SELECT 1 as test`;
    if (!result || result.length === 0) {
      throw new Error('Connection test failed');
    }

    console.log('✅ Connection pool initialized');
    console.log(`   Min connections: ${finalConfig.min}`);
    console.log(`   Max connections: ${finalConfig.max}`);
    console.log(`   Idle timeout: ${finalConfig.idleTimeout / 1000}s`);

    return pool;
  } catch (error) {
    poolMetrics.failed++;
    console.error('❌ Failed to initialize connection pool:', error);
    throw error;
  }
}

/**
 * Get active pool
 */
export function getPool(): ReturnType<typeof postgres> | null {
  return pool;
}

/**
 * Health check for connection pool
 */
export async function checkPoolHealth(): Promise<{
  healthy: boolean;
  responseTime: number;
  message: string;
}> {
  if (!pool) {
    return {
      healthy: false,
      responseTime: 0,
      message: 'Pool not initialized'
    };
  }

  try {
    const start = Date.now();
    const result = await pool`SELECT NOW() as timestamp`;
    const responseTime = Date.now() - start;

    if (responseTime > 1000) {
      console.warn(`⚠️  Slow database response: ${responseTime}ms`);
    }

    return {
      healthy: true,
      responseTime,
      message: `Database connection healthy (${responseTime}ms)`
    };
  } catch (error) {
    return {
      healthy: false,
      responseTime: 0,
      message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Get pool metrics
 */
export function getPoolMetrics() {
  return {
    ...poolMetrics,
    timestamp: new Date().toISOString()
  };
}

/**
 * Close pool gracefully
 */
export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      poolMetrics.closed++;
      console.log('✅ Connection pool closed gracefully');
    } catch (error) {
      console.error('❌ Error closing pool:', error);
    }
  }
}

/**
 * Middleware to catch and log slow queries
 */
export function createSlowQueryLogger(thresholdMs: number = 1000) {
  return async (
    sql: string,
    params: any[],
    duration: number
  ) => {
    if (duration > thresholdMs) {
      console.warn(`🐢 SLOW QUERY (${duration}ms):`, {
        sql: sql.substring(0, 100),
        params: params.length,
        duration
      });
    }
  };
}
