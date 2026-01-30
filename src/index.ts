import 'dotenv/config';
import { logError, safeExecute, sanitizeInput } from './services/errorHandler.js';
import { checkRateLimit, isConversationExpired } from './services/rateLimiter.js';
import { isWithinBusinessHours, getOutOfHoursMessage } from './services/businessHours.js';
import { transcribeVoiceNote } from './services/voice.js';
import { 
  initDatabase, 
  getUserState as getDbState, 
  saveUserState as saveDbState,
  deleteUserState as deleteDbState,
  saveLead,
  isDatabaseAvailable 
} from './services/database.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { sendWhatsAppMessage } from './services/whatsapp.js';
import { initGoogleSheets, saveLeadToSheet } from './services/googleSheets.js';
import { generateAIResponse } from './services/ai.js';
import { config } from './config.js';
import type { UserState, LeadData, ConversationMessage } from './types.js';

// ============================================================
// FASTIFY SETUP
// ============================================================

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.isDev ? { target: 'pino-pretty' } : undefined
  }
});

// Register plugins
await fastify.register(cors, { origin: true });
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

// Initialize external services
await initDatabase();
await initGoogleSheets();

// ============================================================
// STATE MANAGEMENT
// ============================================================

// In-memory state (consider Redis for production multi-instance)
const userState = new Map<string, UserState>();
const processedMessages = new Set<string>();

// Constants
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5 minutes
const STATE_EXPIRY_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONVERSATION_HISTORY = 20;

// Periodic cleanup of expired states (every hour)
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
  // Try database first
  if (isDatabaseAvailable()) {
    const dbState = await getDbState(phone);
    if (dbState) return dbState;
  }
  
  // Fallback to memory
  let state = userState.get(phone);
  
  if (!state) {
    state = createNewState();
    userState.set(phone, state);
  }
  
  return state;
}

async function saveUserState(phone: string, state: UserState): Promise<void> {
  state.updatedAt = Date.now();
  
  // Save to memory
  userState.set(phone, state);
  
  // Save to database
  if (isDatabaseAvailable()) {
    await saveDbState(phone, state);
  }
}

// ============================================================
// QUESTIONNAIRE CONFIGURATION
// ============================================================

const PROPERTY_TYPES = ['Villa', 'Apartment', 'Land', 'Commercial Property'] as const;
const CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Other'] as const;
const BUDGETS = [
  'Under 500,000 SAR',
  '500,000 - 1,000,000 SAR',
  '1,000,000 - 2,000,000 SAR',
  'Above 2,000,000 SAR'
] as const;
const BEDROOMS = ['1-2 bedrooms', '3-4 bedrooms', '5-6 bedrooms', '7+ bedrooms'] as const;

// ============================================================
// MESSAGE TEMPLATES
// ============================================================

const MESSAGES = {
  welcome: `مرحباً بك! 👋
Welcome to ${config.agencyName}!

We're here to help you find your dream property. Let me ask you a few questions.

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

  askContact: (data: LeadData) => `Perfect! 🛏️

Here's what you're looking for:

✅ Property Type: ${data.propertyType}
✅ Location: ${data.city}
✅ Budget: ${data.budget}
✅ Bedrooms: ${data.bedrooms}

---

To help our agent contact you, please share your details:

*Full Name, Phone Number, Email*

Example: Ahmed Ali, 0501234567, ahmed@email.com`,

  thankYou: (name: string) => `Thank you, ${name}! 🎉

I've forwarded your requirements to our real estate agent. They will contact you within the next 2 hours.

In the meantime, feel free to ask me any questions about:
• Property prices in your area
• Financing options
• Neighborhoods and amenities
• Anything else about real estate!

I'm here to help! 😊`,

  invalidInput: (validOptions: string) => `❌ Please reply with a valid number (${validOptions})`,

  agentNotification: (lead: LeadData) => `🔔 *New Lead Alert!*

👤 *Name:* ${lead.name}
📱 *Phone:* ${lead.phone}
📧 *Email:* ${lead.email}
💬 *WhatsApp:* ${lead.whatsappPhone}

🏠 *Property Type:* ${lead.propertyType}
📍 *City:* ${lead.city}
💰 *Budget:* ${lead.budget}
🛏️ *Bedrooms:* ${lead.bedrooms}

⏰ *Time:* ${new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' })}

Please contact this lead within 2 hours!`,

  aiFallback: (city: string) => `Thank you for your message! Our real estate agent will contact you soon with more information about properties matching your requirements.

Is there anything specific you'd like to know about real estate in ${city || 'Saudi Arabia'}?`,

  error: 'Something went wrong. Please try again or type "restart" to start over.'
};

// ============================================================
// ROUTES
// ============================================================

fastify.get('/', async () => ({
  status: 'ok',
  service: 'WhatsApp AI SaaS',
  version: config.version,
  environment: config.isDev ? 'development' : 'production'
}));

fastify.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  activeUsers: userState.size
}));

// Webhook verification (Meta requirement)
fastify.get('/webhook/whatsapp/:clientId', async (request, reply) => {
  const query = request.query as Record<string, string>;
  
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.whatsapp.verifyToken) {
    fastify.log.info('✅ Webhook verified');
    return reply.code(200).send(query['hub.challenge']);
  }
  
  fastify.log.warn('❌ Webhook verification failed');
  return reply.code(403).send('Forbidden');
});

// Webhook receiver
fastify.post('/webhook/whatsapp/:clientId', async (request, reply) => {
  const { clientId } = request.params as { clientId: string };
  const payload = request.body as any;
  
  // Extract message from webhook payload
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (!message) {
    return reply.code(200).send({ status: 'no_message' });
  }

  const { id: messageId, from: customerPhone, type: messageType } = message;

  // Deduplication check
  if (processedMessages.has(messageId)) {
    fastify.log.debug(`⚠️ Duplicate skipped: ${messageId}`);
    return reply.code(200).send({ status: 'duplicate' });
  }

  // Mark as processed with auto-cleanup
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL);

  // Handle text messages
  if (messageType === 'text' && message.text?.body) {
    const userMessage = message.text.body.trim();
    
    setImmediate(() => {
      handleConversation(customerPhone, userMessage, clientId).catch(err => {
        fastify.log.error({ err, customerPhone }, 'Error processing message');
      });
    });
  }
  
  // Handle voice notes
  if (messageType === 'audio' && message.audio?.id) {
    const mediaId = message.audio.id;
    const mediaUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
    
    setImmediate(async () => {
      try {
        // Get media URL
        const mediaResponse = await fetch(mediaUrl, {
          headers: { 'Authorization': `Bearer ${config.whatsapp.accessToken}` }
        });
        const mediaData = await mediaResponse.json() as { url: string };
        
        // Transcribe
        const transcription = await transcribeVoiceNote(mediaData.url, config.whatsapp.accessToken);
        
        if (transcription) {
          await handleConversation(customerPhone, transcription, clientId);
        }
      } catch (err) {
        fastify.log.error({ err, customerPhone }, 'Error processing voice note');
      }
    });
  }
  return reply.code(200).send({ status: 'received' });
});

// ============================================================
// CONVERSATION HANDLER
// ============================================================

async function handleConversation(phone: string, message: string, clientId: string): Promise<void> {
  const state = await getUserState(phone);
  const lowerMessage = message.toLowerCase();
  
  fastify.log.info({
    phone,
    step: state.step,
    leadCaptured: state.leadCaptured,
    message: message.substring(0, 50)
  }, '📩 Processing message');

  // Handle restart command
  if (lowerMessage === 'restart' || lowerMessage === 'reset') {
    userState.delete(phone);
    const newState = await getUserState(phone);
    await sendWelcomeMessage(phone, newState);
    return;
  }

  // Route based on state
  if (state.leadCaptured) {
    await handleAIChat(phone, message, state);
  } else if (state.step === 0) {
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
  await await await await await await await await await await await await await saveUserState(phone, state);
  fastify.log.info({ phone }, '🆕 Welcome sent');
}

// ============================================================
// LEAD CAPTURE FLOW
// ============================================================

async function handleLeadCapture(phone: string, message: string, state: UserState): Promise<void> {
  let response: string;
  const input = message.trim();

  switch (state.step) {
    case 1: // Property Type
      const propertyIndex = parseInt(input) - 1;
      if (propertyIndex >= 0 && propertyIndex < PROPERTY_TYPES.length) {
        state.data.propertyType = PROPERTY_TYPES[propertyIndex];
        response = MESSAGES.askCity;
        state.step = 2;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 2: // City
      const cityIndex = parseInt(input) - 1;
      if (cityIndex >= 0 && cityIndex < CITIES.length) {
        state.data.city = CITIES[cityIndex];
        response = MESSAGES.askBudget;
        state.step = 3;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, 4, or 5');
      }
      break;

    case 3: // Budget
      const budgetIndex = parseInt(input) - 1;
      if (budgetIndex >= 0 && budgetIndex < BUDGETS.length) {
        state.data.budget = BUDGETS[budgetIndex];
        response = MESSAGES.askBedrooms;
        state.step = 4;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 4: // Bedrooms
      const bedroomIndex = parseInt(input) - 1;
      if (bedroomIndex >= 0 && bedroomIndex < BEDROOMS.length) {
        state.data.bedrooms = BEDROOMS[bedroomIndex];
        response = MESSAGES.askContact(state.data as LeadData);
        state.step = 5;
      } else {
        response = MESSAGES.invalidInput('1, 2, 3, or 4');
      }
      break;

    case 5: // Contact Info
      const contactParts = input.split(',').map(p => p.trim());
      
      // Validate we have at least a name
      if (!contactParts[0] || contactParts[0].length < 2) {
        response = 'Please provide your contact info in this format:\n*Name, Phone, Email*\n\nExample: Ahmed Ali, 0501234567, ahmed@email.com';
        break;
      }

      // Build lead data
      const leadData: LeadData = {
        ...state.data as LeadData,
        name: contactParts[0],
        phone: contactParts[1] || phone,
        email: contactParts[2] || 'N/A',
        whatsappPhone: phone,
        timestamp: new Date().toISOString()
      };

      // Save and notify (parallel execution)
      await Promise.allSettled([
        saveLeadToSheet(leadData).catch(err => fastify.log.error({ err }, 'Failed to save lead')),
        notifyAgent(leadData).catch(err => fastify.log.error({ err }, 'Failed to notify agent'))
      ]);

      // Mark as captured
      state.leadCaptured = true;
      state.data = leadData;
      state.conversationHistory.push({
        role: 'assistant',
        content: `Customer ${leadData.name} is looking for ${leadData.propertyType} in ${leadData.city}, budget ${leadData.budget}, ${leadData.bedrooms}.`
      });

      response = MESSAGES.thankYou(leadData.name);
      fastify.log.info({ phone, name: leadData.name }, '✅ Lead captured');
      break;

    default:
      response = MESSAGES.error;
      state.step = 0;
  }

  await sendWhatsAppMessage(phone, response);
  await await await await await await await await await await await await saveUserState(phone, state);
}

// ============================================================
// AI CHAT MODE
// ============================================================

async function handleAIChat(phone: string, message: string, state: UserState): Promise<void> {
  // Add user message to history
  state.conversationHistory.push({ role: 'user', content: message });

  // Build system prompt with customer context
  const systemPrompt = `You are a helpful real estate assistant for ${config.agencyName} in Saudi Arabia.

CUSTOMER CONTEXT:
- Name: ${state.data.name || 'Customer'}
- Looking for: ${state.data.propertyType || 'property'}
- Preferred location: ${state.data.city || 'Saudi Arabia'}
- Budget: ${state.data.budget || 'Not specified'}
- Bedrooms: ${state.data.bedrooms || 'Not specified'}

GUIDELINES:
- Be friendly, professional, and concise
- Answer questions about real estate in Saudi Arabia
- Provide info on neighborhoods, prices, market trends
- Match the customer's language (Arabic or English)
- If unsure, say so honestly
- Remind them an agent will contact them for specific listings
- NEVER ask for contact info again - we already have it
- Keep responses under 300 words`;

  try {
    const aiResponse = await generateAIResponse(systemPrompt, state.conversationHistory);
    
    // Add to history and trim if needed
    state.conversationHistory.push({ role: 'assistant', content: aiResponse });
    if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
      state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
    }

    await sendWhatsAppMessage(phone, aiResponse);
    await await await await await await await await await await await await saveUserState(phone, state);
    fastify.log.info({ phone }, '🤖 AI response sent');
    
  } catch (err) {
    fastify.log.error({ err, phone }, 'AI generation failed');
    await sendWhatsAppMessage(phone, MESSAGES.aiFallback(state.data.city || "Saudi Arabia"));
  }
}

// ============================================================
// AGENT NOTIFICATION
// ============================================================

async function notifyAgent(lead: LeadData): Promise<void> {
  await sendWhatsAppMessage(config.agentPhone, MESSAGES.agentNotification(lead));
  fastify.log.info({ agentPhone: config.agentPhone }, '📲 Agent notified');
}

// ============================================================
// SERVER START
// ============================================================

const start = async (): Promise<void> => {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    
    console.log(`
🚀 WhatsApp AI SaaS v${config.version}
════════════════════════════════════════
📡 Server:     http://localhost:${config.port}
🌍 Environment: ${config.isDev ? 'development' : 'production'}
✅ Features:   Lead Capture → AI Chat → Agent Notify
════════════════════════════════════════
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// ============================================================
// ADMIN API ENDPOINTS
// ============================================================

fastify.get('/admin/stats', async (request, reply) => {
  const auth = request.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  
  return {
    activeConversations: userState.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
});

fastify.get('/admin/leads', async (request, reply) => {
  const auth = request.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  
  const { getLeads } = await import('./services/database.js');
  const leads = await getLeads(100);
  return { count: leads.length, leads };
});
