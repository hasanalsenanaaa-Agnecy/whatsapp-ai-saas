import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from './services/whatsapp.js';
import { getConversation, saveConversation, createLead, getClientByPhoneNumberId } from './services/database.js';
import { formatMessage, getDefaultMessages, ClientMessages } from './messages.js';
import { saveLeadToSheet } from './services/googleSheets.js';

interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: 'welcome' | 'ask_name' | 'questions' | 'completed';
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const CONVERSATION_TIMEOUT_HOURS = 24;

export async function handleIncomingMessage(
  phoneNumberId: string,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  const client = await getClientByPhoneNumberId(phoneNumberId);
  if (!client) {
    console.error(`❌ No client found for: ${phoneNumberId}`);
    return;
  }

  // Always use code defaults, only override questions from database
  const defaults = getDefaultMessages(client.industry);
  const clientMessages: ClientMessages = {
    ...defaults,
    questions: client.questions?.length > 0 ? client.questions : defaults.questions
  };

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

  const backResult = handleBackCommand(message, conv);
  if (backResult.handled) {
    conv.state = backResult.newState as any;
    conv.step = backResult.newStep;
  }

  switch (conv.state) {
    case 'welcome':
      await handleWelcome(client, conv, clientMessages, accessToken);
      break;
    case 'ask_name':
      await handleAskName(client, conv, message, clientMessages, accessToken);
      break;
    case 'questions':
      await handleQuestions(client, conv, message, clientMessages, accessToken);
      break;
    case 'completed':
      break;
  }

  await saveConversation(conv);
}

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
    return { handled: true, newState: 'ask_name', newStep: 0 };
  } else if (conv.state === 'ask_name') {
    return { handled: true, newState: 'welcome', newStep: 0 };
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

async function handleWelcome(client: any, conv: ConversationState, messages: ClientMessages, accessToken: string): Promise<void> {
  const welcomeMsg = formatMessage(messages.welcome, { businessName: client.name });

  if (messages.welcomeButtons && messages.welcomeButtons.length > 0) {
    await sendWhatsAppButtons(conv.phone, welcomeMsg, messages.welcomeButtons, accessToken, client.phone_number_id);
  } else {
    await sendWhatsAppMessage(conv.phone, welcomeMsg, accessToken, client.phone_number_id);
  }
  
  conv.messages.push({ role: 'assistant', content: welcomeMsg });
  conv.state = 'ask_name';
}

async function handleAskName(client: any, conv: ConversationState, message: string, messages: ClientMessages, accessToken: string): Promise<void> {
  if (!conv.data.nameAsked) {
    const askNameMsg = messages.askName || 'ممتاز! وش اسمك الكريم؟';
    await sendWhatsAppMessage(conv.phone, askNameMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: askNameMsg });
    conv.data.nameAsked = true;
    return;
  }
  
  const name = message.trim();
  const normalized = normalizeArabicNumbers(name);
  
  // Reject if too short or only numbers
  if (name.length < 2 || /^\d+$/.test(normalized)) {
    await sendWhatsAppMessage(conv.phone, 'أرسل لي اسمك الكريم', accessToken, client.phone_number_id);
    return;
  }
  
  conv.data.name = name;
  conv.data.phone = conv.phone;
  conv.state = 'questions';
  conv.step = 0;
  
  await sendQuestion(client, conv, messages, accessToken);
}

async function handleQuestions(client: any, conv: ConversationState, message: string, messages: ClientMessages, accessToken: string): Promise<void> {
  const questions = messages.questions || [];
  const currentQuestion = questions[conv.step];
  
  if (!currentQuestion) {
    await completeLead(client, conv, messages, accessToken);
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
  
  if (!selectedOption) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput || 'اختر من الخيارات 👆', accessToken, client.phone_number_id);
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
    await completeLead(client, conv, messages, accessToken);
  }
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

async function completeLead(client: any, conv: ConversationState, messages: ClientMessages, accessToken: string): Promise<void> {
  const leadId = await createLead({
    clientId: client.id,
    phone: conv.phone,
    name: conv.data.name,
    email: '',
    data: conv.data,
    score: 'new'
  });

  conv.data.leadId = leadId;

  if (client.settings?.googleSheetId) {
    try {
      await saveLeadToSheet({ name: conv.data.name, phone: conv.phone, whatsappPhone: conv.phone, ...conv.data, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('❌ Sheets error:', error);
    }
  }

  const agentNotification = formatMessage(messages.agentNotification, {
    name: conv.data.name,
    phone: conv.phone,
    whatsapp: conv.phone,
    details: Object.entries(conv.data)
      .filter(([k]) => !['name', 'phone', 'whatsappPhone', 'nameAsked', 'leadId'].includes(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') || '-',
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, agentNotification, accessToken, client.phone_number_id);
    } catch (error) {
      console.error(`❌ Agent notify error:`, error);
    }
  }

  const thankYouMsg = formatMessage(messages.thankYou, { name: conv.data.name });
  await sendWhatsAppMessage(conv.phone, thankYouMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: thankYouMsg });
  conv.state = 'completed';

  console.log(`✅ Lead captured: ${conv.data.name} (${conv.phone})`);
}
