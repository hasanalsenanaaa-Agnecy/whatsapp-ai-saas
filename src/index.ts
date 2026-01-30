import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { sendWhatsAppMessage } from './services/whatsapp.js';
import { initGoogleSheets, saveLeadToSheet } from './services/googleSheets.js';
import { config } from './config.js';
import { sanitizeInput } from './services/errorHandler.js';
import { checkRateLimit } from './services/rateLimiter.js';
import { transcribeVoiceNote } from './services/voice.js';
import { 
  initDatabase, 
  getUserState as getDbState, 
  saveUserState as saveDbState,
  saveLead,
  isDatabaseAvailable 
} from './services/database.js';
import type { UserState, LeadData } from './types.js';

// ============================================================
// FASTIFY SETUP
// ============================================================

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.isDev ? { target: 'pino-pretty' } : undefined
  }
});

await fastify.register(cors, { origin: true });
await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

await initDatabase();
await initGoogleSheets();

// ============================================================
// STATE MANAGEMENT
// ============================================================

const userState = new Map<string, UserState>();
const processedMessages = new Set<string>();

const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;
const STATE_EXPIRY_TTL = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  userState.forEach((state, phone) => {
    if (now - state.createdAt > STATE_EXPIRY_TTL) {
      userState.delete(phone);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    fastify.log.info(`🧹 Cleaned ${cleaned} expired user states`);
  }
}, 60 * 60 * 1000);

// ============================================================
// STATE HELPERS
// ============================================================

function createNewState(): UserState {
  return {
    step: 0,
    data: {},
    leadCaptured: false,
    conversationHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

async function getUserState(phone: string): Promise<UserState> {
  if (isDatabaseAvailable()) {
    const dbState = await getDbState(phone);
    if (dbState) {
      if (typeof dbState.data !== 'object' || dbState.data === null) dbState.data = {};
      if (!Array.isArray(dbState.conversationHistory)) dbState.conversationHistory = [];
      if (typeof dbState.step !== 'number' || dbState.step < 0 || dbState.step > 999) {
        dbState.step = 0;
        dbState.leadCaptured = false;
      }
      return dbState;
    }
  }
  
  let state = userState.get(phone);
  if (!state) {
    state = createNewState();
    userState.set(phone, state);
  }
  return state;
}

async function saveUserState(phone: string, state: UserState): Promise<void> {
  state.updatedAt = Date.now();
  userState.set(phone, state);
  if (isDatabaseAvailable()) {
    await saveDbState(phone, state);
  }
}

// ============================================================
// CONFIGURATION
// ============================================================

const PROPERTY_TYPES = ['Villa', 'Apartment', 'Land', 'Commercial Property'] as const;
const CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Other'] as const;
const BUDGETS = ['Under 500,000 SAR', '500,000 - 1,000,000 SAR', '1,000,000 - 2,000,000 SAR', 'Above 2,000,000 SAR'] as const;
const BEDROOMS = ['1-2 bedrooms', '3-4 bedrooms', '5-6 bedrooms', '7+ bedrooms'] as const;

// ============================================================
// MESSAGE TEMPLATES
// ============================================================

const MESSAGES = {
  welcome: `مرحباً بك! 👋
Welcome to ${config.agencyName}!

We're here to help you find your dream property.

What type of property interests you?

1️⃣ Villa (فيلا)
2️⃣ Apartment (شقة)
3️⃣ Land (أرض)
4️⃣ Commercial Property (عقار تجاري)

Please reply with a number (1-4)`,

  askCity: `Excellent choice! 🏡

Which city are you interested in?

1️⃣ Riyadh (الرياض)
2️⃣ Jeddah (جدة)
3️⃣ Dammam (الدمام)
4️⃣ Khobar (الخبر)
5️⃣ Other (مدينة أخرى)

Please reply with a number (1-5)`,

  askBudget: `Perfect! 📍

What is your budget range?

1️⃣ Under 500,000 SAR
2️⃣ 500,000 - 1,000,000 SAR
3️⃣ 1,000,000 - 2,000,000 SAR
4️⃣ Above 2,000,000 SAR

Please reply with a number (1-4)`,

  askBedrooms: `Great! 💰

How many bedrooms do you need?

1️⃣ 1-2 bedrooms
2️⃣ 3-4 bedrooms
3️⃣ 5-6 bedrooms
4️⃣ 7+ bedrooms

Please reply with a number (1-4)`,

  askContact: (data: Partial<LeadData>) => `Perfect! 🛏️

Here's what you're looking for:

✅ Property Type: ${data.propertyType}
✅ Location: ${data.city}
✅ Budget: ${data.budget}
✅ Bedrooms: ${data.bedrooms}

---

Please share your contact details:

*Full Name, Phone Number, Email*

Example: Ahmed Ali, 0501234567, ahmed@email.com`,

  thankYou: (name: string) => `Thank you, ${name}! 🎉

Our agent will contact you within 2 hours.`,

  invalidInput: (options: string) => `❌ Please reply with a valid number (${options})`,

  agentNotification: (lead: LeadData) => `🔔 *New Lead!*

👤 ${lead.name}
📱 ${lead.phone}
📧 ${lead.email}
💬 WhatsApp: ${lead.whatsappPhone}

🏠 ${lead.propertyType}
📍 ${lead.city}
💰 ${lead.budget}
🛏️ ${lead.bedrooms}

⏰ ${new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' })}`,

  error: 'Something went wrong. Please try again.'
};

// ============================================================
// ROUTES
// ============================================================

fastify.get('/', async () => ({
  status: 'ok',
  service: 'WhatsApp AI SaaS',
  version: config.version
}));

fastify.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  activeUsers: userState.size
}));

fastify.get('/webhook/whatsapp/:clientId', async (request, reply) => {
  const query = request.query as Record<string, string>;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.whatsapp.verifyToken) {
    fastify.log.info('✅ Webhook verified');
    return reply.code(200).send(query['hub.challenge']);
  }
  return reply.code(403).send('Forbidden');
});

fastify.post('/webhook/whatsapp/:clientId', async (request, reply) => {
  const payload = request.body as any;
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (!message) return reply.code(200).send({ status: 'no_message' });

  const { id: messageId, from: customerPhone, type: messageType } = message;

  if (processedMessages.has(messageId)) {
    return reply.code(200).send({ status: 'duplicate' });
  }
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL);

  if (messageType === 'text' && message.text?.body) {
    setImmediate(() => {
      handleConversation(customerPhone, message.text.body.trim()).catch(err => {
        fastify.log.error({ err, customerPhone }, 'Error processing message');
      });
    });
  }
  
  if (messageType === 'audio' && message.audio?.id) {
    setImmediate(async () => {
      try {
        const mediaUrl = `https://graph.facebook.com/v21.0/${message.audio.id}`;
        const mediaResponse = await fetch(mediaUrl, {
          headers: { 'Authorization': `Bearer ${config.whatsapp.accessToken}` }
        });
        const mediaData = await mediaResponse.json() as { url: string };
        const transcription = await transcribeVoiceNote(mediaData.url, config.whatsapp.accessToken);
        if (transcription) {
          await handleConversation(customerPhone, transcription);
        }
      } catch (err) {
        fastify.log.error({ err, customerPhone }, 'Error processing voice');
      }
    });
  }

  return reply.code(200).send({ status: 'received' });
});

// ============================================================
// CONVERSATION HANDLER
// ============================================================

async function handleConversation(phone: string, message: string): Promise<void> {
  if (!checkRateLimit(phone)) {
    await sendWhatsAppMessage(phone, '⚠️ Too many messages. Please wait a minute.');
    return;
  }

  message = sanitizeInput(message);
  if (!message) return;

  const state = await getUserState(phone);
  
  fastify.log.info({ phone, step: state.step, leadCaptured: state.leadCaptured }, '📩 Message received');

  // If lead already captured, ignore all messages
  if (state.leadCaptured) {
    return;
  }
  
  if (state.step === 0) {
    await sendWelcomeMessage(phone, state);
  } else {
    await handleLeadCapture(phone, message, state);
  }
}

// ============================================================
// WELCOME MESSAGE
// ============================================================

async function sendWelcomeMessage(phone: string, state: UserState): Promise<void> {
  await sendWhatsAppMessage(phone, MESSAGES.welcome);
  state.step = 1;
  await saveUserState(phone, state);
  fastify.log.info({ phone }, '🆕 Welcome sent');
}

// ============================================================
// LEAD CAPTURE
// ============================================================

async function handleLeadCapture(phone: string, message: string, state: UserState): Promise<void> {
  let response: string;
  const input = message.trim();

  switch (state.step) {
    case 1:
      const propIdx = parseInt(input) - 1;
      if (propIdx >= 0 && propIdx < PROPERTY_TYPES.length) {
        state.data.propertyType = PROPERTY_TYPES[propIdx];
        response = MESSAGES.askCity;
        state.step = 2;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 2:
      const cityIdx = parseInt(input) - 1;
      if (cityIdx >= 0 && cityIdx < CITIES.length) {
        state.data.city = CITIES[cityIdx];
        response = MESSAGES.askBudget;
        state.step = 3;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, 4, or 5');
      }
      break;

    case 3:
      const budgetIdx = parseInt(input) - 1;
      if (budgetIdx >= 0 && budgetIdx < BUDGETS.length) {
        state.data.budget = BUDGETS[budgetIdx];
        response = MESSAGES.askBedrooms;
        state.step = 4;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 4:
      const bedIdx = parseInt(input) - 1;
      if (bedIdx >= 0 && bedIdx < BEDROOMS.length) {
        state.data.bedrooms = BEDROOMS[bedIdx];
        response = MESSAGES.askContact(state.data);
        state.step = 5;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 5:
      const parts = input.split(',').map(p => p.trim());
      if (!parts[0] || parts[0].length < 2) {
        response = 'Please provide: *Name, Phone, Email*\n\nExample: Ahmed Ali, 0501234567, ahmed@email.com';
        break;
      }

      const leadData: LeadData = {
        ...state.data as LeadData,
        name: parts[0],
        phone: parts[1] || phone,
        email: parts[2] || 'N/A',
        whatsappPhone: phone,
        timestamp: new Date().toISOString()
      };

      await Promise.allSettled([
        saveLeadToSheet(leadData),
        saveLead(leadData),
        notifyAgent(leadData)
      ]);

      state.leadCaptured = true;
      state.data = leadData;

      response = MESSAGES.thankYou(leadData.name);
      fastify.log.info({ phone, name: leadData.name }, '✅ Lead captured');
      break;

    default:
      response = MESSAGES.error;
      state.step = 0;
  }

  await sendWhatsAppMessage(phone, response);
  await saveUserState(phone, state);
}

// ============================================================
// AGENT NOTIFICATION
// ============================================================

async function notifyAgent(lead: LeadData): Promise<void> {
  await sendWhatsAppMessage(config.agentPhone, MESSAGES.agentNotification(lead));
  fastify.log.info('📲 Agent notified');
}

// ============================================================
// ADMIN API
// ============================================================

fastify.get('/admin/stats', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  return {
    activeConversations: userState.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
});

fastify.get('/admin/leads', async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const { getLeads } = await import('./services/database.js');
  const leads = await getLeads(100);
  return { count: leads.length, leads };
});

// ============================================================
// START
// ============================================================

const start = async (): Promise<void> => {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`
🚀 WhatsApp AI SaaS v${config.version}
════════════════════════════════════════
📡 Server: http://localhost:${config.port}
🌍 Environment: ${config.isDev ? 'development' : 'production'}
✅ Database: ${isDatabaseAvailable() ? 'Connected' : 'Not available'}
✅ 24/7 Mode: Always active
════════════════════════════════════════
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
