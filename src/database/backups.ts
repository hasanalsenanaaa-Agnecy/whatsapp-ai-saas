import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logAudit } from '../security/audit.js';
import { decryptFile, encryptFile, encryptFileWithKey, getEncryptionKeyFingerprint, rotateEncryptionKey } from './encryption.js';

/**
 * Backup configuration
 */
export interface BackupConfig {
  backupDir: string;
  retentionDays: number;
  schedule?: string; // cron format (e.g., '0 2 * * *' = 2 AM daily)
  uploadToS3?: boolean;
  s3Bucket?: string;
  s3Region?: string;
  s3Prefix?: string;
  encryptBackups?: boolean;
  retainPlaintext?: boolean;
  checksumAlgorithm?: 'sha256';
}

const defaultConfig: BackupConfig = {
  backupDir: './backups',
  retentionDays: 30,
  schedule: '0 2 * * *', // 2 AM daily
  uploadToS3: false,
  encryptBackups: true,
  retainPlaintext: false,
  checksumAlgorithm: 'sha256'
};

let backupSchedule: NodeJS.Timer | null = null;
let s3Client: S3Client | null = null;

function getS3Client(region?: string): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return s3Client;
}

function resolveBackupConfig(config: Partial<BackupConfig>): BackupConfig {
  return {
    ...defaultConfig,
    ...config,
    encryptBackups: config.encryptBackups ?? defaultConfig.encryptBackups,
    retainPlaintext: config.retainPlaintext ?? defaultConfig.retainPlaintext,
    uploadToS3: config.uploadToS3 ?? defaultConfig.uploadToS3,
    s3Bucket: config.s3Bucket || process.env.BACKUP_S3_BUCKET,
    s3Region: config.s3Region || process.env.BACKUP_S3_REGION,
    s3Prefix: config.s3Prefix || process.env.BACKUP_S3_PREFIX
  };
}

async function computeChecksum(filePath: string, algorithm: 'sha256' = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeChecksumFile(filePath: string, checksum: string) {
  await fs.promises.writeFile(`${filePath}.sha256`, checksum, 'utf8');
}

async function verifyChecksumFile(filePath: string): Promise<boolean> {
  const checksumFile = `${filePath}.sha256`;
  if (!fs.existsSync(checksumFile)) {
    return false;
  }
  const expected = (await fs.promises.readFile(checksumFile, 'utf8')).trim();
  const actual = await computeChecksum(filePath, 'sha256');
  return expected === actual;
}

async function uploadBackupToS3(config: BackupConfig, filePath: string, filename: string): Promise<void> {
  if (!config.s3Bucket) {
    throw new Error('S3 bucket is required for backup upload');
  }

  const client = getS3Client(config.s3Region);
  const keyPrefix = config.s3Prefix ? `${config.s3Prefix.replace(/\/$/, '')}/` : '';
  const key = `${keyPrefix}${filename}`;

  await client.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: fs.createReadStream(filePath)
  }));
}

/**
 * Initialize backup system
 */
export async function initializeBackups(config: Partial<BackupConfig> = {}): Promise<void> {
  const finalConfig = resolveBackupConfig(config);

  // Ensure backup directory exists
  if (!fs.existsSync(finalConfig.backupDir)) {
    fs.mkdirSync(finalConfig.backupDir, { recursive: true });
    console.log(`📁 Created backup directory: ${finalConfig.backupDir}`);
  }

  console.log('✅ Backup system initialized');
  console.log(`   Backup directory: ${finalConfig.backupDir}`);
  console.log(`   Retention: ${finalConfig.retentionDays} days`);
  console.log(`   Encryption: ${finalConfig.encryptBackups ? 'enabled' : 'disabled'}`);
  console.log(`   S3 uploads: ${finalConfig.uploadToS3 ? 'enabled' : 'disabled'}`);

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
export async function createBackup(
  backupDir: string,
  config: Partial<BackupConfig> = {}
): Promise<{ success: boolean; filename?: string; error?: string; encrypted?: boolean; checksum?: string }> {
  const finalConfig = resolveBackupConfig({ ...config, backupDir });
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
    const pgDumpCommand = process.env.BACKUP_PG_DUMP_CMD || process.env.PG_DUMP_PATH || 'pg_dump';
    execSync(
      `${pgDumpCommand} "${dbUrl}" > "${filepath}"`,
      { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 }
    );

    const duration = Date.now() - startTime;
    const size = fs.statSync(filepath).size;

    const checksum = await computeChecksum(filepath);
    await writeChecksumFile(filepath, checksum);

    let finalFilepath = filepath;
    let finalFilename = filename;
    let encrypted = false;

    if (finalConfig.encryptBackups) {
      finalFilepath = `${filepath}.enc`;
      finalFilename = `${filename}.enc`;
      await encryptFile(filepath, finalFilepath);
      const encryptedChecksum = await computeChecksum(finalFilepath);
      await writeChecksumFile(finalFilepath, encryptedChecksum);
      encrypted = true;

      if (!finalConfig.retainPlaintext) {
        fs.unlinkSync(filepath);
        fs.unlinkSync(`${filepath}.sha256`);
      }
    }

    const verified = await verifyBackup(finalFilepath);
    if (!verified) {
      fs.unlinkSync(finalFilepath);
      throw new Error('Backup verification failed');
    }

    if (finalConfig.uploadToS3) {
      await uploadBackupToS3(finalConfig, finalFilepath, finalFilename);
    }

    const finalSize = fs.statSync(finalFilepath).size;

    console.log(`✅ Backup created successfully`);
    console.log(`   File: ${finalFilename}`);
    console.log(`   Size: ${(finalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);

    await logAudit({
      action: 'database_backup_created',
      resourceType: 'database',
      resourceId: finalFilename,
      changes: {
        size: finalSize,
        duration,
        encrypted,
        checksum: encrypted ? await computeChecksum(finalFilepath) : checksum,
        encryptionKeyFingerprint: encrypted ? getEncryptionKeyFingerprint() : undefined
      },
      status: 'success'
    });

    return { success: true, filename: finalFilename, encrypted, checksum };
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

    const checksumVerified = await verifyChecksumFile(filepath);
    if (!checksumVerified) {
      console.warn('⚠️  Backup checksum verification failed');
      return false;
    }

    if (filepath.endsWith('.sql')) {
      const header = fs.readFileSync(filepath, 'utf8').substring(0, 100);
      if (!header.includes('PostgreSQL') && !header.includes('--')) {
        console.warn('⚠️  Backup file does not appear to be valid SQL');
        return false;
      }
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

    let restoreFile = backupFile;
    let tempFile: string | null = null;

    if (backupFile.endsWith('.enc')) {
      tempFile = path.join(os.tmpdir(), `restore-${crypto.randomUUID()}.sql`);
      await decryptFile(backupFile, tempFile);
      restoreFile = tempFile;
    }

    // Use psql to restore
    execSync(
      `psql "${dbUrl}" < "${restoreFile}"`,
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

    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

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

export async function restoreToPointInTime(backupDir: string, targetIso: string): Promise<{ success: boolean; error?: string; filename?: string }> {
  try {
    const targetTime = new Date(targetIso);
    if (Number.isNaN(targetTime.getTime())) {
      throw new Error('Invalid timestamp for point-in-time restore');
    }

    const backups = listBackups(backupDir);
    const candidate = backups
      .filter(b => b.created.getTime() <= targetTime.getTime())
      .sort((a, b) => b.created.getTime() - a.created.getTime())[0];

    if (!candidate) {
      throw new Error('No backup available for the requested time');
    }

    const result = await restoreFromBackup(path.join(backupDir, candidate.filename));
    if (!result.success) {
      return { success: false, error: result.error };
    }

    await logAudit({
      action: 'database_restore_point_in_time',
      resourceType: 'database',
      resourceId: candidate.filename,
      status: 'success',
      changes: { targetIso }
    });

    return { success: true, filename: candidate.filename };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Point-in-time restore failed: ${errorMsg}`);

    await logAudit({
      action: 'database_restore_point_in_time_failed',
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
export function listBackups(backupDir: string): Array<{ filename: string; size: number; created: Date; encrypted: boolean; checksum?: string }> {
  try {
    if (!fs.existsSync(backupDir)) {
      return [];
    }

    return fs
      .readdirSync(backupDir)
      .filter(file => file.startsWith('backup-') && (file.endsWith('.sql') || file.endsWith('.sql.enc')))
      .map(file => {
        const filepath = path.join(backupDir, file);
        const stats = fs.statSync(filepath);
        const checksumPath = `${filepath}.sha256`;
        const checksum = fs.existsSync(checksumPath)
          ? fs.readFileSync(checksumPath, 'utf8').trim()
          : undefined;
        return {
          filename: file,
          size: stats.size,
          created: new Date(stats.mtime),
          encrypted: file.endsWith('.enc'),
          checksum
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

export async function rotateBackupEncryptionKey(backupDir: string, newKeyHex: string): Promise<{ success: boolean; rotated: number; error?: string }> {
  try {
    const backups = listBackups(backupDir).filter(item => item.encrypted);
    if (backups.length === 0) {
      rotateEncryptionKey(newKeyHex);
      return { success: true, rotated: 0 };
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'backup-rotate-'));
    const tempFiles: Array<{ source: string; plain: string; encrypted: string }> = [];

    for (const backup of backups) {
      const source = path.join(backupDir, backup.filename);
      const plain = path.join(tempDir, backup.filename.replace(/\.enc$/, ''));
      const encrypted = path.join(tempDir, backup.filename);
      await decryptFile(source, plain);
      tempFiles.push({ source, plain, encrypted });
    }

    rotateEncryptionKey(newKeyHex);

    for (const file of tempFiles) {
      await encryptFileWithKey(file.plain, file.encrypted, newKeyHex);
      await fs.promises.rename(file.encrypted, file.source);
      const checksum = await computeChecksum(file.source);
      await writeChecksumFile(file.source, checksum);
      await fs.promises.unlink(file.plain);
    }

    await fs.promises.rmdir(tempDir);

    return { success: true, rotated: tempFiles.length };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Backup key rotation failed: ${errorMsg}`);
    return { success: false, rotated: 0, error: errorMsg };
  }
}
