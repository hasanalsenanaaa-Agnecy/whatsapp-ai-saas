// ============================================================
// FIELD-LEVEL ENCRYPTION
// Encrypts sensitive values (Shopify tokens, API keys) at rest.
// Uses AES-256-GCM with a random IV per value — same plaintext
// produces different ciphertext each time.
// ============================================================

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:';

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 32) return null;
  // Support both 32-char raw keys and 64-char hex keys
  if (hex.length === 64 && /^[0-9a-f]+$/i.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  return Buffer.from(hex.slice(0, 32), 'utf8');
}

/**
 * Encrypt a plaintext string. Returns `enc:<iv>:<tag>:<ciphertext>` (all hex).
 * Returns the original string if encryption key is missing (dev mode).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted string. If the value doesn't start with `enc:`,
 * returns it as-is (backward compat with existing plaintext values).
 */
export function decrypt(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

  const key = getKey();
  if (!key) return value;

  const parts = value.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 3) return value;

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

// ── Settings-level helpers ──────────────────────────────────

// Keys in client.settings that contain secrets
const SENSITIVE_SETTINGS_KEYS = [
  'shopify_token',
  'shopify_admin_token',
  'shopify_webhook_secret',
];

// Keys inside settings.shopify that contain secrets
const SENSITIVE_SHOPIFY_KEYS = [
  'storefrontToken',
  'adminToken',
  'webhookSecret',
  'webhook_secret',
];

/**
 * Encrypt sensitive fields in a settings object before DB write.
 * Returns a new object — does not mutate the input.
 */
export function encryptSettings(settings: Record<string, any>): Record<string, any> {
  const out = { ...settings };

  for (const key of SENSITIVE_SETTINGS_KEYS) {
    if (out[key] && typeof out[key] === 'string' && !isEncrypted(out[key])) {
      out[key] = encrypt(out[key]);
    }
  }

  if (out.shopify && typeof out.shopify === 'object') {
    out.shopify = { ...out.shopify };
    for (const key of SENSITIVE_SHOPIFY_KEYS) {
      if (out.shopify[key] && typeof out.shopify[key] === 'string' && !isEncrypted(out.shopify[key])) {
        out.shopify[key] = encrypt(out.shopify[key]);
      }
    }
  }

  return out;
}

/**
 * Decrypt sensitive fields in a settings object after DB read.
 * Returns a new object — does not mutate the input.
 */
export function decryptSettings(settings: Record<string, any>): Record<string, any> {
  const out = { ...settings };

  for (const key of SENSITIVE_SETTINGS_KEYS) {
    if (out[key] && typeof out[key] === 'string') {
      out[key] = decrypt(out[key]);
    }
  }

  if (out.shopify && typeof out.shopify === 'object') {
    out.shopify = { ...out.shopify };
    for (const key of SENSITIVE_SHOPIFY_KEYS) {
      if (out.shopify[key] && typeof out.shopify[key] === 'string') {
        out.shopify[key] = decrypt(out.shopify[key]);
      }
    }
  }

  return out;
}
