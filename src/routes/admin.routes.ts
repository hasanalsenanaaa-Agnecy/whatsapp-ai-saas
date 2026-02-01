import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import { 
  checkDatabaseHealth, 
  getHealthMetrics, 
  createBackup, 
  listBackups, 
  restoreFromBackup 
} from '../database/index.js';
import { AppError, ErrorCode } from '../security/error-handler.js';
import { successResponse } from '../api/response.js';
import { logAudit } from '../security/audit.js';

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminKey = request.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_API_KEY) {
    throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid admin key');
  }
}

/**
 * Sanitize filename to prevent path traversal attacks
 * Only allows alphanumeric characters, dashes, underscores, and dots
 */
function sanitizeFilename(filename: string): string {
  // Remove any path components and only keep the basename
  const basename = path.basename(filename);
  // Only allow safe characters: alphanumeric, dash, underscore, dot
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, '');
  // Ensure it doesn't start with a dot (hidden files)
  if (sanitized.startsWith('.')) {
    throw new AppError(400, ErrorCode.INVALID_INPUT, 'Invalid filename');
  }
  // Ensure it has a reasonable length
  if (sanitized.length < 1 || sanitized.length > 255) {
    throw new AppError(400, ErrorCode.INVALID_INPUT, 'Invalid filename length');
  }
  return sanitized;
}

export async function registerAdminRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/admin/database/health',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const health = await checkDatabaseHealth();
      return successResponse(health, { requestId: request.id });
    }
  );

  fastify.get(
    '/admin/database/metrics',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = getHealthMetrics();
      return successResponse(metrics, { requestId: request.id });
    }
  );

  fastify.post(
    '/admin/database/backup',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await createBackup('./backups');

      if (!result.success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, result.error || 'Backup failed');
      }

      await logAudit({
        action: 'manual_backup_created',
        resourceType: 'database',
        resourceId: result.filename,
        status: 'success'
      });

      reply.code(201);
      return successResponse({ filename: result.filename }, { requestId: request.id });
    }
  );

  fastify.get(
    '/admin/database/backups',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const backups = listBackups('./backups');
      return successResponse(backups, { requestId: request.id });
    }
  );

  fastify.post<{ Body: { filename: string } }>(
    '/admin/database/restore',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { filename } = request.body as { filename: string };

      if (!filename) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Filename required');
      }

      // Sanitize filename to prevent path traversal
      const safeFilename = sanitizeFilename(filename);
      const result = await restoreFromBackup(`./backups/${safeFilename}`);

      if (!result.success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, result.error || 'Restore failed');
      }

      await logAudit({
        action: 'database_restore',
        resourceType: 'database',
        resourceId: safeFilename,
        status: 'success'
      });

      return successResponse({ message: 'Restored' }, { requestId: request.id });
    }
  );

  fastify.get(
    '/admin/health',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const dbHealth = await checkDatabaseHealth();
      return successResponse({
        status: 'healthy',
        database: dbHealth.status,
        uptime: process.uptime()
      }, { requestId: request.id });
    }
  );
}
