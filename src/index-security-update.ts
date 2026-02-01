import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';

// Security imports
import { initializeSecurity } from './security/init.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { verifyWhatsAppWebhook } from './security/webhook-verification.js';
import { logAudit, extractAuditInfo } from './security/audit.js';
import { AppError, ErrorCode } from './security/error-handler.js';
import { createRateLimitMiddleware } from './security/rate-limiter.js';

// Database imports
import { 
  initDatabase, 
  isDatabaseAvailable, 
  getClientByPhoneNumberId, 
  getLeads, 
  getClientStats 
} from './services/database.js';

// Existing imports
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';

// ============================================================
// FASTIFY SETUP
// ============================================================

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  }
});

// ============================================================
// MIDDLEWARE & SECURITY
// ============================================================

await initDatabase();
await initializeSecurity(fastify);
await initGoogleSheets();

// Register global rate limiting
await fastify.register(rateLimit, { 
  max: 100, 
  timeWindow: '1 minute',
  cache: 10000,
  allowList: ['127.0.0.1']
});

// ============================================================
// ROUTES - HEALTH & STATUS
// ============================================================

fastify.get('/', async () => ({
  status: 'ok',
  service: 'WhatsApp AI SaaS',
  version: '4.0.0',
  multiTenant: true,
  security: {
    jwt: true,
    apiKeys: true,
    webhookVerification: true,
    auditLogging: true
  }
}));

fastify.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  database: isDatabaseAvailable() ? 'connected' : 'disconnected',
  uptime: process.uptime()
}));

// ============================================================
// AUTH ROUTES (PUBLIC)
// ============================================================

await registerAuthRoutes(fastify);

// ============================================================
// WEBHOOK ROUTES - WhatsApp (SIGNATURE VERIFIED)
// ============================================================

fastify.get<{ Params: { clientId: string }; Querystring: any }>(
  '/webhook/whatsapp/:clientId',
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params as { clientId: string };
    const query = request.query as Record<string, string>;

    const client = await getClientByPhoneNumberId(clientId);
    if (!client) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Client not found');
    }

    // WhatsApp verification request
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === client.verify_token) {
      reply.send(challenge);
    } else {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid verification token');
    }
  }
);

fastify.post<{ Body: any; Params: { clientId: string } }>(
  '/webhook/whatsapp/:clientId',
  { onRequest: [createRateLimitMiddleware('/webhook/whatsapp')] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params as { clientId: string };
    const signature = request.headers['x-hub-signature-256'] as string;

    const client = await getClientByPhoneNumberId(clientId);
    if (!client) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Client not found');
    }

    // Verify webhook signature
    const body = JSON.stringify(request.body);
    if (!verifyWhatsAppWebhook(body, signature, client.verify_token)) {
      await logAudit({
        clientId,
        action: 'webhook_signature_verification_failed',
        status: 'denied',
        ...extractAuditInfo(request)
      });

      throw new AppError(
        401,
        ErrorCode.UNAUTHORIZED,
        'Invalid webhook signature'
      );
    }

    // Process webhook asynchronously
    setImmediate(() => {
      handleIncomingMessage(clientId, request.body, client.access_token).catch(err => {
        console.error('❌ Error processing webhook:', err);
      });
    });

    // Respond immediately
    reply.code(200).send({ ok: true });
  }
);

// ============================================================
// PROTECTED ROUTES - DASHBOARD & ANALYTICS
// ============================================================

fastify.get<{ Params: { clientId: string } }>(
  '/api/clients/:clientId/dashboard',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params;
    const user = (request as any).user;

    // Verify client ownership
    if (user.clientId !== clientId) {
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'You do not have access to this resource'
      );
    }

    const stats = await getClientStats(clientId);
    return stats;
  }
);

fastify.get<{ Params: { clientId: string }; Querystring: any }>(
  '/api/clients/:clientId/leads',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params;
    const user = (request as any).user;
    const limit = Math.min(parseInt((request.query as any).limit || '100'), 500);

    if (user.clientId !== clientId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
    }

    const leads = await getLeads(clientId, limit);
    return { success: true, count: leads.length, leads };
  }
);

// ============================================================
// API KEY MANAGEMENT
// ============================================================

import { createAPIKey, listAPIKeys, revokeAPIKey } from './security/api-key.js';

fastify.post<{ Params: { clientId: string }; Body: any }>(
  '/api/clients/:clientId/api-keys',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params;
    const user = (request as any).user;

    if (user.clientId !== clientId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
    }

    const { name } = request.body;
    if (!name || typeof name !== 'string') {
      throw new AppError(400, ErrorCode.INVALID_INPUT, 'Name is required');
    }

    const result = await createAPIKey(clientId, name);
    if (!result) {
      throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to create API key');
    }

    await logAudit({
      clientId,
      action: 'api_key_created',
      resourceType: 'api_key',
      resourceId: result.id,
      status: 'success',
      ...extractAuditInfo(request)
    });

    reply.code(201).send({
      success: true,
      id: result.id,
      key: result.key,
      message: 'Save your API key! You will not be able to see it again.'
    });
  }
);

fastify.get<{ Params: { clientId: string } }>(
  '/api/clients/:clientId/api-keys',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params;
    const user = (request as any).user;

    if (user.clientId !== clientId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
    }

    const keys = await listAPIKeys(clientId);
    return { success: true, count: keys.length, keys };
  }
);

fastify.delete<{ Params: { clientId: string; keyId: string } }>(
  '/api/clients/:clientId/api-keys/:keyId',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId, keyId } = request.params;
    const user = (request as any).user;

    if (user.clientId !== clientId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
    }

    const success = await revokeAPIKey(keyId);
    if (!success) {
      throw new AppError(500, ErrorCode.INTERNAL_ERROR, 'Failed to revoke API key');
    }

    await logAudit({
      clientId,
      action: 'api_key_revoked',
      resourceType: 'api_key',
      resourceId: keyId,
      status: 'success',
      ...extractAuditInfo(request)
    });

    reply.send({ success: true, message: 'API key revoked' });
  }
);

// ============================================================
// AUDIT LOGS
// ============================================================

import { getAuditLogs } from './security/audit.js';

fastify.get<{ Params: { clientId: string }; Querystring: any }>(
  '/api/clients/:clientId/audit-logs',
  { onRequest: [fastify.authenticate] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params;
    const user = (request as any).user;
    const limit = Math.min(parseInt((request.query as any).limit || '100'), 500);

    if (user.clientId !== clientId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Unauthorized');
    }

    const logs = await getAuditLogs(clientId, limit);
    return { success: true, count: logs.length, logs };
  }
);

// ============================================================
// START SERVER
// ============================================================

const start = async (): Promise<void> => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });

    console.log(`
🚀 WhatsApp AI SaaS v4.0.0 (Phase 1 Security Complete)
════════════════════════════════════════════════════════════════
📡 Server: http://localhost:${port}
🔒 Security Features:
   ✅ JWT Authentication
   ✅ API Key Management
   ✅ Webhook Signature Verification
   ✅ Audit Logging
   ✅ Rate Limiting
   ✅ Input Validation
   ✅ Security Headers (Helmet)
   ✅ CORS Protection

🌍 Environment: ${process.env.NODE_ENV || 'development'}
✅ Database: ${isDatabaseAvailable() ? 'Connected' : 'Not available'}
════════════════════════════════════════════════════════════════

📚 API Endpoints:
   POST   /auth/register              - Register new client
   POST   /auth/refresh               - Refresh JWT token
   GET    /api/clients/:id/dashboard  - Get dashboard stats
   GET    /api/clients/:id/leads      - List leads
   POST   /api/clients/:id/api-keys   - Create API key
   GET    /api/clients/:id/api-keys   - List API keys
   DELETE /api/clients/:id/api-keys/:keyId - Revoke API key
   GET    /api/clients/:id/audit-logs - View audit logs

    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
