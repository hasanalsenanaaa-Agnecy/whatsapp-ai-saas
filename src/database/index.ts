import { initializePool, closePool, getPool, checkPoolHealth } from './pool.js';
import { initializeEncryption, encrypt, decrypt } from './encryption.js';
import { initializeBackups, createBackup, restoreFromBackup, restoreToPointInTime, listBackups, rotateBackupEncryptionKey } from './backups.js';
import { checkDatabaseHealth, startHealthMonitoring, getHealthMetrics } from './health.js';
import { runMigrations, getMigrationHistory, rollbackMigration } from './migrations.js';
import { databaseMigrations } from './migration-list.js';
import { getQueryMetrics } from './query-logger.js';

/**
 * Initialize entire database layer
 */
export async function initializeDatabaseLayer(): Promise<void> {
  console.log('🗄️  Initializing database layer...');

  try {
    // 1. Initialize connection pool
    await initializePool();

    // 2. Initialize encryption
    initializeEncryption();

    // 3. Initialize backup system
    await initializeBackups({
      backupDir: './backups',
      retentionDays: 30
    });

    // 4. Start health monitoring
    const healthMonitor = startHealthMonitoring(30);

    // 5. Run migrations
    await runMigrations(databaseMigrations);

    // 6. Perform initial health check
    const health = await checkDatabaseHealth();
    if (health.status === 'unhealthy') {
      console.warn('⚠️  Database health check failed on startup');
    }

    console.log('✅ Database layer initialized successfully');
  } catch (error) {
    console.error('❌ Database layer initialization failed:', error);
    throw error;
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownDatabaseLayer(): Promise<void> {
  console.log('🔌 Shutting down database layer...');
  await closePool();
  console.log('✅ Database layer shutdown complete');
}

// Export all functions
export {
  initializePool,
  closePool,
  getPool,
  checkPoolHealth,
  initializeEncryption,
  encrypt,
  decrypt,
  initializeBackups,
  createBackup,
  restoreFromBackup,
  restoreToPointInTime,
  rotateBackupEncryptionKey,
  listBackups,
  checkDatabaseHealth,
  startHealthMonitoring,
  getHealthMetrics,
  runMigrations,
  rollbackMigration,
  getMigrationHistory,
  getQueryMetrics
};
