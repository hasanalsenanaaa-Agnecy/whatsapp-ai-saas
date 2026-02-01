import crypto from 'crypto';
import { sql } from '../services/database.js';

export interface APIKey {
  id: string;
  clientId: string;
  name: string;
  createdAt: Date;
  lastUsedAt?: Date;
  isActive: boolean;
}

/**
 * Generate a new API key for a client
 * Returns: { key: "whatsapp_...", hash: "hashed_value" }
 * Store only the hash in the database
 */
export function generateAPIKey(): { key: string; hash: string } {
  const key = `whatsapp_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

/**
 * Verify an API key against stored hash
 */
export function verifyAPIKeyHash(key: string, storedHash: string): boolean {
  try {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(keyHash),
      Buffer.from(storedHash)
    );
  } catch (error) {
    return false;
  }
}

/**
 * Create API key in database
 */
export async function createAPIKey(
  clientId: string,
  name: string
): Promise<{ key: string; id: string } | null> {
  if (!sql) {
    console.error('❌ Database not available');
    return null;
  }

  try {
    const { key, hash } = generateAPIKey();
    
    const result = await sql`
      INSERT INTO api_keys (client_id, key_hash, name, is_active, created_at)
      VALUES (${clientId}, ${hash}, ${name}, true, NOW())
      RETURNING id
    `;

    if (!result[0]) return null;

    return {
      key,
      id: result[0].id
    };
  } catch (error) {
    console.error('❌ Error creating API key:', error);
    return null;
  }
}

/**
 * Get client by API key
 */
export async function getClientByAPIKey(keyHash: string): Promise<any | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT c.* FROM clients c
      JOIN api_keys ak ON c.id = ak.client_id
      WHERE ak.key_hash = ${keyHash} AND ak.is_active = true
    `;

    if (result[0]) {
      await sql`UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = ${keyHash}`;
    }

    return result[0] || null;
  } catch (error) {
    console.error('❌ Error getting client by API key:', error);
    return null;
  }
}

/**
 * Revoke API key
 */
export async function revokeAPIKey(keyId: string): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`UPDATE api_keys SET is_active = false WHERE id = ${keyId}`;
    return true;
  } catch (error) {
    console.error('❌ Error revoking API key:', error);
    return false;
  }
}

/**
 * List API keys for a client
 */
export async function listAPIKeys(clientId: string): Promise<APIKey[]> {
  if (!sql) return [];

  try {
    const result = await sql`
      SELECT id, client_id as clientId, name, created_at as createdAt, last_used_at as lastUsedAt, is_active as isActive
      FROM api_keys
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
    `;

    return result.map((row: any) => ({
      id: row.id,
      clientId: row.clientId,
      name: row.name,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      isActive: row.isActive
    }));
  } catch (error) {
    console.error('❌ Error listing API keys:', error);
    return [];
  }
}
