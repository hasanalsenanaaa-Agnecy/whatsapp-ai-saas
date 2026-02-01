import crypto from 'crypto';
import fs from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Encryption configuration
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16;
const ENCODING = 'hex';

/**
 * Generate or use existing encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const keyEnv = process.env.ENCRYPTION_KEY;

  if (!keyEnv) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY environment variable is required in production');
    }
    // Development: generate a key (will change on restart - fine for dev)
    return crypto.randomBytes(KEY_LENGTH);
  }

  const key = Buffer.from(keyEnv, ENCODING);
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }

  return key;
}

let encryptionKey: Buffer | null = null;

/**
 * Initialize encryption
 */
export function initializeEncryption(): void {
  try {
    encryptionKey = getEncryptionKey();
    console.log('✅ Encryption initialized');
  } catch (error) {
    console.error('❌ Encryption initialization failed:', error);
    throw error;
  }
}

function getActiveKey(): Buffer {
  if (!encryptionKey) {
    throw new Error('Encryption not initialized');
  }
  return encryptionKey;
}

/**
 * Encrypt sensitive data
 */
export function encrypt(plaintext: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getActiveKey(), iv);

    let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
    encrypted += cipher.final(ENCODING);

    const authTag = cipher.getAuthTag();

    // Return: iv + authTag + encrypted data (all hex-encoded)
    return `${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
  } catch (error) {
    console.error('❌ Encryption error:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedData: string): string {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], ENCODING);
    const authTag = Buffer.from(parts[1], ENCODING);
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getActiveKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, ENCODING, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error);
    throw new Error('Decryption failed');
  }
}

function normalizeKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, ENCODING);
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }
  return key;
}

async function encryptFileWithBuffer(inputPath: string, outputPath: string, key: Buffer): Promise<{ iv: string; authTag: string }> {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const writeStream = fs.createWriteStream(outputPath);
  writeStream.write(iv);

  await pipeline(fs.createReadStream(inputPath), cipher, writeStream);

  const authTag = cipher.getAuthTag();
  await fs.promises.appendFile(outputPath, authTag);

  return { iv: iv.toString(ENCODING), authTag: authTag.toString(ENCODING) };
}

export async function encryptFile(inputPath: string, outputPath: string): Promise<{ iv: string; authTag: string }> {
  return encryptFileWithBuffer(inputPath, outputPath, getActiveKey());
}

export async function encryptFileWithKey(inputPath: string, outputPath: string, keyHex: string): Promise<{ iv: string; authTag: string }> {
  const key = normalizeKey(keyHex);
  return encryptFileWithBuffer(inputPath, outputPath, key);
}

export async function decryptFile(inputPath: string, outputPath: string): Promise<void> {
  const key = getActiveKey();
  const stats = await fs.promises.stat(inputPath);
  const totalSize = stats.size;

  if (totalSize <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted file is too small');
  }

  const fileHandle = await fs.promises.open(inputPath, 'r');
  const ivBuffer = Buffer.alloc(IV_LENGTH);
  const authTagBuffer = Buffer.alloc(AUTH_TAG_LENGTH);

  await fileHandle.read(ivBuffer, 0, IV_LENGTH, 0);
  await fileHandle.read(authTagBuffer, 0, AUTH_TAG_LENGTH, totalSize - AUTH_TAG_LENGTH);
  await fileHandle.close();

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  await pipeline(
    fs.createReadStream(inputPath, { start: IV_LENGTH, end: totalSize - AUTH_TAG_LENGTH - 1 }),
    decipher,
    fs.createWriteStream(outputPath)
  );
}

export function rotateEncryptionKey(newKeyHex: string): string {
  const newKey = Buffer.from(newKeyHex, ENCODING);
  if (newKey.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }
  const oldKey = encryptionKey ? encryptionKey.toString(ENCODING) : '';
  encryptionKey = newKey;
  return oldKey;
}

export function getEncryptionKeyFingerprint(): string {
  const key = getActiveKey();
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Hash sensitive data (one-way, for verification)
 */
export function hashData(data: string, saltRounds: number = 10): string {
  // Using PBKDF2 for consistency across platforms
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(data, salt, 100000, 32, 'sha256');

  return `${salt.toString(ENCODING)}:${hash.toString(ENCODING)}`;
}

/**
 * Verify hashed data
 */
export function verifyHashedData(data: string, hash: string): boolean {
  try {
    const parts = hash.split(':');
    if (parts.length !== 2) {
      return false;
    }

    const salt = Buffer.from(parts[0], ENCODING);
    const storedHash = Buffer.from(parts[1], ENCODING);
    const computedHash = crypto.pbkdf2Sync(data, salt, 100000, 32, 'sha256');

    return crypto.timingSafeEqual(storedHash, computedHash);
  } catch (error) {
    return false;
  }
}

/**
 * Generate secure random string (for tokens, keys, etc.)
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString(ENCODING);
}

/**
 * Generate encryption key (for operations like database key rotation)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString(ENCODING);
}
