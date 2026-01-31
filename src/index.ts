import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { initDatabase, isDatabaseAvailable, getClientByPhoneNumberId, getLeads, getClientStats } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';
import { transcribeVoiceNote } from './services/voice.js';
import { generateDashboardHTML } from './dashboard.js';
import { sanitizeInput } from './services/errorHandler.js';
import { checkRateLimit } from './services/rateLimiter.js';

// ============================================================
// FASTIFY SETUP
// ============================================================

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  }
});

await fastify.register(cors, { origin: true });
await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

await initDatabase();
await initGoogleSheets();

// ============================================================
// DEDUPLICATION
// ============================================================

const processedMessages = new Set<string>();
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

// ============================================================
// ROUTES
// ============================================================

fastify.get('/', async () => ({
  status: 'ok',
  service: 'WhatsApp AI SaaS',
  version: '4.0.0',
  multiTenant: true
}));

fastify.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  database: isDatabaseAvailable() ? 'connected' : 'disconnected'
}));

// ============================================================
// WEBHOOK (Multi-tenant)
// ============================================================

fastify.get('/webhook/whatsapp/:clientId', async (request, reply) => {
  const query = request.query as Record<string, string>;
  const { clientId } = request.params as { clientId: string };
  
  // Get client to verify token
  const client = await getClientByPhoneNumberId(clientId);
  const verifyToken = client?.verify_token || process.env.WHATSAPP_VERIFY_TOKEN || 'verify-token';
  
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    fastify.log.info(`✅ Webhook verified for client: ${clientId}`);
    return reply.code(200).send(query['hub.challenge']);
  }
  
  return reply.code(403).send('Forbidden');
});

fastify.post('/webhook/whatsapp/:clientId', async (request, reply) => {
  const payload = request.body as any;
  
  // Extract data from webhook
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const phoneNumberId = value?.metadata?.phone_number_id;
  
  if (!message || !phoneNumberId) {
    return reply.code(200).send({ status: 'no_message' });
  }

  const { id: messageId, from: customerPhone, type: messageType } = message;

  // Deduplication
  if (processedMessages.has(messageId)) {
    return reply.code(200).send({ status: 'duplicate' });
  }
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL);

  // Get client config
  const client = await getClientByPhoneNumberId(phoneNumberId);
  
  if (!client) {
    fastify.log.error(`❌ Unknown phone_number_id: ${phoneNumberId}`);
    return reply.code(200).send({ status: 'unknown_client' });
  }

  // Rate limit per user
  if (!checkRateLimit(customerPhone)) {
    fastify.log.warn(`⚠️ Rate limited: ${customerPhone}`);
    return reply.code(200).send({ status: 'rate_limited' });
  }

  // Handle text messages
  if (messageType === 'text' && message.text?.body) {
    const userMessage = sanitizeInput(message.text.body.trim());
    
    if (userMessage) {
      setImmediate(() => {
        handleIncomingMessage(phoneNumberId, customerPhone, userMessage, client.access_token)
          .catch(err => fastify.log.error({ err, customerPhone }, 'Error processing message'));
      });
    }
  }
  
  // Handle voice messages
  if (messageType === 'audio' && message.audio?.id) {
    setImmediate(async () => {
      try {
        const mediaUrl = `https://graph.facebook.com/v21.0/${message.audio.id}`;
        const mediaResponse = await fetch(mediaUrl, {
          headers: { 'Authorization': `Bearer ${client.access_token}` }
        });
        const mediaData = await mediaResponse.json() as { url: string };
        
        const transcription = await transcribeVoiceNote(mediaData.url, client.access_token);
        
        if (transcription) {
          await handleIncomingMessage(phoneNumberId, customerPhone, transcription, client.access_token);
        }
      } catch (err) {
        fastify.log.error({ err, customerPhone }, 'Error processing voice');
      }
    });
  }

  return reply.code(200).send({ status: 'received' });
});

// ============================================================
// DASHBOARD (Multi-tenant)
// ============================================================

fastify.get('/dashboard/:clientId', async (request, reply) => {
  const { clientId } = request.params as { clientId: string };
  const { key } = request.query as { key: string };
  
  if (key !== process.env.ADMIN_API_KEY) {
    return reply.code(401).send('Unauthorized. Add ?key=YOUR_ADMIN_KEY');
  }

  const stats = await getClientStats(clientId);
  const leads = await getLeads(clientId, 50);

  const html = generateDashboardHTML({
    totalLeads: stats.totalLeads || 0,
    leadsToday: stats.todayLeads || 0,
    leadsThisWeek: stats.weekLeads || 0,
    leadsByCity: {},
    leadsByProperty: {},
    recentLeads: leads.map(l => ({
      name: l.name,
      phone: l.phone,
      propertyType: l.data?.interest || '-',
      city: l.data?.preference || '-',
      budget: l.data?.budget || '-',
      timestamp: l.createdAt
    }))
  });

  reply.type('text/html');
  return html;
});

// ============================================================
// ADMIN API
// ============================================================

fastify.get('/admin/clients', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  
  // This would list all clients - implement as needed
  return { message: 'Use database directly to manage clients' };
});

fastify.get('/admin/stats/:clientId', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  
  const { clientId } = request.params as { clientId: string };
  const stats = await getClientStats(clientId);
  
  return stats;
});

// ============================================================
// START
// ============================================================

const start = async (): Promise<void> => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    
    console.log(`
🚀 WhatsApp AI SaaS v4.0.0 (Multi-tenant)
════════════════════════════════════════
📡 Server: http://localhost:${port}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
✅ Database: ${isDatabaseAvailable() ? 'Connected' : 'Not available'}
✅ Multi-tenant: Ready
════════════════════════════════════════
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
