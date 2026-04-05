import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from './services/whatsapp.js';
import { getConversation, saveConversation, createLead, getClientByPhoneNumberId, createAppointment } from './services/database.js';
import { formatMessage, getDefaultMessages, ClientMessages, SHOPIFY_MESSAGES, SHOPIFY_EXTRA_MESSAGES } from './messages.js';
import { saveLeadToSheet } from './services/googleSheets.js';
import { 
  generateKnowledgeResponse, 
  detectHandoverIntent, 
  looksLikeQuestion, 
  scoreLead,
  isAIAvailable
} from './services/knowledge.js';
import {
  getAvailableDates,
  getTimeSlots,
  parseDateSelection,
  parseTimeSelection,
  formatAppointmentConfirmation,
  formatAppointmentNotification,
  calculateReminderTime,
  DEFAULT_APPOINTMENT_SETTINGS,
  type AppointmentSettings
} from './services/appointments.js';
import {
  fetchProducts,
  searchProducts,
  getProductById,
  createCheckout,
  formatPriceSAR,
  type ShopifyProduct
} from './services/shopify.js';
import {
  getAIResponse,
  isAIConversationAvailable
} from './services/ai-conversation.js';

// ============================================================
// TYPES
// ============================================================

interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: 'welcome' | 'questions' | 'appointment_date' | 'appointment_time' | 'completed' | 'chat'
       | 'shopify_browse' | 'shopify_search' | 'shopify_product' | 'shopify_cart' | 'shopify_confirmed'
       | 'ai_conversation';
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface ClientFeatures {
  ai_fallback: boolean;
  lead_scoring: boolean;
  handover_detection: boolean;
  appointment_setting: boolean;
  ai_conversation: boolean;
}

const CONVERSATION_TIMEOUT_HOURS = 24;

// ============================================================
// POST-COMPLETION INTENT DETECTION
// ============================================================

interface DetectedIntent {
  type: 'cancel' | 'reschedule' | 'status_update' | 'complaint' | 'talk_to_agent' | 'general';
  confidence: 'high' | 'medium';
  forwardToAgent: boolean;
}

function detectPostCompletionIntent(message: string): DetectedIntent {
  const lower = message.toLowerCase().trim();

  // Cancel intent
  const cancelKeywords = ['cancel', 'الغاء', 'ألغي', 'الغي', 'لا ابي', 'ما ابي', 'لا أبي', 'ما أبي', 'كنسل', 'الغ'];
  if (cancelKeywords.some(k => lower.includes(k))) {
    return { type: 'cancel', confidence: 'high', forwardToAgent: true };
  }

  // Reschedule intent
  const rescheduleKeywords = ['reschedule', 'تغيير موعد', 'غير الموعد', 'تأجيل', 'أجل', 'اجل', 'تعديل موعد', 'بدل الموعد'];
  if (rescheduleKeywords.some(k => lower.includes(k))) {
    return { type: 'reschedule', confidence: 'high', forwardToAgent: true };
  }

  // Status update / tracking intent
  const statusKeywords = ['update', 'status', 'وين طلبي', 'وين الطلب', 'تحديث', 'وش صار', 'متى يوصل', 'tracking', 'track', 'وصل'];
  if (statusKeywords.some(k => lower.includes(k))) {
    return { type: 'status_update', confidence: 'high', forwardToAgent: true };
  }

  // Complaint intent
  const complaintKeywords = ['شكوى', 'complaint', 'مشكلة', 'problem', 'issue', 'زعلان', 'مو راضي', 'سيء', 'خرب'];
  if (complaintKeywords.some(k => lower.includes(k))) {
    return { type: 'complaint', confidence: 'high', forwardToAgent: true };
  }

  // Talk to human / agent
  const agentKeywords = ['agent', 'human', 'person', 'موظف', 'شخص', 'بشر', 'أكلم أحد', 'اكلم احد', 'ممثل', 'خدمة عملاء'];
  if (agentKeywords.some(k => lower.includes(k))) {
    return { type: 'talk_to_agent', confidence: 'high', forwardToAgent: true };
  }

  // General follow-up (greetings, questions, etc.)
  return { type: 'general', confidence: 'medium', forwardToAgent: false };
}

// Intent-specific response messages (Gulf Arabic)
const INTENT_RESPONSES: Record<string, string> = {
  cancel: 'تم استلام طلب الإلغاء ✅\nفريقنا بيتواصل معك قريب لتأكيد الإلغاء.',
  reschedule: 'تم استلام طلب تغيير الموعد ✅\nفريقنا بيتواصل معك قريب لتحديد موعد جديد.',
  status_update: 'شكراً على تواصلك! 👍\nفريقنا بيرد عليك بتحديث قريب.',
  complaint: 'نعتذر عن أي إزعاج 🙏\nفريقنا بيتواصل معك بأسرع وقت لحل الموضوع.',
  talk_to_agent: 'تمام! 👍\nبنحولك لأحد فريقنا يتواصل معك خلال دقائق.',
};

// Agent notification templates for each intent
const INTENT_AGENT_NOTIFICATIONS: Record<string, string> = {
  cancel: '🚨 *طلب إلغاء*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  reschedule: '📅 *طلب تغيير موعد*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  status_update: '📦 *استفسار عن حالة*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  complaint: '⚠️ *شكوى عميل*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  talk_to_agent: '📞 *طلب تحويل لموظف*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
};

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleIncomingMessage(
  phoneNumberId: string,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  // Get client configuration
  const client = await getClientByPhoneNumberId(phoneNumberId);
  if (!client) {
    console.error(`❌ No client found for: ${phoneNumberId}`);
    return;
  }

  // Parse features with defaults
  const features: ClientFeatures = {
    ai_fallback: client.features?.ai_fallback || false,
    lead_scoring: client.features?.lead_scoring || false,
    handover_detection: client.features?.handover_detection || false,
    appointment_setting: client.features?.appointment_setting || false,
    ai_conversation: client.features?.ai_conversation || false
  };

  // Get appointment settings from client or use defaults
  const appointmentSettings: AppointmentSettings = {
    ...DEFAULT_APPOINTMENT_SETTINGS,
    ...client.settings?.appointment
  };

  // Get messages - use code defaults, only override questions from database
  const defaults = getDefaultMessages(client.industry);
  const clientMessages: ClientMessages = {
    ...defaults,
    questions: client.questions?.length > 0 ? client.questions : defaults.questions
  };

  // Get or create conversation
  let conv = await getConversation(client.id, customerPhone);
  const now = new Date().toISOString();
  
  const shouldReset = checkShouldReset(conv, message);
  
  if (!conv || shouldReset) {
    conv = {
      clientId: client.id,
      phone: customerPhone,
      messages: [],
      state: 'welcome',
      step: 0,
      data: { whatsappPhone: customerPhone },
      createdAt: now,
      updatedAt: now
    };
  }

  conv.updatedAt = now;
  conv.messages.push({ role: 'user', content: message });

  // Check for back command (only during active flow, not after completion)
  if (conv.state !== 'completed' && conv.state !== 'chat') {
    const backResult = handleBackCommand(message, conv);
    if (backResult.handled) {
      conv.state = backResult.newState as any;
      conv.step = backResult.newStep;
    }
  }

  // ============================================================
  // HANDOVER DETECTION (if enabled, works in any state)
  // ============================================================
  if (features.handover_detection && detectHandoverIntent(message)) {
    await handleHandoverRequest(client, conv, message, clientMessages, accessToken);
    await saveConversation(conv);
    return;
  }

  // ============================================================
  // STATE MACHINE
  // ============================================================

  // AI CONVERSATION MODE — skip rigid flow entirely
  if (features.ai_conversation && isAIConversationAvailable()) {
    if (conv.state === 'welcome' || conv.state === 'ai_conversation') {
      conv.state = 'ai_conversation';
      await handleAIConversation(client, conv, message, features, accessToken);
      await saveConversation(conv);
      return;
    }
    // AI mode completed — don't respond to further messages
    if (conv.state === 'completed' || conv.state === 'chat') {
      await saveConversation(conv);
      return;
    }
  }

  switch (conv.state) {
    case 'welcome':
      await handleWelcome(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'questions':
      await handleQuestions(client, conv, message, clientMessages, features, appointmentSettings, accessToken);
      break;
    case 'appointment_date':
      await handleAppointmentDate(client, conv, message, clientMessages, appointmentSettings, accessToken);
      break;
    case 'appointment_time':
      await handleAppointmentTime(client, conv, message, clientMessages, appointmentSettings, accessToken);
      break;
    // Shopify states
    case 'shopify_browse':
      await handleShopifyBrowse(client, conv, message, accessToken);
      break;
    case 'shopify_search':
      await handleShopifySearch(client, conv, message, accessToken);
      break;
    case 'shopify_product':
      await handleShopifyProduct(client, conv, message, accessToken);
      break;
    case 'shopify_cart':
      await handleShopifyCart(client, conv, message, clientMessages, accessToken);
      break;
    case 'shopify_confirmed':
      await handleShopifyConfirmed(client, conv, message, accessToken);
      break;
    case 'ai_conversation':
      await handleAIConversation(client, conv, message, features, accessToken);
      break;
    case 'completed':
      // Transition to chat state for any follow-up
      conv.state = 'chat';
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'chat':
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
  }

  await saveConversation(conv);
}

// ============================================================
// STATE HANDLERS
// ============================================================

/**
 * Welcome state: Ask for name immediately
 */
async function handleWelcome(
  client: any, 
  conv: ConversationState, 
  message: string,
  messages: ClientMessages, 
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  // First message: Send welcome and ask for name
  if (!conv.data.welcomeSent) {
    const welcomeMsg = formatMessage(messages.welcome, { businessName: client.name });
    await sendWhatsAppMessage(conv.phone, welcomeMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: welcomeMsg });
    conv.data.welcomeSent = true;
    return;
  }

  // Validate name
  const name = message.trim();
  const normalized = normalizeArabicNumbers(name);
  
  // Check if it looks like a question instead of a name
  if (features.ai_fallback && looksLikeQuestion(message)) {
    await handleAIFallback(client, conv, message, accessToken);
    // Re-ask for name
    await sendWhatsAppMessage(conv.phone, messages.askName, accessToken, client.phone_number_id);
    return;
  }
  
  // Reject if too short or only numbers
  if (name.length < 2 || /^\d+$/.test(normalized)) {
    await sendWhatsAppMessage(conv.phone, messages.askName, accessToken, client.phone_number_id);
    return;
  }
  
  // Save name and move to questions
  conv.data.name = name;
  conv.data.phone = conv.phone;
  conv.state = 'questions';
  conv.step = 0;
  
  await sendQuestion(client, conv, messages, accessToken);
}
async function handleQuestions(
  client: any, 
  conv: ConversationState, 
  message: string,
  messages: ClientMessages, 
  features: ClientFeatures,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const questions = messages.questions || [];
  const currentQuestion = questions[conv.step];
  
  // No more questions - move to appointment or completion
  if (!currentQuestion) {
    if (features.appointment_setting) {
      await startAppointmentFlow(client, conv, messages, appointmentSettings, accessToken);
    } else {
      await completeLead(client, conv, messages, features, null, accessToken);
    }
    return;
  }

  const options = currentQuestion.options || [];
  const lowerMessage = message.toLowerCase().trim();
  const normalizedMessage = normalizeArabicNumbers(message.trim());
  
  // Try exact match
  let selectedOption = options.find((opt: string) => opt.toLowerCase() === lowerMessage || opt === message.trim());
  
  // Try number match (including Arabic numerals)
  if (!selectedOption) {
    const num = parseInt(normalizedMessage);
    if (num >= 1 && num <= options.length) selectedOption = options[num - 1];
  }
  
  // No match - check if it's a question (AI fallback) or invalid input
  if (!selectedOption) {
    if (features.ai_fallback && looksLikeQuestion(message)) {
      await handleAIFallback(client, conv, message, accessToken);
      // Re-send current question
      await sendQuestion(client, conv, messages, accessToken);
      return;
    }
    
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    await sendQuestion(client, conv, messages, accessToken);
    return;
  }
  
  // Save answer and move to next question
  const fieldName = currentQuestion.field || `answer_${conv.step}`;
  conv.data[fieldName] = selectedOption;
  conv.step++;
  
  const nextQuestion = questions[conv.step];
  if (nextQuestion) {
    await sendQuestion(client, conv, messages, accessToken);
  } else {
    // All questions answered — route Shopify industry to product browsing
    if (client.industry === 'shopify' || client.industry === 'ecommerce') {
      await routeShopifyIntent(client, conv, selectedOption, accessToken);
    } else if (features.appointment_setting) {
      await startAppointmentFlow(client, conv, messages, appointmentSettings, accessToken);
    } else {
      await completeLead(client, conv, messages, features, null, accessToken);
    }
  }
}

/**
 * Appointment date selection
 */
async function handleAppointmentDate(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const availableDates = getAvailableDates(appointmentSettings);
  const selection = parseDateSelection(message, availableDates);
  
  if (!selection) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    await sendAppointmentDateOptions(client, conv, messages, appointmentSettings, accessToken);
    return;
  }
  
  conv.data.appointmentDate = selection.date;
  conv.data.appointmentDateLabel = selection.label;
  conv.state = 'appointment_time';
  
  await sendAppointmentTimeOptions(client, conv, messages, appointmentSettings, accessToken);
}

/**
 * Appointment time selection
 */
async function handleAppointmentTime(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const features: ClientFeatures = {
    ai_fallback: client.features?.ai_fallback || false,
    lead_scoring: client.features?.lead_scoring || false,
    handover_detection: client.features?.handover_detection || false,
    appointment_setting: client.features?.appointment_setting || false,
    ai_conversation: client.features?.ai_conversation || false
  };
  
  const availableSlots = getTimeSlots(appointmentSettings);
  const selection = parseTimeSelection(message, availableSlots);
  
  if (!selection) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    await sendAppointmentTimeOptions(client, conv, messages, appointmentSettings, accessToken);
    return;
  }
  
  conv.data.appointmentTimeSlot = selection.id;
  conv.data.appointmentTimeLabel = selection.label;
  
  // Calculate reminder time
  const reminderAt = calculateReminderTime(
    conv.data.appointmentDate,
    selection.id,
    appointmentSettings
  );
  conv.data.appointmentReminderAt = reminderAt.toISOString();
  
  // Complete lead with appointment
  await completeLead(client, conv, messages, features, appointmentSettings, accessToken);
}

/**
 * Chat state: Handle post-completion follow-ups
 * Detects intent (cancel, reschedule, status, complaint, general)
 * Uses AI if available, otherwise sends appropriate response + notifies agent
 */
async function handleChat(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  // Detect what the customer wants
  const intent = detectPostCompletionIntent(message);

  console.log(`💬 Chat intent: ${intent.type} (${intent.confidence}) from ${conv.data.name || conv.phone}`);

  // HIGH-PRIORITY INTENTS: Always forward to agent + send specific response
  if (intent.forwardToAgent) {
    // Send intent-specific response to customer
    const response = INTENT_RESPONSES[intent.type];
    await sendWhatsAppMessage(conv.phone, response, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response });

    // Notify agent with context
    const notificationTemplate = INTENT_AGENT_NOTIFICATIONS[intent.type];
    if (notificationTemplate) {
      const notification = formatMessage(notificationTemplate, {
        name: conv.data.name || 'غير معروف',
        phone: conv.phone,
        whatsapp: conv.phone.replace('+', ''),
        message: message,
        time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
      });

      for (const agentPhone of client.agent_phones || []) {
        try {
          await sendWhatsAppMessage(agentPhone, notification, accessToken, client.phone_number_id);
        } catch (error) {
          console.error(`❌ Agent notify error:`, error);
        }
      }
    }

    // Track the intent
    if (!conv.data.postCompletionIntents) conv.data.postCompletionIntents = [];
    conv.data.postCompletionIntents.push({
      type: intent.type,
      message: message,
      time: new Date().toISOString()
    });

    return;
  }

  // GENERAL MESSAGES: Use AI if available, otherwise friendly acknowledgment
  if (features.ai_fallback && isAIAvailable()) {
    await handleAIFallback(client, conv, message, accessToken);
  } else {
    // Simple friendly response - acknowledge and let them know agent will follow up
    const name = conv.data.name || '';
    const fallbackMsg = `أهلاً ${name}! 👋\nمعلوماتك وصلتنا وفريقنا بيتواصل معك قريب.\nإذا تبي تتكلم مع أحد فريقنا، رد بـ "موظف" وبنحولك.`;
    await sendWhatsAppMessage(conv.phone, fallbackMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: fallbackMsg });
  }
}

// ============================================================
// AI CONVERSATION MODE
// Natural AI-driven flow — replaces rigid state machine
// ============================================================

async function handleAIConversation(
  client: any,
  conv: ConversationState,
  message: string,
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  // Build context for AI
  const questions = client.questions?.length > 0
    ? client.questions.map((q: any, i: number) => ({
        text: q.text || q.question || `سؤال ${i + 1}`,
        options: q.options || [],
        field: q.field || `answer_${i}`
      }))
    : [];

  // Auto-save phone from WhatsApp — no need to ask
  if (!conv.data.phone) {
    conv.data.phone = conv.phone;
  }

  const promptCtx = {
    businessName: client.name || '',
    industry: client.industry || 'generic',
    questions,
    knowledgeBase: client.knowledge_base || [],
    settings: client.settings || {},
    bookingState: { ...conv.data },
    customerPhone: conv.phone
  };

  // Get AI response
  const { parsed, rawResponse } = await getAIResponse(
    promptCtx,
    conv.messages,
    message
  );

  console.log(`🤖 AI raw: ${rawResponse.substring(0, 200)}`);

  // Save extracted data
  if (Object.keys(parsed.data).length > 0) {
    for (const [key, value] of Object.entries(parsed.data)) {
      conv.data[key] = value;
    }
    console.log(`📝 Data saved:`, parsed.data);
  }

  // Handle HANDOVER
  if (parsed.handover) {
    const defaults = getDefaultMessages(client.industry);
    await handleHandoverRequest(client, conv, message, defaults, accessToken);
    return;
  }

  // Handle COMPLETE — save lead + notify agent, then STOP
  if (parsed.complete) {
    // Send final message before completing
    if (parsed.text) {
      await sendWhatsAppMessage(conv.phone, parsed.text, accessToken, client.phone_number_id);
      conv.messages.push({ role: 'assistant', content: parsed.text });
    }
    const defaults = getDefaultMessages(client.industry);
    const appointmentSettings: AppointmentSettings = {
      ...DEFAULT_APPOINTMENT_SETTINGS,
      ...client.settings?.appointment
    };
    await completeLead(client, conv, defaults, features, appointmentSettings, accessToken);
    conv.state = 'completed';
    return;
  }

  // Send ONE message — buttons/list take priority over plain text
  if (parsed.buttons && parsed.buttons.options.length > 0) {
    const opts = parsed.buttons.options.slice(0, 3);
    // Use text as body if it exists, otherwise use button body
    const body = parsed.text || parsed.buttons.body;
    await sendWhatsAppButtons(
      conv.phone,
      body,
      opts.map((opt, i) => ({ id: `ai_opt_${i}`, title: opt.substring(0, 20) })),
      accessToken,
      client.phone_number_id
    );
    conv.messages.push({ role: 'assistant', content: body });
  } else if (parsed.list && parsed.list.options.length > 0) {
    const opts = parsed.list.options.slice(0, 10);
    const body = parsed.text || parsed.list.body;
    await sendWhatsAppList(
      conv.phone,
      body,
      parsed.list.buttonText.substring(0, 20),
      opts.map((opt, i) => ({ id: `ai_list_${i}`, title: opt.substring(0, 24) })),
      accessToken,
      client.phone_number_id
    );
    conv.messages.push({ role: 'assistant', content: body });
  } else if (parsed.text) {
    await sendWhatsAppMessage(conv.phone, parsed.text, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: parsed.text });
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function checkShouldReset(conv: ConversationState | null, message: string): boolean {
  if (!conv) return true;
  const lastUpdate = new Date(conv.updatedAt);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > CONVERSATION_TIMEOUT_HOURS) return true;
  
  const restartKeywords = ['restart', 'start over', 'من جديد', 'ابدا من جديد', 'reset', 'بداية'];
  return restartKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

function handleBackCommand(message: string, conv: ConversationState): { handled: boolean; newState: string; newStep: number } {
  const backKeywords = ['back', 'رجوع', 'السابق', 'ارجع', 'previous'];
  if (!backKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
    return { handled: false, newState: conv.state, newStep: conv.step };
  }
  
  if (conv.state === 'questions' && conv.step > 0) {
    return { handled: true, newState: 'questions', newStep: conv.step - 1 };
  } else if (conv.state === 'questions' && conv.step === 0) {
    return { handled: true, newState: 'welcome', newStep: 0 };
  } else if (conv.state === 'appointment_date') {
    return { handled: true, newState: 'questions', newStep: conv.step };
  } else if (conv.state === 'appointment_time') {
    return { handled: true, newState: 'appointment_date', newStep: 0 };
  }
  return { handled: false, newState: conv.state, newStep: conv.step };
}

function normalizeArabicNumbers(text: string): string {
  const arabicToEnglish: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  return text.split('').map(c => arabicToEnglish[c] || c).join('');
}

async function sendQuestion(client: any, conv: ConversationState, messages: ClientMessages, accessToken: string): Promise<void> {
  const questions = messages.questions || [];
  const question = questions[conv.step];
  if (!question) return;
  
  const options = question.options || [];
  
  if (options.length <= 3) {
    await sendWhatsAppButtons(
      conv.phone,
      question.text,
      options.map((opt: string, i: number) => ({ id: `opt_${i}`, title: opt })),
      accessToken,
      client.phone_number_id
    );
  } else {
    await sendWhatsAppList(
      conv.phone,
      question.text,
      'اختر',
      options.map((opt: string, i: number) => ({ id: `opt_${i}`, title: opt })),
      accessToken,
      client.phone_number_id
    );
  }
  
  conv.messages.push({ role: 'assistant', content: question.text });
}

// ============================================================
// APPOINTMENT FLOW
// ============================================================

async function startAppointmentFlow(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  conv.state = 'appointment_date';
  await sendAppointmentDateOptions(client, conv, messages, appointmentSettings, accessToken);
}

async function sendAppointmentDateOptions(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const dates = getAvailableDates(appointmentSettings);
  
  await sendWhatsAppButtons(
    conv.phone,
    messages.askAppointmentDate,
    dates.slice(0, 3).map(d => ({ id: d.id, title: d.label.substring(0, 20) })),
    accessToken,
    client.phone_number_id
  );
  
  conv.messages.push({ role: 'assistant', content: messages.askAppointmentDate });
}

async function sendAppointmentTimeOptions(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const slots = getTimeSlots(appointmentSettings);
  
  await sendWhatsAppButtons(
    conv.phone,
    messages.askAppointmentTime,
    slots.map(s => ({ id: s.id, title: s.label })),
    accessToken,
    client.phone_number_id
  );
  
  conv.messages.push({ role: 'assistant', content: messages.askAppointmentTime });
}

// ============================================================
// AI FALLBACK
// ============================================================

async function handleAIFallback(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  if (!isAIAvailable()) {
    console.warn('⚠️ AI not available, skipping fallback');
    return;
  }
  
  try {
    const response = await generateKnowledgeResponse(
      client.name,
      client.knowledge_base || [],
      conv.data,
      conv.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      message
    );
    
    await sendWhatsAppMessage(conv.phone, response.answer, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response.answer });
    
    // Track that AI was used
    conv.data.aiUsed = true;
    conv.data.askedAboutPrice = conv.data.askedAboutPrice || 
      message.includes('سعر') || message.includes('كم') || message.includes('تكلفة');
    
  } catch (error) {
    console.error('❌ AI fallback error:', error);
  }
}

// ============================================================
// HANDOVER
// ============================================================

async function handleHandoverRequest(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  // Send handover message to customer
  await sendWhatsAppMessage(conv.phone, messages.handoverDetected, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: messages.handoverDetected });
  
  // Notify agent
  const notification = formatMessage(messages.handoverAgentNotification, {
    name: conv.data.name || 'غير معروف',
    phone: conv.phone,
    whatsapp: conv.phone.replace('+', ''),
    lastMessage: message
  });
  
  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, notification, accessToken, client.phone_number_id);
    } catch (error) {
      console.error(`❌ Agent notify error:`, error);
    }
  }
  
  conv.data.handoverRequested = true;
}

// ============================================================
// SHOPIFY FLOW
// ============================================================

/** Get Shopify config from client settings */
function getShopifyConfig(client: any): { domain: string; storefrontToken: string } | null {
  const shopify = client.settings?.shopify;
  if (!shopify?.domain || !shopify?.storefrontToken) return null;
  return { domain: shopify.domain, storefrontToken: shopify.storefrontToken };
}

/** Route customer to the right Shopify state based on their first question answer */
async function routeShopifyIntent(
  client: any,
  conv: ConversationState,
  selectedOption: string,
  accessToken: string
): Promise<void> {
  if (selectedOption === 'تصفح المنتجات') {
    conv.state = 'shopify_browse';
    await showShopifyProductList(client, conv, accessToken);
  } else if (selectedOption === 'البحث عن منتج') {
    conv.state = 'shopify_search';
    const searchPrompt = SHOPIFY_EXTRA_MESSAGES.searchPrompt;
    await sendWhatsAppMessage(conv.phone, searchPrompt, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: searchPrompt });
  } else if (selectedOption === 'متابعة طلب' || selectedOption === 'تكلم مع موظف') {
    // Route to handover / agent
    const handoverMsg = 'تمام! بنحولك لأحد فريقنا يساعدك. 🙏';
    await sendWhatsAppMessage(conv.phone, handoverMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: handoverMsg });
    for (const agentPhone of client.agent_phones || []) {
      try {
        const notif = `📞 *طلب تحويل - ${selectedOption}*\n\n👤 ${conv.data.name || 'غير معروف'}\n📱 ${conv.phone}\n💬 wa.me/${conv.phone.replace('+', '')}\n⏰ ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}`;
        await sendWhatsAppMessage(agentPhone, notif, accessToken, client.phone_number_id);
      } catch (err) {
        console.error('❌ Agent notify error:', err);
      }
    }
    conv.state = 'chat';
  } else {
    // Default to browse
    conv.state = 'shopify_browse';
    await showShopifyProductList(client, conv, accessToken);
  }
}

/** Fetch and display products as a WhatsApp list */
async function showShopifyProductList(
  client: any,
  conv: ConversationState,
  accessToken: string
): Promise<void> {
  const config = getShopifyConfig(client);
  if (!config) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }

  const products = await fetchProducts(config.domain, config.storefrontToken, 10);

  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noProducts, accessToken, client.phone_number_id);
    return;
  }

  // Store products for reference by index
  conv.data.shopifyProducts = products;

  const listItems = products.map((p, i) => ({
    id: `product_${i}`,
    title: p.title.substring(0, 24),
    description: `${formatPriceSAR(p.priceMin)} ريال`
  }));

  await sendWhatsAppList(
    conv.phone,
    SHOPIFY_EXTRA_MESSAGES.productList,
    'اختر منتج',
    listItems,
    accessToken,
    client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: SHOPIFY_EXTRA_MESSAGES.productList });
}

/**
 * shopify_browse state: Customer is viewing product list, select a product
 */
async function handleShopifyBrowse(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data.shopifyProducts || [];
  const normalizedMessage = normalizeArabicNumbers(message.trim());

  // Match by product index ("product_N"), by number, or by title
  let selectedProduct: ShopifyProduct | undefined;

  if (message.startsWith('product_')) {
    const idx = parseInt(message.replace('product_', ''));
    selectedProduct = products[idx];
  } else {
    const num = parseInt(normalizedMessage);
    if (num >= 1 && num <= products.length) {
      selectedProduct = products[num - 1];
    } else {
      selectedProduct = products.find(p => p.title.toLowerCase().includes(message.toLowerCase().trim()));
    }
  }

  if (!selectedProduct) {
    // Re-show list
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noProducts, accessToken, client.phone_number_id);
    await showShopifyProductList(client, conv, accessToken);
    return;
  }

  conv.data.selectedProductId = selectedProduct.id;
  conv.data.selectedProductTitle = selectedProduct.title;
  conv.data.selectedVariantId = selectedProduct.variants.find(v => v.available)?.id || selectedProduct.variants[0]?.id;
  conv.data.selectedProductPrice = selectedProduct.priceMin;
  conv.state = 'shopify_product';

  await showShopifyProductDetails(client, conv, selectedProduct, accessToken);
}

/** Show product details with "اطلب الحين" button */
async function showShopifyProductDetails(
  client: any,
  conv: ConversationState,
  product: ShopifyProduct,
  accessToken: string
): Promise<void> {
  const description = product.description
    ? product.description.substring(0, 200)
    : '';

  const detailMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.productDetails, {
    productName: product.title,
    price: formatPriceSAR(product.priceMin),
    description
  });

  await sendWhatsAppButtons(
    conv.phone,
    detailMsg,
    [{ id: 'order_now', title: SHOPIFY_EXTRA_MESSAGES.orderButton }],
    accessToken,
    client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: detailMsg });
}

/**
 * shopify_search state: Customer typed a search term
 */
async function handleShopifySearch(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const config = getShopifyConfig(client);
  if (!config) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }

  const results = await searchProducts(config.domain, config.storefrontToken, message, 10);

  if (results.length === 0) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noSearchResults, accessToken, client.phone_number_id);
    // Offer to browse all
    await showShopifyProductList(client, conv, accessToken);
    conv.state = 'shopify_browse';
    return;
  }

  // Store search results as the current product list and show them
  conv.data.shopifyProducts = results;
  conv.state = 'shopify_browse';
  await showShopifyProductList(client, conv, accessToken);
}

/**
 * shopify_product state: Customer is viewing product details
 * Expects "اطلب الحين" / "order_now" or any confirmation
 */
async function handleShopifyProduct(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const isOrder = lower === 'order_now' || message.includes('اطلب') || message.includes('أطلب') || message === '1';

  if (!isOrder) {
    // Re-show product details
    const config = getShopifyConfig(client);
    if (conv.data.selectedProductId && config) {
      const product = await getProductById(config.domain, config.storefrontToken, conv.data.selectedProductId);
      if (product) {
        await showShopifyProductDetails(client, conv, product, accessToken);
        return;
      }
    }
    // Fallback: show buttons again
    await sendWhatsAppButtons(
      conv.phone,
      `تبي تطلب *${conv.data.selectedProductTitle || 'المنتج'}*؟`,
      [{ id: 'order_now', title: SHOPIFY_EXTRA_MESSAGES.orderButton }],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Create checkout
  const config = getShopifyConfig(client);
  if (!config || !conv.data.selectedVariantId) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }

  conv.state = 'shopify_cart';
  const checkout = await createCheckout(config.domain, config.storefrontToken, conv.data.selectedVariantId, 1);

  if (!checkout) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    conv.state = 'shopify_product';
    return;
  }

  conv.data.checkoutUrl = checkout.checkoutUrl;
  conv.data.checkoutPrice = checkout.totalPrice;

  // Send checkout link to customer
  const checkoutMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.checkoutLink, { checkoutUrl: checkout.checkoutUrl });
  await sendWhatsAppMessage(conv.phone, checkoutMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: checkoutMsg });

  // Notify owner
  const orderNotification = formatMessage(SHOPIFY_MESSAGES.agentNotification, {
    name: conv.data.name || 'غير معروف',
    phone: conv.phone,
    whatsapp: conv.phone.replace('+', ''),
    productName: conv.data.selectedProductTitle || '-',
    price: formatPriceSAR(conv.data.selectedProductPrice || conv.data.checkoutPrice),
    checkoutUrl: checkout.checkoutUrl,
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, orderNotification, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('❌ Order notify error:', err);
    }
  }

  // Prompt customer to confirm payment
  await sendWhatsAppButtons(
    conv.phone,
    'بعد ما تكمل الدفع، اضغط الزر أدناه لتأكيد طلبك ✅',
    [{ id: 'confirm_payment', title: SHOPIFY_EXTRA_MESSAGES.confirmPaymentButton }],
    accessToken,
    client.phone_number_id
  );
}

/**
 * shopify_cart state: Waiting for payment confirmation from customer
 */
async function handleShopifyCart(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const isConfirm = lower === 'confirm_payment'
    || message.includes('تأكيد الدفع')
    || message.includes('تأكيد')
    || message.includes('دفعت')
    || message.includes('تم الدفع');

  if (!isConfirm) {
    // Re-prompt
    await sendWhatsAppButtons(
      conv.phone,
      'بعد ما تكمل الدفع، اضغط الزر أدناه ✅',
      [{ id: 'confirm_payment', title: SHOPIFY_EXTRA_MESSAGES.confirmPaymentButton }],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  conv.state = 'shopify_confirmed';

  // Confirm to customer
  const confirmMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.orderConfirmed, {
    name: conv.data.name || ''
  });
  await sendWhatsAppMessage(conv.phone, confirmMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: confirmMsg });

  // Thank you
  const thankYouMsg = formatMessage(messages.thankYou, { businessName: client.name });
  await sendWhatsAppMessage(conv.phone, thankYouMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: thankYouMsg });

  // Payment confirmation to owner
  const paymentNotif = formatMessage(SHOPIFY_EXTRA_MESSAGES.paymentConfirmation, {
    name: conv.data.name || 'غير معروف',
    phone: conv.phone,
    productName: conv.data.selectedProductTitle || '-',
    price: formatPriceSAR(conv.data.selectedProductPrice || conv.data.checkoutPrice || '0'),
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, paymentNotif, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('❌ Payment notify error:', err);
    }
  }

  // Save lead in DB
  try {
    await createLead({
      clientId: client.id,
      phone: conv.phone,
      name: conv.data.name || '',
      email: '',
      data: conv.data,
      score: 'hot'
    });
  } catch (err) {
    console.error('❌ Lead save error (shopify):', err);
  }

  console.log(`✅ Shopify order confirmed: ${conv.data.name} (${conv.phone}) - ${conv.data.selectedProductTitle}`);
}

/**
 * shopify_confirmed state: Order confirmed, handle follow-up messages
 */
async function handleShopifyConfirmed(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  // Check for follow-up intents (cancel, status, etc.)
  const intent = detectPostCompletionIntent(message);
  if (intent.forwardToAgent) {
    const response = INTENT_RESPONSES[intent.type];
    if (response) {
      await sendWhatsAppMessage(conv.phone, response, accessToken, client.phone_number_id);
      conv.messages.push({ role: 'assistant', content: response });
    }
    const notificationTemplate = INTENT_AGENT_NOTIFICATIONS[intent.type];
    if (notificationTemplate) {
      const notification = formatMessage(notificationTemplate, {
        name: conv.data.name || 'غير معروف',
        phone: conv.phone,
        whatsapp: conv.phone.replace('+', ''),
        message,
        time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
      });
      for (const agentPhone of client.agent_phones || []) {
        try {
          await sendWhatsAppMessage(agentPhone, notification, accessToken, client.phone_number_id);
        } catch (error) {
          console.error('❌ Agent notify error:', error);
        }
      }
    }
    return;
  }

  const fallbackMsg = `أهلاً ${conv.data.name || ''}! 👋\nطلبك على طريقه. إذا تحتاج مساعدة، رد بـ "موظف".`;
  await sendWhatsAppMessage(conv.phone, fallbackMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: fallbackMsg });
}

// ============================================================
// LEAD COMPLETION
// ============================================================

async function completeLead(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  features: ClientFeatures,
  appointmentSettings: AppointmentSettings | null,
  accessToken: string
): Promise<void> {
  // Calculate lead score
  const leadScore = features.lead_scoring ? scoreLead(conv.data) : 'new';
  
  // Create lead
  const leadId = await createLead({
    clientId: client.id,
    phone: conv.phone,
    name: conv.data.name,
    email: '',
    data: conv.data,
    score: leadScore
  });

  conv.data.leadId = leadId;

  // Create appointment if applicable
  let appointmentId = null;
  if (features.appointment_setting && conv.data.appointmentDate && conv.data.appointmentTimeSlot) {
    appointmentId = await createAppointment({
      clientId: client.id,
      leadId: leadId,
      phone: conv.phone,
      name: conv.data.name,
      appointmentDate: conv.data.appointmentDate,
      timeSlot: conv.data.appointmentTimeSlot,
      timeLabel: conv.data.appointmentTimeLabel,
      appointmentType: conv.data.appointment_type || conv.data.interest,
      status: 'pending',
      reminderSent: false,
      reminderAt: conv.data.appointmentReminderAt ? new Date(conv.data.appointmentReminderAt) : undefined,
      notes: JSON.stringify(conv.data)
    });
    conv.data.appointmentId = appointmentId;
  }

  // Save to Google Sheets
  if (client.settings?.googleSheetId) {
    try {
      await saveLeadToSheet(client, conv.data);
    } catch (error) {
      console.error('❌ Sheets error:', error);
    }
  }

  // Prepare details for notifications
  const details = Object.entries(conv.data)
    .filter(([k]) => !['name', 'phone', 'whatsappPhone', 'welcomeSent', 'leadId', 'appointmentId', 
                       'appointmentDate', 'appointmentDateLabel', 'appointmentTimeSlot', 
                       'appointmentTimeLabel', 'appointmentReminderAt', 'aiUsed', 'askedAboutPrice',
                       'handoverRequested', 'messageCount', 'postCompletionIntents'].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n') || '-';

  // Send agent notification
  const agentNotification = formatMessage(messages.agentNotification, {
    name: conv.data.name,
    phone: conv.phone,
    whatsapp: conv.phone.replace('+', ''),
    details,
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, agentNotification, accessToken, client.phone_number_id);
    } catch (error) {
      console.error(`❌ Agent notify error:`, error);
    }
  }

  // Send separate appointment notification if applicable
  if (features.appointment_setting && appointmentId) {
    const appointmentNotif = formatMessage(messages.appointmentNotification, {
      name: conv.data.name,
      phone: conv.phone,
      whatsapp: conv.phone.replace('+', ''),
      appointmentDate: conv.data.appointmentDateLabel || conv.data.appointmentDate,
      appointmentTime: conv.data.appointmentTimeLabel,
      details
    });

    for (const agentPhone of client.agent_phones || []) {
      try {
        await sendWhatsAppMessage(agentPhone, appointmentNotif, accessToken, client.phone_number_id);
      } catch (error) {
        console.error(`❌ Appointment notify error:`, error);
      }
    }
  }

  // Send thank you to customer (skip if AI mode already sent one)
  if (!features.ai_conversation) {
    let thankYouMsg: string;
    if (features.appointment_setting && appointmentId) {
      thankYouMsg = formatMessage(messages.thankYouWithAppointment, {
        name: conv.data.name,
        appointmentDate: conv.data.appointmentDateLabel || conv.data.appointmentDate,
        appointmentTime: conv.data.appointmentTimeLabel
      });
    } else {
      thankYouMsg = formatMessage(messages.thankYou, { name: conv.data.name });
    }
    await sendWhatsAppMessage(conv.phone, thankYouMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: thankYouMsg });
  }
  conv.state = 'completed';

  console.log(`✅ Lead captured: ${conv.data.name} (${conv.phone}) - Score: ${leadScore}${appointmentId ? ' + Appointment' : ''}`);
}
