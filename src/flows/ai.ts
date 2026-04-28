// ============================================================
// AI FLOWS — conversation mode + fallback + budget
// AI conversation mode (replaces rigid flow), AI fallback (off-topic
// answers in mid-flow), and the per-conversation budget guard that
// stops a runaway from eating Anthropic credits.
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from '../services/whatsapp.js';
import { getDefaultMessages } from '../messages.js';
import { generateKnowledgeResponse, isAIAvailable } from '../services/knowledge.js';
import { DEFAULT_APPOINTMENT_SETTINGS, type AppointmentSettings } from '../services/appointments.js';
import { getAIResponse } from '../services/ai-conversation.js';
import { pushToBookingAPI } from '../services/bookingWebhook.js';
import { emitEvent } from '../services/events.js';
import type { ClientConfig, ClientFeatures } from '../types/client.js';
import type { ConversationState } from './types.js';
import { handleHandoverRequest, completeLead } from './lifecycle.js';

const MAX_AI_CALLS_PER_CONVERSATION = 25;

function checkAIBudget(conv: ConversationState): boolean {
  conv.data._aiCallCount = (conv.data._aiCallCount || 0) + 1;
  return conv.data._aiCallCount <= MAX_AI_CALLS_PER_CONVERSATION;
}

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
    customerPhone: conv.phone,
    customSystemPrompt: client.settings?.system_prompt
  };

  const { parsed, rawResponse, durationMs, tokensUsed } = await getAIResponse(promptCtx, conv.messages, message);
  emitEvent(client.id, 'ai_call', conv.phone, { source: 'ai_conversation', duration_ms: durationMs, tokens: tokensUsed });
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
      message,
      client.settings?.system_prompt
    );

    emitEvent(client.id, 'ai_call', conv.phone, { source: 'knowledge', confident: response.confident, duration_ms: response.durationMs, tokens: response.tokensUsed });
    await sendWhatsAppMessage(conv.phone, response.answer, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response.answer });

    conv.data.aiUsed = true;
    conv.data.askedAboutPrice = conv.data.askedAboutPrice ||
      message.includes('سعر') || message.includes('كم') || message.includes('تكلفة');
  } catch (error) {
    console.error('❌ AI fallback error:', error);
  }
}
