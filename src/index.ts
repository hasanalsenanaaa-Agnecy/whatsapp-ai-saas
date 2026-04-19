import 'dotenv/config';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { initDatabase, getClientByPhoneNumberId } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';
import { handleReminderCron } from './cron/reminders.js';
import { handleAbandonedCartCron } from './cron/abandoned-cart.js';
import { handleShopifyWebhook } from './services/shopify-webhook.js';
import { checkRateLimit, checkTenantRateLimit } from './services/rateLimiter.js';
import { maskPhone } from './utils/buttons.js';
import crypto from 'crypto';
import { sendAlert, alertError } from './services/alerts.js';
import { emitEvent } from './services/events.js';
import { getRevenueByClient, getConversionFunnel, getUsageSummary, getTopProducts, getAICostSummary } from './services/analytics.js';

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
fastify.get('/health', async () => ({ status: 'healthy', uptime: process.uptime() }));

// Analytics API — protected by ANALYTICS_KEY env var
fastify.get('/api/analytics/revenue', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  return getRevenueByClient(query.client_id, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/funnel', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  if (!query.client_id) return reply.code(400).send({ error: 'client_id required' });
  return getConversionFunnel(query.client_id, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/usage', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  return getUsageSummary(query.client_id, parseInt(query.months) || 3);
});

fastify.get('/api/analytics/products', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  if (!query.client_id) return reply.code(400).send({ error: 'client_id required' });
  return getTopProducts(query.client_id, parseInt(query.months) || 3, parseInt(query.limit) || 10);
});

fastify.get('/api/analytics/ai-cost', async (request, reply) => {
  const query = request.query as any;
  if (query.key !== process.env.ANALYTICS_KEY) return reply.code(401).send({ error: 'unauthorized' });
  return getAICostSummary(query.client_id, parseInt(query.months) || 3);
});

// WhatsApp webhook verification
fastify.get('/webhook/whatsapp', async (request, reply) => {
  const query = request.query as any;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    console.log('Webhook verified');
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

  setImmediate(async () => {
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
    } catch (error) {
      console.error('Webhook processing error:', error);
      emitEvent('system', 'error', customerPhone || undefined, { error: (error as Error)?.message });
      await alertError(error as Error, 'Webhook processing failed');
    }
  });
});

// Cron endpoint for appointment reminders
fastify.post('/cron/reminders', async (request, reply) => {
  await handleReminderCron(request, reply);
});

// Cron endpoint for abandoned cart recovery
fastify.post('/cron/abandoned-cart', async (request, reply) => {
  await handleAbandonedCartCron(request, reply);
});

// Shopify orders/paid webhook
fastify.post('/webhook/shopify', async (request, reply) => {
  const rawBody = (request as any).rawBody as string;
  const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string | undefined;
  const shopDomain = request.headers['x-shopify-shop-domain'] as string | undefined;
  const topic = request.headers['x-shopify-topic'] as string | undefined;

  // Acknowledge immediately — Shopify requires fast response
  reply.code(200).send({ ok: true });

  setImmediate(async () => {
    try {
      await handleShopifyWebhook(request.body, rawBody, hmacHeader, shopDomain, topic);
    } catch (error) {
      console.error('Shopify webhook error:', error);
    }
  });
});

const start = async () => {
  const port = parseInt(process.env.PORT || '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log('WhatsApp AI Receptionist running on port ' + port);
  await sendAlert('info', 'Server started', 'WhatsApp AI Bot running on port ' + port);
};
start();
