// ============================================================
// STATE HANDLERS
// One handler per conversation state: welcome, questions,
// appointment_date, appointment_time, chat. Each receives input,
// validates, and either advances state or re-prompts (with AI
// fallback for off-topic questions when enabled).
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from '../services/whatsapp.js';
import { formatMessage, type ClientMessages } from '../messages.js';
import { looksLikeQuestion, isAIAvailable } from '../services/knowledge.js';
import {
  getAvailableDates,
  getTimeSlots,
  parseDateSelection,
  parseTimeSelection,
  calculateReminderTime,
  type AppointmentSettings
} from '../services/appointments.js';
import { normalizeArabicNumbers, maskPhone } from '../utils/buttons.js';
import { emitEvent } from '../services/events.js';
import type { ClientConfig, ClientFeatures } from '../types/client.js';
import type { ConversationState } from './types.js';
import { handleAIFallback } from './ai.js';
import { completeLead } from './lifecycle.js';
import { classifyPostCompletionIntent, INTENT_RESPONSES, INTENT_AGENT_NOTIFICATIONS } from './intent.js';

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
  accessToken: string,
  features: ClientFeatures
): Promise<void> {
  const availableDates = getAvailableDates(appointmentSettings);
  const selection = parseDateSelection(message, availableDates);

  if (!selection) {
    if (features.ai_fallback && looksLikeQuestion(message)) {
      await handleAIFallback(client, conv, message, accessToken);
      await sendAppointmentDateOptions(client, conv, messages, appointmentSettings, accessToken);
      return;
    }
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
    if (features.ai_fallback && looksLikeQuestion(message)) {
      await handleAIFallback(client, conv, message, accessToken);
      await sendAppointmentTimeOptions(client, conv, messages, appointmentSettings, accessToken);
      return;
    }
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
  const intent = await classifyPostCompletionIntent(client, message);
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
// PICKER HELPERS — used by the state handlers above to render
// the next question or date/time options.
// ============================================================

async function sendQuestion(client: ClientConfig, conv: ConversationState, messages: ClientMessages, accessToken: string): Promise<void> {
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

async function startAppointmentFlow(
  client: ClientConfig, conv: ConversationState, messages: ClientMessages,
  appointmentSettings: AppointmentSettings, accessToken: string
): Promise<void> {
  conv.state = 'appointment_date';
  await sendAppointmentDateOptions(client, conv, messages, appointmentSettings, accessToken);
}

async function sendAppointmentDateOptions(
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

async function sendAppointmentTimeOptions(
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
