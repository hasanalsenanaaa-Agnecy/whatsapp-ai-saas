import 'dotenv/config';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { initDatabase, closeDatabase, getClientByPhoneNumberId, getClientById, getClientByVerifyToken, deleteCustomerData, validateDashboardKey, listConversations, getConversationDetail, listClients, listAlerts, getCustomerProfile } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';
import { handleReminderCron } from './cron/reminders.js';
import { handleAbandonedCartCron } from './cron/abandoned-cart.js';
import { handleDataRetentionCron } from './cron/data-retention.js';
import { handleShopifyWebhook } from './services/shopify-webhook.js';
import { checkRateLimit, checkTenantRateLimit } from './services/rateLimiter.js';
import { maskPhone } from './utils/buttons.js';
import crypto from 'crypto';
import { sendAlert, alertError, trackError, getHealthStatus, sendDailySummary, sendAllClientDailySummaries, sendAllClientMonthlySummaries } from './services/alerts.js';
import { checkUsageCaps, getMonthlyUsage, getCapsForClient, calculateOverageCharges } from './services/usage-limits.js';
import { emitEvent } from './services/events.js';
import { getRevenueByClient, getConversionFunnel, getUsageSummary, getTopProducts, getAICostSummary } from './services/analytics.js';
import { sendWhatsAppMessage } from './services/whatsapp.js';

// ============================================================
// STARTUP VALIDATION — fail fast before the server accepts traffic
// ============================================================

function validateRequiredEnv() {
  const required = [
    'DATABASE_URL',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_APP_SECRET',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

validateRequiredEnv();

// ============================================================
// MESSAGE DEDUPLICATION
// WhatsApp retries webhooks on timeout. Track processed message
// IDs for 10 minutes to avoid double-processing.
// ============================================================

const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isDuplicate(messageId: string): boolean {
  const seen = processedMessages.get(messageId);
  if (seen && Date.now() - seen < DEDUP_TTL_MS) return true;
  processedMessages.set(messageId, Date.now());
  return false;
}

// Prune expired entries every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [id, ts] of processedMessages) {
    if (ts < cutoff) processedMessages.delete(id);
  }
}, 15 * 60 * 1000);

// ============================================================
// SERVER
// ============================================================

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  }
});

// CORS — allow dashboard portal to call API
await fastify.register(cors, {
  origin: process.env.PORTAL_URL || true, // restrict in production via PORTAL_URL env var
  methods: ['GET', 'POST', 'DELETE'],
});

// Global rate limit — 200 req/min per IP (protects all routes)
await fastify.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute'
});

// Capture raw body for signature verification
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const rawBody = body as string;
    (req as any).rawBody = rawBody;
    const json = JSON.parse(rawBody);
    done(null, json);
  } catch (err: any) {
    done(err, undefined);
  }
});

await initDatabase();
await initGoogleSheets();

// ============================================================
// DASHBOARD API RATE LIMITS — keyed by auth key, not IP.
// A stolen key from one IP can be reused from many; per-key limits
// the only ceiling that survives that. Auth-validate stays per-IP
// (no key yet) to throttle brute-force key guessing.
// ============================================================

const dashboardKeyOrIp = (req: any) => {
  const key = (req.query as any)?.key;
  return key ? `dash:${key}` : `ip:${req.ip}`;
};

const dashboardReadLimit = {
  config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: dashboardKeyOrIp } },
};

const dashboardWriteLimit = {
  config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: dashboardKeyOrIp } },
};

const authValidateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

// ============================================================
// IN-FLIGHT TASK TRACKING — webhook handlers ack 200 immediately
// then process via setImmediate. We track those background tasks
// so graceful shutdown can wait for them to drain.
// ============================================================

let inFlightTasks = 0;
function trackTask(fn: () => Promise<void>): void {
  inFlightTasks++;
  fn().finally(() => { inFlightTasks--; });
}

// ============================================================
// PAYLOAD HELPERS
// ============================================================

function extractPhoneNumberId(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;
}

function extractCustomerPhone(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || null;
}

function extractMessageId(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || null;
}

function extractMessageText(payload: any): string | null {
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;

  if (message.type === 'interactive') {
    if (message.interactive?.button_reply) return message.interactive.button_reply.id || message.interactive.button_reply.title || null;
    if (message.interactive?.list_reply) return message.interactive.list_reply.id || message.interactive.list_reply.title || null;
  }
  if (message.type === 'text') {
    const body = message.text?.body || null;
    // Reject absurdly long messages (max 4096 chars — WhatsApp's own limit)
    if (body && body.length > 4096) return null;
    return body;
  }
  if (message.type === 'audio') return '[voice]';
  return null;
}

function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    // Timing-safe comparison prevents timing attacks
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ============================================================
// ROUTES
// ============================================================

fastify.get('/', async () => ({ service: 'WhatsApp AI Receptionist', status: 'running', version: '3.0.0' }));
fastify.get('/health', async (_request, reply) => {
  const health = await getHealthStatus();
  const code = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  return reply.code(code).send(health);
});

// Analytics API — owner sees all, client sees own data only
fastify.get('/api/analytics/revenue', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  const clientId = auth.role === 'client' ? auth.clientId : query.client_id;
  return getRevenueByClient(clientId, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/funnel', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  const clientId = auth.role === 'client' ? auth.clientId! : query.client_id;
  if (!clientId) return reply.code(400).send({ error: 'client_id required' });
  return getConversionFunnel(clientId, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/usage', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  const clientId = auth.role === 'client' ? auth.clientId : query.client_id;
  return getUsageSummary(clientId, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/products', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  const clientId = auth.role === 'client' ? auth.clientId! : query.client_id;
  if (!clientId) return reply.code(400).send({ error: 'client_id required' });
  return getTopProducts(clientId, parseInt(query.months) || 3, parseInt(query.limit) || 10);
});

fastify.get('/api/analytics/ai-cost', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  const clientId = auth.role === 'client' ? auth.clientId : query.client_id;
  return getAICostSummary(clientId, parseInt(query.months) || 3);
});

// ============================================================
// DASHBOARD API — auth, conversations, clients, alerts
// ============================================================

// Auth validation — returns role + client info
fastify.get('/api/auth/validate', authValidateLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'invalid key' });
  return auth;
});

// Conversation list (paginated)
fastify.get('/api/conversations', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  // Clients can only see their own conversations
  const clientId = auth.role === 'client' ? auth.clientId : query.client_id;

  return listConversations({
    clientId,
    state: query.state,
    page: parseInt(query.page) || 1,
    limit: parseInt(query.limit) || 20,
  });
});

// Conversation detail (full messages)
fastify.get('/api/conversations/:phone', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const { phone } = request.params as { phone: string };
  const clientId = auth.role === 'client' ? auth.clientId! : query.client_id;
  if (!clientId) return reply.code(400).send({ error: 'client_id required' });

  const conv = await getConversationDetail(clientId, phone);
  if (!conv) return reply.code(404).send({ error: 'conversation not found' });
  return conv;
});

// Send message to a customer from the dashboard
fastify.post('/api/conversations/:phone/send', dashboardWriteLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const { phone } = request.params as { phone: string };
  const clientId = auth.role === 'client' ? auth.clientId! : query.client_id;
  if (!clientId) return reply.code(400).send({ error: 'client_id required' });

  const body = request.body as any;
  if (!body?.message || typeof body.message !== 'string') {
    return reply.code(400).send({ error: 'message required' });
  }

  const client = await getClientById(clientId);
  if (!client) return reply.code(404).send({ error: 'client not found' });

  const sent = await sendWhatsAppMessage(phone, body.message, client.access_token, client.phone_number_id);
  if (sent) {
    emitEvent(clientId, 'message_out', phone, { source: 'dashboard', length: body.message.length });
  }
  return { success: sent };
});

// Client list (owner only)
fastify.get('/api/clients', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });
  if (auth.role !== 'owner') return reply.code(403).send({ error: 'owner only' });

  return listClients();
});

// Alert history
fastify.get('/api/alerts', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const clientId = auth.role === 'client' ? auth.clientId : query.client_id;

  return listAlerts({
    clientId,
    limit: parseInt(query.limit) || 50,
  });
});

// Customer profile — lifetime stats for one phone within one client
fastify.get('/api/customers/:phone', dashboardReadLimit, async (request, reply) => {
  const query = request.query as any;
  const auth = await validateDashboardKey(query.key);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const { phone } = request.params as { phone: string };
  const requestedClientId = auth.role === 'client' ? auth.clientId : query.client_id;
  if (!requestedClientId) return reply.code(400).send({ error: 'client_id required' });

  const profile = await getCustomerProfile(requestedClientId, phone);
  if (!profile) return reply.code(404).send({ error: 'customer not found' });
  return profile;
});

// PDPL — Right to deletion (DELETE /api/customer/:phone)
fastify.delete('/api/customer/:phone', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  const { phone } = request.params as { phone: string };
  if (!phone || phone.length < 8) return reply.code(400).send({ error: 'valid phone number required' });
  const result = await deleteCustomerData(phone);
  return { success: true, deleted: result };
});

// WhatsApp webhook verification
// Multi-tenant: each client row stores its own verify_token. We accept the
// request if the presented token matches any active client's token, or the
// global env fallback (kept so the original test-number registration still
// re-verifies if Meta ever re-runs the handshake).
fastify.get('/webhook/whatsapp', async (request, reply) => {
  const query = request.query as any;
  if (query['hub.mode'] !== 'subscribe') return reply.code(403).send('Forbidden');
  const presented = query['hub.verify_token'] as string | undefined;
  if (!presented) return reply.code(403).send('Forbidden');

  const matchedClient = await getClientByVerifyToken(presented);
  const envFallback = process.env.WHATSAPP_VERIFY_TOKEN;
  if (matchedClient || (envFallback && presented === envFallback)) {
    console.log(`Webhook verified${matchedClient ? ` for client ${matchedClient.id}` : ' via env fallback'}`);
    return reply.send(query['hub.challenge']);
  }
  return reply.code(403).send('Forbidden');
});

// WhatsApp webhook handler
fastify.post('/webhook/whatsapp', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const rawBody = (request as any).rawBody as string;

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && !verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.error('❌ Invalid webhook signature — request rejected');
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  const phoneNumberId = extractPhoneNumberId(request.body);
  const customerPhone = extractCustomerPhone(request.body);
  const messageText = extractMessageText(request.body);
  const messageId = extractMessageId(request.body);

  // Respond 200 immediately — WhatsApp requires fast acknowledgment
  reply.code(200).send({ ok: true });

  setImmediate(() => trackTask(async () => {
    try {
      if (!phoneNumberId || !customerPhone || !messageText) return;

      // Skip duplicate webhook deliveries
      if (messageId && isDuplicate(messageId)) {
        console.log(`Duplicate message ${messageId} — skipped`);
        return;
      }

      // Per-phone rate limit (10 messages/min)
      if (!checkRateLimit(customerPhone)) {
        console.warn(`Rate limit exceeded for ${maskPhone(customerPhone)}`);
        return;
      }

      const client = await getClientByPhoneNumberId(phoneNumberId);
      if (!client) {
        console.error('No client found for: ' + phoneNumberId);
        return;
      }

      // Per-tenant rate limit (200 msg/min default — prevents one client from exhausting WhatsApp API)
      if (!checkTenantRateLimit(client.id)) {
        console.warn(`Tenant rate limit exceeded for client ${client.id}`);
        return;
      }

      console.log(`Message from ${maskPhone(customerPhone)} [${messageText.length} chars]`);
      emitEvent(client.id, 'message_in', customerPhone, { length: messageText.length });
      await handleIncomingMessage(phoneNumberId, customerPhone, messageText, client.access_token);

      // Fire-and-forget usage check (80% warning + overage log). Non-blocking.
      checkUsageCaps(client).catch(err => console.error('Usage check error:', err));
    } catch (error) {
      console.error('Webhook processing error:', error);
      emitEvent('system', 'error', customerPhone || undefined, { error: (error as Error)?.message });
      await alertError(error as Error, 'Webhook processing failed');
    }
  }));
});

// Cron endpoint for appointment reminders
fastify.post('/cron/reminders', async (request, reply) => {
  await handleReminderCron(request, reply);
});

// Cron endpoint for abandoned cart recovery
fastify.post('/cron/abandoned-cart', async (request, reply) => {
  await handleAbandonedCartCron(request, reply);
});

// Cron endpoint for PDPL data retention (run daily)
fastify.post('/cron/data-retention', async (request, reply) => {
  await handleDataRetentionCron(request, reply);
});

// Cron endpoint for daily summary (run once daily at 10pm Riyadh)
// Sends: (1) platform-wide summary to owner, (2) per-client summary to each client's agent phone
fastify.post('/cron/daily-summary', async (request, reply) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }
  const ownerSent = await sendDailySummary();
  const clientResult = await sendAllClientDailySummaries();
  return { ownerSent, clients: clientResult };
});

// Cron endpoint for monthly summary (run on the 1st of each month)
// Sends previous-month stats (orders, revenue, conversion rate, avg order value) to each client
fastify.post('/cron/monthly-summary', async (request, reply) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }
  const result = await sendAllClientMonthlySummaries();
  return { clients: result };
});

// Per-client usage endpoint (for dashboard) — returns current month usage + caps + overage
fastify.get<{ Params: { clientId: string }; Querystring: { key?: string } }>('/api/usage/:clientId', dashboardReadLimit, async (request, reply) => {
  const { clientId } = request.params;
  const { key } = request.query;
  if (!key) return reply.code(401).send({ error: 'key required' });
  const auth = await validateDashboardKey(key);
  if (!auth || (auth.role !== 'owner' && auth.clientId !== clientId)) {
    return reply.code(403).send({ error: 'forbidden' });
  }
  const client = await getClientById(clientId);
  if (!client) return reply.code(404).send({ error: 'client not found' });

  const usage = await getMonthlyUsage(clientId);
  const caps = getCapsForClient(client);
  const overage = calculateOverageCharges(usage, caps);
  return { usage, caps, overage };
});

// Shopify orders/paid webhook
fastify.post('/webhook/shopify', async (request, reply) => {
  const rawBody = (request as any).rawBody as string;
  const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string | undefined;
  const shopDomain = request.headers['x-shopify-shop-domain'] as string | undefined;
  const topic = request.headers['x-shopify-topic'] as string | undefined;

  // Acknowledge immediately — Shopify requires fast response
  reply.code(200).send({ ok: true });

  setImmediate(() => trackTask(async () => {
    try {
      await handleShopifyWebhook(request.body, rawBody, hmacHeader, shopDomain, topic);
    } catch (error) {
      console.error('Shopify webhook error:', error);
      trackError();
      await alertError(error as Error, 'Shopify webhook processing failed');
    }
  }));
});

const start = async () => {
  const port = parseInt(process.env.PORT || '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log('WhatsApp AI Receptionist running on port ' + port);
  await sendAlert('info', 'Server started', 'WhatsApp AI Bot running on port ' + port);
};
start();

// ============================================================
// GRACEFUL SHUTDOWN — drain in-flight customer messages before exit.
// Hosting platforms send SIGTERM with ~30s grace; we cap at 25s
// and force-exit after that to avoid being SIGKILL'd mid-cleanup.
// ============================================================

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully`);
  try {
    await fastify.close();
    console.log('✅ HTTP server closed (no new requests accepted)');

    const deadline = Date.now() + 25_000;
    while (inFlightTasks > 0 && Date.now() < deadline) {
      console.log(`Waiting for ${inFlightTasks} in-flight task(s)...`);
      await new Promise(r => setTimeout(r, 500));
    }
    if (inFlightTasks > 0) {
      console.warn(`⚠️  Shutdown timeout — ${inFlightTasks} task(s) still in flight, exiting anyway`);
    } else {
      console.log('✅ All in-flight tasks finished');
    }

    await closeDatabase();
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
