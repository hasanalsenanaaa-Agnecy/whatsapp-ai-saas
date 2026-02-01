import { FastifyRequest } from 'fastify';
import { sql } from '../services/database.js';

export interface AuditLogEntry {
  clientId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failed' | 'denied';
  errorMessage?: string;
}

/**
 * Log audit event to database
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  if (!sql) {
    console.log('📝 AUDIT:', entry);
    return;
  }

  try {
    await sql`
      INSERT INTO audit_logs (
        client_id, action, resource_type, resource_id, changes,
        ip_address, user_agent, status, error_message, created_at
      ) VALUES (
        ${entry.clientId || null},
        ${entry.action},
        ${entry.resourceType || null},
        ${entry.resourceId || null},
        ${entry.changes ? JSON.stringify(entry.changes) : null},
        ${entry.ipAddress || null},
        ${entry.userAgent || null},
        ${entry.status},
        ${entry.errorMessage || null},
        NOW()
      )
    `;
  } catch (error) {
    console.error('❌ Error logging audit:', error);
  }
}

/**
 * Extract audit info from Fastify request
 */
export function extractAuditInfo(request: FastifyRequest): Partial<AuditLogEntry> {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent']
  };
}

/**
 * Get audit logs for a client
 */
export async function getAuditLogs(
  clientId: string,
  limit: number = 100
): Promise<AuditLogEntry[]> {
  if (!sql) return [];

  try {
    const result = await sql`
      SELECT * FROM audit_logs
      WHERE client_id = ${clientId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return result.map((row: any) => ({
      clientId: row.client_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      status: row.status,
      errorMessage: row.error_message
    }));
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    return [];
  }
}
