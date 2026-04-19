// ============================================================
// COMMON FLOW HANDLERS
// Shared logic: welcome, questions, appointments, AI fallback,
// post-completion chat, handover, lead completion
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from '../services/whatsapp.js';
import { createLead, createAppointment } from '../services/database.js';
import { formatMessage, getDefaultMessages, type ClientMessages } from '../messages.js';
import { saveLeadToSheet } from '../services/googleSheets.js';
import {
  generateKnowledgeResponse,
  detectHandoverIntent,
  looksLikeQuestion,
  scoreLead,
  isAIAvailable
} from '../services/knowledge.js';
import {
  getAvailableDates,
  getTimeSlots,
  parseDateSelection,
  parseTimeSelection,
  calculateReminderTime,
  DEFAULT_APPOINTMENT_SETTINGS,
  type AppointmentSettings
} from '../services/appointments.js';
import {
  getAIResponse,
  isAIConversationAvailable
} from '../services/ai-conversation.js';
import { pushToBookingAPI } from '../services/bookingWebhook.js';
import { normalizeArabicNumbers, maskPhone } from '../utils/buttons.js';
import { emitEvent } from '../services/events.js';
import type { ClientConfig, ClientFeatures } from '../types/client.js';

// ============================================================
// TYPES (re-exported for use by other flows)
// ============================================================

export interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: string;
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type { ClientFeatures };

export { detectHandoverIntent, isAIConversationAvailable };

// ============================================================
// POST-COMPLETION INTENT DETECTION
// ============================================================

interface DetectedIntent {
  type: 'cancel' | 'reschedule' | 'status_update' | 'complaint' | 'talk_to_agent' | 'general';
  confidence: 'high' | 'medium';
  forwardToAgent: boolean;
}

export function detectPostCompletionIntent(message: string): DetectedIntent {
  const lower = message.toLowerCase().trim();

  const cancelKeywords = ['cancel', 'الغاء', 'ألغي', 'الغي', 'لا ابي', 'ما ابي', 'لا أبي', 'ما أبي', 'كنسل', 'الغ'];
  if (cancelKeywords.some(k => lower.includes(k))) {
    return { type: 'cancel', confidence: 'high', forwardToAgent: true };
  }

  const rescheduleKeywords = ['reschedule', 'تغيير موعد', 'غير الموعد', 'تأجيل', 'أجل', 'اجل', 'تعديل موعد', 'بدل الموعد'];
  if (rescheduleKeywords.some(k => lower.includes(k))) {
    return { type: 'reschedule', confidence: 'high', forwardToAgent: true };
  }

  const statusKeywords = ['update', 'status', 'وين طلبي', 'وين الطلب', 'تحديث', 'وش صار', 'متى يوصل', 'tracking', 'track', 'وصل'];
  if (statusKeywords.some(k => lower.includes(k))) {
    return { type: 'status_update', confidence: 'high', forwardToAgent: true };
  }

  const complaintKeywords = ['شكوى', 'complaint', 'مشكلة', 'problem', 'issue', 'زعلان', 'مو راضي', 'سيء', 'خرب'];
  if (complaintKeywords.some(k => lower.includes(k))) {
    return { type: 'complaint', confidence: 'high', forwardToAgent: true };
  }

  const agentKeywords = ['agent', 'human', 'person', 'موظف', 'شخص', 'بشر', 'أكلم أحد', 'اكلم احد', 'ممثل', 'خدمة عملاء'];
  if (agentKeywords.some(k => lower.includes(k))) {
    return { type: 'talk_to_agent', confidence: 'high', forwardToAgent: true };
  }

  return { type: 'general', confidence: 'medium', forwardToAgent: false };
}

const INTENT_RESPONSES: Record<string, string> = {
  cancel: 'تم استلام طلب الإلغاء ✅\nفريقنا بيتواصل معك قريب لتأكيد الإلغاء.',
  reschedule: 'تم استلام طلب تغيير الموعد ✅\nفريقنا بيتواصل معك قريب لتحديد موعد جديد.',
  status_update: 'شكراً على تواصلك! 👍\nفريقنا بيرد عليك بتحديث قريب.',
  complaint: 'نعتذر عن أي إزعاج 🙏\nفريقنا بيتواصل معك بأسرع وقت لحل الموضوع.',
  talk_to_agent: 'تمام! 👍\nبنحولك لأحد فريقنا يتواصل معك خلال دقائق.',
};

const INTENT_AGENT_NOTIFICATIONS: Record<string, string> = {
  cancel: '🚨 *طلب إلغاء*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  reschedule: '📅 *طلب تغيير موعد*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  status_update: '📦 *استفسار عن حالة*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  complaint: '⚠️ *شكوى عميل*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  talk_to_agent: '📞 *طلب تحويل لموظف*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
};

// ============================================================
// STATE HANDLERS
// ============================================================

export async function handleWelcome(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  if (!conv.data.welcomeSent) {
    const welcomeMsg = formatMessage(messages.welcome, { businessName: client.name });
    await sendWhatsAppMessage(conv.phone, welcomeMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: welcomeMsg });
    conv.data.welcomeSent = true;
    return;
  }

  const name = message.trim();
  const normalized = normalizeArabicNumbers(name);

  if (features.ai_fallback && looksLikeQuestion(message)) {
    await handleAIFallback(client, conv, message, accessToken);
    await sendWhatsAppMessage(conv.phone, messages.askName, accessToken, client.phone_number_id);
    return;
  }

  if (name.length < 2 || /^\d+$/.test(normalized)) {
    await sendWhatsAppMessage(conv.phone, messages.askName, accessToken, client.phone_number_id);
    return;
  }

  conv.data.name = name;
  conv.data.phone = conv.phone;
  conv.state = 'questions';
  conv.step = 0;
  await sendQuestion(client, conv, messages, accessToken);
}

export async function handleQuestions(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  features: ClientFeatures,
  appointmentSettings: AppointmentSettings,
  accessToken: string
): Promise<void> {
  const questions = messages.questions || [];
  const currentQuestion = questions[conv.step];

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

  let selectedOption = options.find((opt: string) => opt.toLowerCase() === lowerMessage || opt === message.trim());

  if (!selectedOption) {
    const num = parseInt(normalizedMessage);
    if (num >= 1 && num <= options.length) selectedOption = options[num - 1];
  }

  if (!selectedOption) {
    if (features.ai_fallback && looksLikeQuestion(message)) {
      await handleAIFallback(client, conv, message, accessToken);
      await sendQuestion(client, conv, messages, accessToken);
      return;
    }
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    await sendQuestion(client, conv, messages, accessToken);
    return;
  }

  const fieldName = currentQuestion.field || `answer_${conv.step}`;
  conv.data[fieldName] = selectedOption;
  conv.step++;

  const nextQuestion = questions[conv.step];
  if (nextQuestion) {
    await sendQuestion(client, conv, messages, accessToken);
  } else {
    if (features.appointment_setting) {
      await startAppointmentFlow(client, conv, messages, appointmentSettings, accessToken);
    } else {
      await completeLead(client, conv, messages, features, null, accessToken);
    }
  }
}

export async function handleAppointmentDate(
  client: ClientConfig,
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

export async function handleAppointmentTime(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  appointmentSettings: AppointmentSettings,
  accessToken: string,
  features: ClientFeatures
): Promise<void> {
  const availableSlots = getTimeSlots(appointmentSettings);
  const selection = parseTimeSelection(message, availableSlots);

  if (!selection) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    await sendAppointmentTimeOptions(client, conv, messages, appointmentSettings, accessToken);
    return;
  }

  conv.data.appointmentTimeSlot = selection.id;
  conv.data.appointmentTimeLabel = selection.label;

  const reminderAt = calculateReminderTime(conv.data.appointmentDate, selection.id, appointmentSettings);
  conv.data.appointmentReminderAt = reminderAt.toISOString();

  await completeLead(client, conv, messages, features, appointmentSettings, accessToken);
}

export async function handleChat(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  _messages: ClientMessages,
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  const intent = detectPostCompletionIntent(message);
  console.log(`💬 Chat intent: ${intent.type} (${intent.confidence}) from ${maskPhone(conv.phone)}`);

  if (intent.forwardToAgent) {
    const response = INTENT_RESPONSES[intent.type] || '';
    await sendWhatsAppMessage(conv.phone, response, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response });

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

    emitEvent(client.id, 'escalation', conv.phone, { reason: intent.type });
    if (!conv.data.postCompletionIntents) conv.data.postCompletionIntents = [];
    conv.data.postCompletionIntents.push({ type: intent.type, message, time: new Date().toISOString() });
    return;
  }

  if (features.ai_fallback && isAIAvailable()) {
    await handleAIFallback(client, conv, message, accessToken);
  } else {
    const fallbackMsg = formatMessage(_messages.chatFallback, { name: conv.data.name || '' });
    await sendWhatsAppMessage(conv.phone, fallbackMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: fallbackMsg });
  }
}

// ============================================================
// AI COST PROTECTION
// ============================================================

const MAX_AI_CALLS_PER_CONVERSATION = 25;

function checkAIBudget(conv: ConversationState): boolean {
  conv.data._aiCallCount = (conv.data._aiCallCount || 0) + 1;
  return conv.data._aiCallCount <= MAX_AI_CALLS_PER_CONVERSATION;
}

// ============================================================
// AI CONVERSATION MODE
// ============================================================

export async function handleAIConversation(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  features: ClientFeatures,
  accessToken: string
): Promise<void> {
  if (!checkAIBudget(conv)) {
    await sendWhatsAppMessage(
      conv.phone,
      'عذراً، تجاوزت حد المحادثة اليوم. تواصل مع فريقنا مباشرة للمساعدة. 🙏',
      accessToken,
      client.phone_number_id
    );
    return;
  }
  const questions = client.questions?.length > 0
    ? client.questions.map((q: any, i: number) => ({
        text: q.text || q.question || `سؤال ${i + 1}`,
        options: q.options || [],
        field: q.field || `answer_${i}`
      }))
    : [];

  if (!conv.data.phone) conv.data.phone = conv.phone;

  const promptCtx = {
    businessName: client.name || '',
    industry: client.industry || 'generic',
    questions,
    knowledgeBase: client.knowledge_base || [],
    settings: client.settings || {},
    bookingState: { ...conv.data },
    customerPhone: conv.phone
  };

  const { parsed, rawResponse } = await getAIResponse(promptCtx, conv.messages, message);
  console.log(`🤖 AI raw: ${rawResponse.substring(0, 200)}`);

  if (Object.keys(parsed.data).length > 0) {
    for (const [key, value] of Object.entries(parsed.data)) {
      conv.data[key] = value;
    }
    console.log(`📝 Data saved:`, parsed.data);
  }

  if (parsed.handover) {
    const defaults = getDefaultMessages(client.industry);
    await handleHandoverRequest(client, conv, message, defaults, accessToken);
    return;
  }

  if (parsed.complete) {
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

    if (client.settings?.booking_api?.url) {
      const ok = await pushToBookingAPI(client, conv);
      console.log(ok ? '✅ Booking pushed to API' : '⚠️ Booking API push failed');
    }

    conv.state = 'completed';
    return;
  }

  if (parsed.buttons && parsed.buttons.options.length > 0) {
    const opts = parsed.buttons.options.slice(0, 3);
    const body = parsed.text || parsed.buttons.body;
    await sendWhatsAppButtons(
      conv.phone, body,
      opts.map((opt, i) => ({ id: `ai_opt_${i}`, title: opt.substring(0, 20) })),
      accessToken, client.phone_number_id
    );
    conv.messages.push({ role: 'assistant', content: body });
  } else if (parsed.list && parsed.list.options.length > 0) {
    const opts = parsed.list.options.slice(0, 10);
    const body = parsed.text || parsed.list.body;
    await sendWhatsAppList(
      conv.phone, body, parsed.list.buttonText.substring(0, 20),
      opts.map((opt, i) => ({ id: `ai_list_${i}`, title: opt.substring(0, 24) })),
      accessToken, client.phone_number_id
    );
    conv.messages.push({ role: 'assistant', content: body });
  } else if (parsed.text) {
    await sendWhatsAppMessage(conv.phone, parsed.text, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: parsed.text });
  }
}

// ============================================================
// AI FALLBACK
// ============================================================

export async function handleAIFallback(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  if (!isAIAvailable()) {
    console.warn('⚠️ AI not available, skipping fallback');
    const fallback = 'عذراً، ما قدرت أجاوب الآن. فريقنا بيتواصل معك قريباً. 🙏';
    await sendWhatsAppMessage(conv.phone, fallback, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: fallback });
    return;
  }

  if (!checkAIBudget(conv)) {
    const limitMsg = 'عذراً، تجاوزت حد المحادثة اليوم. تواصل مع فريقنا مباشرة للمساعدة. 🙏';
    await sendWhatsAppMessage(conv.phone, limitMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: limitMsg });
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

    emitEvent(client.id, 'ai_call', conv.phone, { source: 'ai_conversation', confident: response.confident });
    await sendWhatsAppMessage(conv.phone, response.answer, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response.answer });

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

export async function handleHandoverRequest(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  await sendWhatsAppMessage(conv.phone, messages.handoverDetected, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: messages.handoverDetected });

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
// HELPER FUNCTIONS
// ============================================================

export async function sendQuestion(client: ClientConfig, conv: ConversationState, messages: ClientMessages, accessToken: string): Promise<void> {
  const questions = messages.questions || [];
  const question = questions[conv.step];
  if (!question) return;

  const options = question.options || [];

  if (options.length <= 3) {
    await sendWhatsAppButtons(
      conv.phone, question.text,
      options.map((opt: string, i: number) => ({ id: `opt_${i}`, title: opt })),
      accessToken, client.phone_number_id
    );
  } else {
    await sendWhatsAppList(
      conv.phone, question.text, 'اختر',
      options.map((opt: string, i: number) => ({ id: `opt_${i}`, title: opt })),
      accessToken, client.phone_number_id
    );
  }

  conv.messages.push({ role: 'assistant', content: question.text });
}

export async function startAppointmentFlow(
  client: ClientConfig, conv: ConversationState, messages: ClientMessages,
  appointmentSettings: AppointmentSettings, accessToken: string
): Promise<void> {
  conv.state = 'appointment_date';
  await sendAppointmentDateOptions(client, conv, messages, appointmentSettings, accessToken);
}

export async function sendAppointmentDateOptions(
  client: ClientConfig, conv: ConversationState, messages: ClientMessages,
  appointmentSettings: AppointmentSettings, accessToken: string
): Promise<void> {
  const dates = getAvailableDates(appointmentSettings);
  await sendWhatsAppButtons(
    conv.phone, messages.askAppointmentDate,
    dates.slice(0, 3).map(d => ({ id: d.id, title: d.label.substring(0, 20) })),
    accessToken, client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: messages.askAppointmentDate });
}

export async function sendAppointmentTimeOptions(
  client: ClientConfig, conv: ConversationState, messages: ClientMessages,
  appointmentSettings: AppointmentSettings, accessToken: string
): Promise<void> {
  const slots = getTimeSlots(appointmentSettings);
  await sendWhatsAppButtons(
    conv.phone, messages.askAppointmentTime,
    slots.map(s => ({ id: s.id, title: s.label })),
    accessToken, client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: messages.askAppointmentTime });
}

// ============================================================
// LEAD COMPLETION
// ============================================================

export async function completeLead(
  client: ClientConfig,
  conv: ConversationState,
  messages: ClientMessages,
  features: ClientFeatures,
  _appointmentSettings: AppointmentSettings | null,
  accessToken: string
): Promise<void> {
  const leadScore = features.lead_scoring ? scoreLead(conv.data) : 'new';

  const leadId = await createLead({
    clientId: client.id,
    phone: conv.phone,
    name: conv.data.name,
    email: '',
    data: conv.data,
    score: leadScore
  });

  conv.data.leadId = leadId;

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

  if (client.settings?.googleSheetId) {
    try { await saveLeadToSheet(client, conv.data); } catch (error) { console.error('❌ Sheets error:', error); }
  }

  const details = Object.entries(conv.data)
    .filter(([k]) => !['name', 'phone', 'whatsappPhone', 'welcomeSent', 'leadId', 'appointmentId',
                       'appointmentDate', 'appointmentDateLabel', 'appointmentTimeSlot',
                       'appointmentTimeLabel', 'appointmentReminderAt', 'aiUsed', 'askedAboutPrice',
                       'handoverRequested', 'messageCount', 'postCompletionIntents'].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n') || '-';

  const agentNotification = formatMessage(messages.agentNotification, {
    name: conv.data.name,
    phone: conv.phone,
    whatsapp: conv.phone.replace('+', ''),
    details,
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try { await sendWhatsAppMessage(agentPhone, agentNotification, accessToken, client.phone_number_id); }
    catch (error) { console.error(`❌ Agent notify error:`, error); }
  }

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
      try { await sendWhatsAppMessage(agentPhone, appointmentNotif, accessToken, client.phone_number_id); }
      catch (error) { console.error(`❌ Appointment notify error:`, error); }
    }
  }

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

  emitEvent(client.id, 'lead_captured', conv.phone, { score: leadScore, hasAppointment: !!appointmentId });
  console.log(`✅ Lead captured: ${maskPhone(conv.phone)} - Score: ${leadScore}${appointmentId ? ' + Appointment' : ''}`);
}
