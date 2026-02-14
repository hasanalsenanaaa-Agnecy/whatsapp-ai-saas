import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from './services/whatsapp.js';
import { getConversation, saveConversation, createLead, getClientByPhoneNumberId, createAppointment } from './services/database.js';
import { formatMessage, getDefaultMessages, ClientMessages } from './messages.js';
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

// ============================================================
// TYPES
// ============================================================

interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: 'welcome' | 'questions' | 'appointment_date' | 'appointment_time' | 'completed';
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
}

const CONVERSATION_TIMEOUT_HOURS = 24;

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
    appointment_setting: client.features?.appointment_setting || false
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

  // Check for back command
  const backResult = handleBackCommand(message, conv);
  if (backResult.handled) {
    conv.state = backResult.newState as any;
    conv.step = backResult.newStep;
  }

  // ============================================================
  // HANDOVER DETECTION (if enabled)
  // ============================================================
  if (features.handover_detection && detectHandoverIntent(message)) {
    await handleHandoverRequest(client, conv, message, clientMessages, accessToken);
    await saveConversation(conv);
    return;
  }

  // ============================================================
  // STATE MACHINE
  // ============================================================
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
    case 'completed':
      // If AI fallback enabled, respond to questions after completion
      if (features.ai_fallback && looksLikeQuestion(message)) {
        await handleAIFallback(client, conv, message, accessToken);
      }
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

/**
 * Questions state: Collect answers via buttons/lists
 */
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
    // All questions answered
    if (features.appointment_setting) {
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
    appointment_setting: client.features?.appointment_setting || false
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
                       'handoverRequested', 'messageCount'].includes(k))
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

  // Send thank you to customer
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
  conv.state = 'completed';

  console.log(`✅ Lead captured: ${conv.data.name} (${conv.phone}) - Score: ${leadScore}${appointmentId ? ' + Appointment' : ''}`);
}
