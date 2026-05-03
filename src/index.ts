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

// Public marketing pages — also satisfy Meta's Tech Provider review requirement
// for a real landing page + privacy policy + terms of service at the App's URL.
const html = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fafafa}
.wrap{max-width:760px;margin:0 auto;padding:48px 24px}
header{padding-bottom:32px;border-bottom:1px solid #e5e5e5;margin-bottom:32px}
.brand{font-size:24px;font-weight:700;color:#0a0a0a;text-decoration:none}
.brand span{color:#16a34a}
nav{margin-top:16px}
nav a{color:#525252;margin-right:20px;text-decoration:none;font-size:14px}
nav a:hover{color:#16a34a}
h1{font-size:32px;margin-bottom:16px;color:#0a0a0a}
h2{font-size:20px;margin:32px 0 12px;color:#0a0a0a}
h3{font-size:16px;margin:20px 0 8px;color:#262626}
p,li{margin-bottom:12px;color:#404040}
ul{padding-left:24px}
strong{color:#171717}
.lead{font-size:18px;color:#525252;margin-bottom:24px}
footer{margin-top:64px;padding-top:24px;border-top:1px solid #e5e5e5;color:#737373;font-size:13px}
footer a{color:#16a34a;text-decoration:none}
.muted{color:#737373;font-size:13px}
code{background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:13px}
</style></head>
<body><div class="wrap">
<header>
<a href="/" class="brand">Flow<span>mation</span></a>
<nav><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
</header>
${body}
<footer>© 2026 Flowmation · <a href="mailto:hasanalsenanaaa@gmail.com">hasanalsenanaaa@gmail.com</a> · Kingdom of Saudi Arabia</footer>
</div></body></html>`;

fastify.get('/', async (_req, reply) => reply.type('text/html').send(html('Flowmation — WhatsApp AI for Gulf businesses', `
<h1>WhatsApp automation, built for the Gulf.</h1>
<p class="lead">Flowmation lets Saudi and Kuwaiti SMBs run their entire WhatsApp customer experience on autopilot — Arabic-first AI, native Shopify checkout, appointment booking, and lead qualification.</p>
<h2>What it does</h2>
<ul>
<li><strong>Arabic + English conversations</strong> handled by Claude, with handover to a human when the customer asks</li>
<li><strong>Shopify catalog browsing and checkout</strong> inside WhatsApp — customers pay and the bot confirms</li>
<li><strong>Appointment booking</strong> for clinics, salons, and service providers</li>
<li><strong>Lead capture and qualification</strong> for real estate, car dealerships, education</li>
<li><strong>Owner notifications</strong> on every order, lead, and escalation</li>
</ul>
<h2>Built on official infrastructure</h2>
<p>We use the Meta WhatsApp Business Cloud API directly — no grey-market gateways, no message risk. Customer data is encrypted at rest, retained for 24 months, and complies with Saudi PDPL.</p>
<h2>Get in touch</h2>
<p>Onboarding is invitation-based while we work with launch partners. Email <a href="mailto:hasanalsenanaaa@gmail.com">hasanalsenanaaa@gmail.com</a> if you operate a Gulf SMB and want a demo.</p>
`)));

fastify.get('/privacy', async (_req, reply) => reply.type('text/html').send(html('Privacy Policy — Flowmation', `
<h1>Privacy Policy</h1>
<p class="muted">Last updated: 3 May 2026</p>
<p>Flowmation ("we", "us") provides a WhatsApp customer-service automation platform to businesses ("our clients"). This policy explains what data we collect from end customers who message our clients via WhatsApp, how we use it, and the rights end customers have.</p>

<h2>Who is the data controller</h2>
<p>For end-customer messages received through a client's WhatsApp number, that <strong>client business is the data controller</strong>. Flowmation acts as a data processor on the client's behalf. For our own marketing site visitors, Flowmation is the controller.</p>

<h2>What we collect</h2>
<ul>
<li><strong>WhatsApp phone number</strong> of each end customer who messages a Flowmation client</li>
<li><strong>Message content</strong> exchanged between the end customer and the bot</li>
<li><strong>Conversation state</strong> (current step in the bot flow, language preference)</li>
<li><strong>Order events</strong> from connected Shopify stores (order ID, total, currency, status — when an end customer pays)</li>
<li><strong>Aggregate analytics</strong> (number of conversations, response times, AI usage) for billing and reporting to the client</li>
</ul>
<p>We do <strong>not</strong> collect WhatsApp profile pictures, contact lists, location data, or any data outside the conversation thread itself.</p>

<h2>How we use it</h2>
<ul>
<li>Deliver bot responses in real time</li>
<li>Forward messages to Anthropic's Claude API for AI conversation processing (only the message text is sent — phone numbers are masked)</li>
<li>Notify the client business owner of new orders, leads, and escalation requests</li>
<li>Generate usage and revenue reports for the client</li>
</ul>

<h2>Where data is stored</h2>
<p>Conversation data is stored in PostgreSQL (Neon, US-East region). Sensitive tokens (Shopify access tokens, third-party credentials) are encrypted at rest using AES-256-GCM. Backend infrastructure runs on Render.</p>

<h2>Third parties we share data with</h2>
<ul>
<li><strong>Meta (WhatsApp Business Cloud API)</strong> — message delivery</li>
<li><strong>Anthropic (Claude API)</strong> — AI processing of message text</li>
<li><strong>Shopify</strong> — order lookup and webhook events for clients with connected stores</li>
<li><strong>Google Sheets API</strong> — optional logging of leads and orders to client-owned sheets</li>
<li><strong>Neon, Render, Upstash QStash</strong> — hosting and infrastructure</li>
</ul>

<h2>Data retention</h2>
<p>Conversation history is automatically deleted <strong>24 months</strong> after the last activity, in line with Saudi Personal Data Protection Law (PDPL). Order events are retained for the same period. Aggregated analytics may be kept indefinitely in fully anonymized form.</p>

<h2>End-customer rights (PDPL)</h2>
<ul>
<li><strong>Right to deletion</strong> — an end customer can request immediate deletion of all their data by messaging the client business or contacting us at <a href="mailto:hasanalsenanaaa@gmail.com">hasanalsenanaaa@gmail.com</a>. Deletion is processed within 7 days.</li>
<li><strong>Right to access</strong> — request a copy of stored data via the same channel.</li>
<li><strong>Right to object</strong> — opt out of automated processing by replying "stop" or "إيقاف" in any conversation.</li>
</ul>

<h2>Children</h2>
<p>The service is not directed to anyone under 18. We do not knowingly collect data from minors.</p>

<h2>Changes to this policy</h2>
<p>We will update the "Last updated" date at the top whenever this policy changes. Material changes will be communicated to client businesses by email.</p>

<h2>Contact</h2>
<p>Privacy enquiries: <a href="mailto:hasanalsenanaaa@gmail.com">hasanalsenanaaa@gmail.com</a></p>
`)));

fastify.get('/terms', async (_req, reply) => reply.type('text/html').send(html('Terms of Service — Flowmation', `
<h1>Terms of Service</h1>
<p class="muted">Last updated: 3 May 2026</p>
<p>These terms ("Terms") govern your use of Flowmation ("the Service"), provided by Hassan Abdulhakeem A Al Senan, registered freelance practitioner under the Saudi Ministry of Human Resource and Social Development (Authorized Document ID FL-848503968), based in Qatif, Saudi Arabia.</p>

<h2>1. Service description</h2>
<p>Flowmation provides software that automates customer-facing WhatsApp conversations on behalf of business clients. The Service connects to a client's WhatsApp Business Account through the official Meta WhatsApp Business Cloud API.</p>

<h2>2. Eligibility</h2>
<p>You must be at least 18 years old and the legal owner or authorized representative of the business connecting its WhatsApp account.</p>

<h2>3. Acceptable use</h2>
<p>You agree not to use the Service to:</p>
<ul>
<li>Send unsolicited bulk messages or spam</li>
<li>Distribute illegal, harassing, deceptive, or fraudulent content</li>
<li>Impersonate any person or business</li>
<li>Reverse-engineer, scrape, or attempt unauthorized access to the Service</li>
<li>Violate Meta's <a href="https://www.whatsapp.com/legal/business-policy/">WhatsApp Business Messaging Policy</a> or any applicable law</li>
</ul>
<p>Violation of this section may result in immediate suspension without refund.</p>

<h2>4. Your responsibilities</h2>
<ul>
<li>Maintain accurate business information in your account</li>
<li>Obtain consent from your end customers as required by Saudi PDPL and Meta's policies</li>
<li>Respond to end-customer rights requests (deletion, access) we forward to you</li>
<li>Keep your access credentials confidential</li>
</ul>

<h2>5. Pricing and billing</h2>
<p>Pricing is set per individual client agreement. Where usage caps are part of an agreement, overages are billed monthly in arrears. We reserve the right to change list pricing with 30 days' notice; existing client agreements are honoured for the remainder of their term.</p>

<h2>6. Service availability</h2>
<p>We provide the Service on a best-effort basis. We do not guarantee uninterrupted availability and we are not liable for downtime caused by upstream providers (Meta, Anthropic, Shopify, Render, Neon).</p>

<h2>7. Intellectual property</h2>
<p>The Flowmation software, brand, and documentation remain our exclusive property. You retain ownership of all content sent through your WhatsApp account.</p>

<h2>8. Limitation of liability</h2>
<p>To the fullest extent permitted by law, Flowmation's total liability for any claim arising from the Service shall not exceed the fees you paid in the 3 months preceding the claim. We are not liable for indirect, incidental, or consequential damages, including lost profits or lost data.</p>

<h2>9. Indemnification</h2>
<p>You agree to indemnify and hold harmless Flowmation against any claim arising from your use of the Service in violation of these Terms or applicable law, including end-customer complaints about message content you authorized.</p>

<h2>10. Termination</h2>
<p>Either party may terminate the Service with 30 days' written notice. We may terminate immediately for material breach of section 3. Upon termination, your data is deleted within 30 days unless legally required to retain it.</p>

<h2>11. Governing law</h2>
<p>These Terms are governed by the laws of the Kingdom of Saudi Arabia. Disputes are subject to the exclusive jurisdiction of the courts of the Eastern Province.</p>

<h2>12. Contact</h2>
<p>Legal and contractual questions: <a href="mailto:hasanalsenanaaa@gmail.com">hasanalsenanaaa@gmail.com</a></p>
`)));
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
