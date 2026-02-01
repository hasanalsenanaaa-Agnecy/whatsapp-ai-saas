import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logAudit } from '../security/audit.js';

/**
 * Backup configuration
 */
export interface BackupConfig {
  backupDir: string;
  retentionDays: number;
  schedule?: string; // cron format (e.g., '0 2 * * *' = 2 AM daily)
  uploadToS3?: boolean;
  s3Bucket?: string;
}

const defaultConfig: BackupConfig = {
  backupDir: './backups',
  retentionDays: 30,
  schedule: '0 2 * * *', // 2 AM daily
  uploadToS3: false
};

let backupSchedule: NodeJS.Timer | null = null;

/**
 * Initialize backup system
 */
export async function initializeBackups(config: Partial<BackupConfig> = {}): Promise<void> {
  const finalConfig = { ...defaultConfig, ...config };

  // Ensure backup directory exists
  if (!fs.existsSync(finalConfig.backupDir)) {
    fs.mkdirSync(finalConfig.backupDir, { recursive: true });
    console.log(`📁 Created backup directory: ${finalConfig.backupDir}`);
  }

  console.log('✅ Backup system initialized');
  console.log(`   Backup directory: ${finalConfig.backupDir}`);
  console.log(`   Retention: ${finalConfig.retentionDays} days`);

  // Clean old backups on startup
  await cleanupOldBackups(finalConfig.backupDir, finalConfig.retentionDays);

  // Schedule backups if in production
  if (process.env.NODE_ENV === 'production' && finalConfig.schedule) {
    await scheduleBackups(finalConfig);
  }
}

/**
 * Create database backup
 */
export async function createBackup(backupDir: string): Promise<{ success: boolean; filename?: string; error?: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql`;
  const filepath = path.join(backupDir, filename);

  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not configured');
    }

    console.log(`📦 Creating backup: ${filename}`);
    const startTime = Date.now();

    // Use pg_dump for comprehensive backup
    execSync(
      `pg_dump "${dbUrl}" > "${filepath}"`,
      { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 } // 100MB buffer
    );

    const duration = Date.now() - startTime;
    const size = fs.statSync(filepath).size;

    console.log(`✅ Backup created successfully`);
    console.log(`   File: ${filename}`);
    console.log(`   Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);

    // Verify backup
    const verified = await verifyBackup(filepath);
    if (!verified) {
      fs.unlinkSync(filepath);
      throw new Error('Backup verification failed');
    }

    await logAudit({
      action: 'database_backup_created',
      resourceType: 'database',
      resourceId: filename,
      changes: { size, duration },
      status: 'success'
    });

    return { success: true, filename };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Backup failed: ${errorMsg}`);

    await logAudit({
      action: 'database_backup_failed',
      resourceType: 'database',
      status: 'failed',
      errorMessage: errorMsg
    });

    // Clean up failed backup file
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Verify backup integrity
 */
async function verifyBackup(filepath: string): Promise<boolean> {
  try {
    const size = fs.statSync(filepath).size;
    
    // Basic checks
    if (size < 1000) {
      console.warn(`⚠️  Backup file is suspiciously small: ${size} bytes`);
      return false;
    }

    // Check file contains SQL
    const header = fs.readFileSync(filepath, 'utf8').substring(0, 100);
    if (!header.includes('PostgreSQL') && !header.includes('--')) {
      console.warn('⚠️  Backup file does not appear to be valid SQL');
      return false;
    }

    console.log('✅ Backup verification passed');
    return true;
  } catch (error) {
    console.error('❌ Backup verification error:', error);
    return false;
  }
}

/**
 * Restore from backup
 */
export async function restoreFromBackup(backupFile: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not configured');
    }

    console.log(`🔄 Restoring from backup: ${backupFile}`);
    const startTime = Date.now();

    // Use psql to restore
    execSync(
      `psql "${dbUrl}" < "${backupFile}"`,
      { stdio: 'pipe' }
    );

    const duration = Date.now() - startTime;

    console.log(`✅ Restore completed in ${(duration / 1000).toFixed(2)}s`);

    await logAudit({
      action: 'database_restore',
      resourceType: 'database',
      resourceId: backupFile,
      status: 'success',
      changes: { duration }
    });

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Restore failed: ${errorMsg}`);

    await logAudit({
      action: 'database_restore_failed',
      resourceType: 'database',
      status: 'failed',
      errorMessage: errorMsg
    });

    return { success: false, error: errorMsg };
  }
}

/**
 * Clean up old backups based on retention policy
 */
export async function cleanupOldBackups(backupDir: string, retentionDays: number): Promise<void> {
  try {
    if (!fs.existsSync(backupDir)) {
      return;
    }

    const files = fs.readdirSync(backupDir);
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (!file.startsWith('backup-')) continue;

      const filepath = path.join(backupDir, file);
      const stats = fs.statSync(filepath);

      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filepath);
        deletedCount++;
        console.log(`🗑️  Deleted old backup: ${file}`);
      }
    }

    if (deletedCount > 0) {
      console.log(`✅ Cleanup complete: removed ${deletedCount} old backups`);
    }
  } catch (error) {
    console.error('❌ Backup cleanup error:', error);
  }
}

/**
 * Schedule automatic backups
 */
async function scheduleBackups(config: BackupConfig): Promise<void> {
  // For production, use a proper cron job scheduler
  // This is a simple implementation - use node-cron or agenda in production
  
  console.log(`⏰ Backup scheduling enabled (schedule: ${config.schedule})`);
  console.log('💡 Tip: For production, configure system cron job:');
  console.log(`   0 2 * * * cd ${process.cwd()} && npm run backup`);

  // Daily backup at 2 AM
  const scheduleBackupDaily = () => {
    const now = new Date();
    const target = new Date();
    target.setHours(2, 0, 0, 0);

    if (now > target) {
      target.setDate(target.getDate() + 1);
    }

    const timeUntilBackup = target.getTime() - now.getTime();

    backupSchedule = setTimeout(async () => {
      await createBackup(config.backupDir);
      scheduleBackupDaily(); // Reschedule for next day
    }, timeUntilBackup);

    console.log(`📅 Next backup scheduled in ${Math.round(timeUntilBackup / 60000)} minutes`);
  };

  scheduleBackupDaily();
}

/**
 * List available backups
 */
export function listBackups(backupDir: string): Array<{ filename: string; size: number; created: Date }> {
  try {
    if (!fs.existsSync(backupDir)) {
      return [];
    }

    return fs
      .readdirSync(backupDir)
      .filter(file => file.startsWith('backup-') && file.endsWith('.sql'))
      .map(file => {
        const filepath = path.join(backupDir, file);
        const stats = fs.statSync(filepath);
        return {
          filename: file,
          size: stats.size,
          created: new Date(stats.mtime)
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());
  } catch (error) {
    console.error('❌ Error listing backups:', error);
    return [];
  }
}

/**
 * Stop backup scheduler
 */
export function stopBackupScheduler(): void {
  if (backupSchedule) {
    clearTimeout(backupSchedule);
    backupSchedule = null;
    console.log('⏹️  Backup scheduler stopped');
  }
}
