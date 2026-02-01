import 'dotenv/config';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { initializeSecurity } from './security/init.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerClientRoutes } from './routes/clients.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerAIRoutes } from './routes/ai.routes.js';
import { registerAutomationRoutes } from './routes/automation.routes.js';
import { verifyWhatsAppWebhook } from './security/webhook-verification.js';
import { logAudit, extractAuditInfo } from './security/audit.js';
import { AppError, ErrorCode } from './security/error-handler.js';
import { createRateLimitMiddleware } from './security/rate-limiter.js';
import { createAPIKey, listAPIKeys, revokeAPIKey } from './security/api-key.js';
import { getAuditLogs } from './security/audit.js';
import { initializeDatabaseLayer, shutdownDatabaseLayer, checkDatabaseHealth } from './database/index.js';
import { successResponse } from './api/response.js';
import { initDatabase, isDatabaseAvailable, getClientByPhoneNumberId, getLeads, getClientStats } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  },
  requestIdHeader: 'x-request-id'
});

await initDatabase();
await initGoogleSheets();
await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await initializeSecurity(fastify);
await initializeDatabaseLayer();
await registerAuthRoutes(fastify);
await registerClientRoutes(fastify);
await registerAdminRoutes(fastify);
await registerAIRoutes(fastify);
await registerAutomationRoutes(fastify);

fastify.get('/', async (r) => successResponse({
  service: 'WhatsApp AI SaaS',
  version: '4.0.0',
  status: 'operational'
}, { requestId: r.id }));

fastify.get('/health', async (r) => {
  const db = await checkDatabaseHealth();
  return successResponse({ status: 'healthy', database: db.status, uptime: process.uptime() }, { requestId: r.id });
});

fastify.get('/webhook/whatsapp/:clientId', async (request, reply) => {
  const { clientId } = request.params as any;
  const query = request.query as any;
  const client = await getClientByPhoneNumberId(clientId);
  if (!client) throw new AppError(404, ErrorCode.NOT_FOUND, 'Not found');
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === client.verify_token) {
    reply.send(query['hub.challenge']);
  } else {
    throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid token');
  }
});

fastify.post('/webhook/whatsapp/:clientId', { onRequest: [createRateLimitMiddleware('/webhook/whatsapp')] }, async (request, reply) => {
  const { clientId } = request.params as any;
  const signature = request.headers['x-hub-signature-256'] as string;
  const client = await getClientByPhoneNumberId(clientId);
  if (!client) throw new AppError(404, ErrorCode.NOT_FOUND, 'Not found');
  const body = JSON.stringify(request.body);
  if (!verifyWhatsAppWebhook(body, signature, client.verify_token)) {
    await logAudit({
      clientId,
      action: 'webhook_signature_verification_failed',
      status: 'denied',
      ...extractAuditInfo(request)
    });
    throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid signature');
  }
  setImmediate(() => {
    handleIncomingMessage(clientId, request.body, client.access_token).catch(err => {
      console.error('Error:', err);
    });
  });
  reply.code(200).send({ ok: true });
});

fastify.post('/api/clients/:clientId/api-keys', { onRequest: [fastify.authenticate] }, async (request: any, reply) => {
  const { clientId } = request.params;
  const user = request.user;
  if (user.clientId !== clientId) throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
  const { name } = request.body;
  if (!name) throw new AppError(400, ErrorCode.INVALID_INPUT, 'Name required');
  const result = await createAPIKey(clientId, name);
  if (!result) throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed');
  await logAudit({
    clientId,
    action: 'api_key_created',
    resourceType: 'api_key',
    resourceId: result.id,
    status: 'success',
    ...extractAuditInfo(request)
  });
  reply.code(201);
  return successResponse({ id: result.id, key: result.key }, { requestId: request.id });
});

fastify.get('/api/clients/:clientId/api-keys', { onRequest: [fastify.authenticate] }, async (request: any) => {
  const { clientId } = request.params;
  const user = request.user;
  if (user.clientId !== clientId) throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
  const keys = await listAPIKeys(clientId);
  return successResponse(keys, { requestId: request.id });
});

fastify.delete('/api/clients/:clientId/api-keys/:keyId', { onRequest: [fastify.authenticate] }, async (request: any) => {
  const { clientId, keyId } = request.params;
  const user = request.user;
  if (user.clientId !== clientId) throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
  const success = await revokeAPIKey(keyId);
  if (!success) throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed');
  await logAudit({
    clientId,
    action: 'api_key_revoked',
    resourceType: 'api_key',
    resourceId: keyId,
    status: 'success',
    ...extractAuditInfo(request)
  });
  return successResponse({ message: 'Revoked' }, { requestId: request.id });
});

fastify.get('/api/clients/:clientId/audit-logs', { onRequest: [fastify.authenticate] }, async (request: any) => {
  const { clientId } = request.params;
  const user = request.user;
  if (user.clientId !== clientId) throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
  const logs = await getAuditLogs(clientId);
  return successResponse(logs, { requestId: request.id });
});

const gracefulShutdown = async (signal: string) => {
  console.log(`\n📡 Received ${signal}, shutting down...`);
  try {
    await fastify.close();
    await shutdownDatabaseLayer();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`
🚀 WhatsApp AI SaaS v4.0.0 (Phase 1, 2 & 3 Complete)
════════════════════════════════════════════════════════════════
📡 Server: http://localhost:${port}
🔒 Phase 1: Security ✅
🗄️  Phase 2: Database ✅
📊 Phase 3: API & Backend ✅
════════════════════════════════════════════════════════════════
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
