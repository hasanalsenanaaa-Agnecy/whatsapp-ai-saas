import 'dotenv/config';
import { initializeEncryption, getEncryptionKeyFingerprint } from '../database/encryption.js';
import { initializeBackups, createBackup, listBackups, restoreFromBackup, restoreToPointInTime, rotateBackupEncryptionKey } from '../database/backups.js';
import { initializePool, closePool } from '../database/pool.js';
import { runMigrations, rollbackMigration } from '../database/migrations.js';
import { databaseMigrations } from '../database/migration-list.js';

const [,, command, ...args] = process.argv;

const backupDir = process.env.BACKUP_DIR || './backups';

function printHelp() {
  console.log(`
Database Maintenance
====================
Commands:
  backup                       Create a backup
  list                         List backups
  restore <filename>           Restore from backup file
  pitr <timestamp>             Restore to point in time (ISO timestamp)
  migrate                      Run pending migrations
  rollback <migrationId>       Roll back a migration
  rotate-key <newKeyHex>       Rotate encryption key (hex)
`);
}

async function run() {
  try {
    switch (command) {
      case 'backup': {
        initializeEncryption();
        await initializeBackups({ backupDir });
        const result = await createBackup(backupDir);
        if (!result.success) {
          throw new Error(result.error || 'Backup failed');
        }
        console.log(`Backup created: ${result.filename}`);
        break;
      }
      case 'list': {
        const backups = listBackups(backupDir);
        console.table(backups);
        break;
      }
      case 'restore': {
        const filename = args[0];
        if (!filename) throw new Error('Filename required');
        initializeEncryption();
        const result = await restoreFromBackup(`${backupDir}/${filename}`);
        if (!result.success) throw new Error(result.error || 'Restore failed');
        console.log('Restore completed');
        break;
      }
      case 'pitr': {
        const timestamp = args[0];
        if (!timestamp) throw new Error('Timestamp required');
        initializeEncryption();
        const result = await restoreToPointInTime(backupDir, timestamp);
        if (!result.success) throw new Error(result.error || 'PITR failed');
        console.log(`Restored to ${timestamp} using ${result.filename}`);
        break;
      }
      case 'migrate': {
        await initializePool();
        await runMigrations(databaseMigrations);
        await closePool();
        break;
      }
      case 'rollback': {
        const migrationId = args[0];
        if (!migrationId) throw new Error('Migration id required');
        await initializePool();
        await rollbackMigration(migrationId, databaseMigrations);
        await closePool();
        break;
      }
      case 'rotate-key': {
        const newKey = args[0];
        if (!newKey) throw new Error('New key hex required');
        initializeEncryption();
        const result = await rotateBackupEncryptionKey(backupDir, newKey);
        if (!result.success) throw new Error(result.error || 'Key rotation failed');
        console.log(`Encryption key rotated. Backups re-encrypted: ${result.rotated}`);
        console.log(`Fingerprint: ${getEncryptionKeyFingerprint()}`);
        break;
      }
      default:
        printHelp();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

run();
