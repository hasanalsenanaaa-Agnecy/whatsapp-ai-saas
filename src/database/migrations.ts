import { getPool } from './pool.js';
import { logAudit } from '../security/audit.js';

/**
 * Migration interface
 */
export interface Migration {
  id: string;
  name: string;
  up: (sql: any) => Promise<void>;
  down?: (sql: any) => Promise<void>;
}

/**
 * Initialize migrations table
 */
async function initializeMigrationsTable(sql: any): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW(),
        execution_time_ms INTEGER,
        status TEXT DEFAULT 'completed'
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_migrations_executed ON migrations(executed_at DESC)`;

    console.log('✅ Migrations table initialized');
  } catch (error) {
    console.error('❌ Error initializing migrations table:', error);
    throw error;
  }
}

/**
 * Run pending migrations
 */
export async function runMigrations(migrations: Migration[]): Promise<void> {
  const sql = getPool();
  if (!sql) {
    throw new Error('Database pool not initialized');
  }

  try {
    await initializeMigrationsTable(sql);

    console.log(`🔄 Running migrations (${migrations.length} total)`);

    let executedCount = 0;

    for (const migration of migrations) {
      // Check if already executed
      const existing = await sql`
        SELECT * FROM migrations WHERE id = ${migration.id}
      `;

      if (existing.length > 0) {
        console.log(`⏭️  Skipping already executed: ${migration.name}`);
        continue;
      }

      try {
        const startTime = Date.now();
        console.log(`⬆️  Executing: ${migration.name}`);

        await migration.up(sql);

        const executionTime = Date.now() - startTime;

        await sql`
          INSERT INTO migrations (id, name, execution_time_ms, status)
          VALUES (${migration.id}, ${migration.name}, ${executionTime}, 'completed')
        `;

        console.log(`✅ Completed: ${migration.name} (${executionTime}ms)`);
        executedCount++;

        await logAudit({
          action: 'migration_executed',
          resourceType: 'migration',
          resourceId: migration.id,
          changes: { name: migration.name, executionTime },
          status: 'success'
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Migration failed: ${migration.name}`);
        console.error(`   Error: ${errorMsg}`);

        await sql`
          INSERT INTO migrations (id, name, status)
          VALUES (${migration.id}, ${migration.name}, 'failed')
        `;

        await logAudit({
          action: 'migration_failed',
          resourceType: 'migration',
          resourceId: migration.id,
          status: 'failed',
          errorMessage: errorMsg
        });

        throw error;
      }
    }

    console.log(`✅ Migrations complete (${executedCount} executed)`);
  } catch (error) {
    console.error('❌ Migration process failed:', error);
    throw error;
  }
}

/**
 * Rollback last migration
 */
export async function rollbackMigration(migrationId: string, migrations: Migration[] = []): Promise<void> {
  const sql = getPool();
  if (!sql) {
    throw new Error('Database pool not initialized');
  }

  console.log(`⬇️  Rolling back: ${migrationId}`);

  try {
    const migration = migrations.find(item => item.id === migrationId);
    if (!migration) {
      throw new Error(`Migration not found: ${migrationId}`);
    }
    if (!migration.down) {
      throw new Error(`Migration has no rollback handler: ${migrationId}`);
    }

    await migration.down(sql);

    await sql`
      UPDATE migrations SET status = 'rolled_back', executed_at = NOW()
      WHERE id = ${migrationId}
    `;

    await logAudit({
      action: 'migration_rolled_back',
      resourceType: 'migration',
      resourceId: migrationId,
      status: 'success'
    });

    console.log(`✅ Rollback completed: ${migrationId}`);
  } catch (error) {
    console.error(`❌ Rollback failed: ${migrationId}`, error);

    await logAudit({
      action: 'migration_rollback_failed',
      resourceType: 'migration',
      resourceId: migrationId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Get migration history
 */
export async function getMigrationHistory(): Promise<any[]> {
  const sql = getPool();
  if (!sql) {
    return [];
  }

  try {
    return await sql`
      SELECT * FROM migrations ORDER BY executed_at DESC
    `;
  } catch (error) {
    console.error('❌ Error fetching migration history:', error);
    return [];
  }
}
