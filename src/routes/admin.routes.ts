import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
      const { filename } = request.body;

      if (!filename) {
        throw new AppError(400, ErrorCode.INVALID_INPUT, 'Filename required');
      }

      const result = await restoreFromBackup(`./backups/${filename}`);

      if (!result.success) {
        throw new AppError(500, ErrorCode.INTERNAL_ERROR, result.error || 'Restore failed');
      }

      await logAudit({
        action: 'database_restore',
        resourceType: 'database',
        resourceId: filename,
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
