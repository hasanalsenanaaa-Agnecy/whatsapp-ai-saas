import 'dotenv/config';
import Fastify from 'fastify';
import { initDatabase, getClientByPhoneNumberId } from './services/database.js';
import { initGoogleSheets } from './services/googleSheets.js';
import { handleIncomingMessage } from './conversation.js';
import { handleReminderCron } from './cron/reminders.js';
import crypto from 'crypto';
import { sendAlert, alertError } from './services/alerts.js';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  }
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
  if (message.type === 'audio') return '[voice]';
  return null;
}

function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  
  try {
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    
    return signature === expectedSignature;
  } catch (error) {
    console.error('Signature error:', error);
    return false;
  }
}

// Health check routes
fastify.get('/', async () => ({ service: 'WhatsApp AI Receptionist', status: 'running', version: '2.0.0' }));
fastify.get('/health', async () => ({ status: 'healthy', uptime: process.uptime() }));

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
        console.error('No client found for: ' + phoneNumberId);
        return;
      }
      
      const appSecret = process.env.WHATSAPP_APP_SECRET || client.verify_token;
      
      // TODO: Fix signature verification - temporarily disabled
      // if (appSecret && !verifyWebhookSignature(rawBody, signature, appSecret)) {
      //   console.error('Invalid signature');
      //   return;
      // }
      
      console.log('Message from ' + customerPhone + ': ' + messageText);
      await handleIncomingMessage(phoneNumberId, customerPhone, messageText, client.access_token);
    } catch (error) {
      console.error('Error:', error);
      await alertError(error as Error, 'Webhook processing failed');
    }
  });
});

// Cron endpoint for appointment reminders
fastify.post('/cron/reminders', async (request, reply) => {
  await handleReminderCron(request, reply);
});

const start = async () => {
  const port = parseInt(process.env.PORT || '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log('WhatsApp AI Receptionist running on port ' + port);
  await sendAlert('info', 'Server started', 'WhatsApp AI Bot running on port ' + port);
};
start();
