import 'dotenv/config';
import Fastify from 'fastify';
import { initDatabase, getClientByPhoneNumberId } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';
import crypto from 'crypto';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  }
});

await initDatabase();
await initGoogleSheets();

function extractPhoneNumberId(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;
}

function extractCustomerPhone(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || null;
}

function extractMessageText(payload: any): string | null {
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;
  
  if (message.type === 'interactive') {
    if (message.interactive?.button_reply) return message.interactive.button_reply.title;
    if (message.interactive?.list_reply) return message.interactive.list_reply.title;
  }
  if (message.type === 'text') return message.text?.body || null;
  if (message.type === 'audio') return '[صوت]';
  return null;
}

function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

fastify.get('/', async () => ({ service: 'WhatsApp AI Receptionist', status: 'running', version: '1.0.0' }));
fastify.get('/health', async () => ({ status: 'healthy', uptime: process.uptime() }));

fastify.get('/webhook/whatsapp', async (request, reply) => {
  const query = request.query as any;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    console.log('✅ Webhook verified');
    return reply.send(query['hub.challenge']);
  }
  return reply.code(403).send('Forbidden');
});

fastify.post('/webhook/whatsapp', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const phoneNumberId = extractPhoneNumberId(request.body);
  
  reply.code(200).send({ ok: true });
  
  setImmediate(async () => {
    try {
      if (!phoneNumberId) return;
      
      const customerPhone = extractCustomerPhone(request.body);
      const messageText = extractMessageText(request.body);
      if (!customerPhone || !messageText) return;
      
      const client = await getClientByPhoneNumberId(phoneNumberId);
      if (!client) {
        console.error(`❌ No client found for: ${phoneNumberId}`);
        return;
      }
      
      const body = JSON.stringify(request.body);
      if (false && !verifyWebhookSignature(body, signature, client.verify_token)) {
        console.error('❌ Invalid signature');
        return;
      }
      
      console.log(`📩 Message from ${customerPhone}: ${messageText}`);
      await handleIncomingMessage(phoneNumberId, customerPhone, messageText, client.access_token);
    } catch (error) {
      console.error('❌ Error:', error);
    }
  });
});

const start = async () => {
  const port = parseInt(process.env.PORT || '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 WhatsApp AI Receptionist running on port ${port}`);
};

start();
