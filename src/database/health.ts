import { checkPoolHealth, getPoolMetrics } from './pool.js';
import { getQueryMetrics } from './query-logger.js';

/**
 * Comprehensive database health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    connection: { healthy: boolean; responseTime: number };
    pool: { available: number; total: number };
    replication?: { healthy: boolean; lagMs?: number };
  };
  metrics: ReturnType<typeof getPoolMetrics>;
}

const healthMetrics = {
  lastCheck: new Date(),
  checkCount: 0,
  failureCount: 0,
  avgResponseTime: 0
};

/**
 * Perform comprehensive health check
 */
export async function checkDatabaseHealth(): Promise<HealthStatus> {
  try {
    const metrics = getPoolMetrics();
    const connectionHealth = await checkPoolHealth();

    healthMetrics.checkCount++;
    if (!connectionHealth.healthy) {
      healthMetrics.failureCount++;
    }

    const status = connectionHealth.healthy ? 'healthy' : 'unhealthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        connection: {
          healthy: connectionHealth.healthy,
          responseTime: connectionHealth.responseTime
        },
        pool: {
          available: metrics.totalConnections - (metrics.totalConnections - metrics.availableConnections),
          total: metrics.totalConnections
        }
      },
      metrics
    };
  } catch (error) {
    console.error('❌ Health check error:', error);
    healthMetrics.failureCount++;

    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        connection: { healthy: false, responseTime: 0 },
        pool: { available: 0, total: 0 }
      },
      metrics: getPoolMetrics()
    };
  }
}

/**
 * Start periodic health monitoring
 */
export function startHealthMonitoring(intervalSeconds: number = 30): NodeJS.Timer {
  console.log(`📊 Health monitoring started (every ${intervalSeconds}s)`);

  return setInterval(async () => {
    const health = await checkDatabaseHealth();

    if (health.status === 'unhealthy') {
      console.error(`⚠️  Database health check FAILED`);
      console.error(`   Response time: ${health.checks.connection.responseTime}ms`);
    } else if (process.env.LOG_LEVEL === 'debug') {
      console.log(`✅ Database health: ${health.status} (${health.checks.connection.responseTime}ms)`);
    }
  }, intervalSeconds * 1000);
}

/**
 * Get health metrics
 */
export function getHealthMetrics() {
  const healthCheckSuccessRate = healthMetrics.checkCount > 0 
    ? ((healthMetrics.checkCount - healthMetrics.failureCount) / healthMetrics.checkCount * 100).toFixed(2)
    : '100';

  return {
    ...healthMetrics,
    successRate: `${healthCheckSuccessRate}%`,
    uptime: process.uptime(),
    queries: getQueryMetrics()
  };
}
