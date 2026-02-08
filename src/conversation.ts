import { sendWhatsAppMessage } from './services/whatsapp.js';
import { 
  getConversation, 
  saveConversation, 
  updateConversation,
  createLead,
  createAppointment,
  getClientByPhoneNumberId
} from './services/database.js';
import { 
  generateKnowledgeResponse, 
  detectHandoverIntent,
  scoreLead 
} from './services/knowledge.js';
import { formatMessage, getDefaultMessages, ClientMessages } from './messages.js';
import { saveLeadToSheet } from './services/googleSheets.js';

// ============================================================
// CONVERSATION HANDLER (Multi-tenant, Pro Level)
// ============================================================

interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: 'welcome' | 'qualifying' | 'contact' | 'chat' | 'handover' | 'appointment';
  step: number;
  data: Record<string, any>;
  leadCaptured: boolean;
  handoverRequested: boolean;
  leadId?: number;
}

export async function handleIncomingMessage(
  phoneNumberId: string,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  
  // Get client config from database
  const client = await getClientByPhoneNumberId(phoneNumberId);
  
  if (!client) {
    console.error(`❌ No client found for phone_number_id: ${phoneNumberId}`);
    return;
  }

  const clientMessages: ClientMessages = client.messages && Object.keys(client.messages).length > 0
    ? client.messages
    : getDefaultMessages(client.industry);

  // Get or create conversation
  let conv = await getConversation(client.id, customerPhone);
  
  if (!conv) {
    conv = {
      clientId: client.id,
      phone: customerPhone,
      messages: [],
      state: 'welcome',
      step: 0,
      data: { messageCount: 0 },
      leadCaptured: false,
      handoverRequested: false
    };
  }

  // Track message count
  conv.data.messageCount = (conv.data.messageCount || 0) + 1;

  // Add user message to history
  conv.messages.push({ role: 'user', content: message });

  // Check for handover request
  if (detectHandoverIntent(message)) {
    await handleHandover(client, conv, clientMessages, accessToken);
    return;
  }

  // Route based on state
  switch (conv.state) {
    case 'welcome':
      await handleWelcome(client, conv, clientMessages, accessToken);
      break;
      
    case 'qualifying':
      await handleQualifying(client, conv, message, clientMessages, accessToken);
      break;
      
    case 'contact':
      await handleContact(client, conv, message, clientMessages, accessToken);
      break;
      
    case 'appointment':
      await handleAppointment(client, conv, message, clientMessages, accessToken);
      break;
      
    case 'chat':
      return; // No response after lead captured
      break;
      
    case 'handover':
      // Already in handover, notify again
      await sendWhatsAppMessage(
        customerPhone,
        'المستشار بيتواصل معك قريب إن شاء الله 👍',
        accessToken,
        client.phone_number_id
      );
      break;
  }

  // Save conversation
  await saveConversation(conv);
}

// ============================================================
// STATE HANDLERS
// ============================================================

async function handleWelcome(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  const welcomeMsg = formatMessage(messages.welcome, {
    businessName: client.name
  });

  await sendWhatsAppMessage(conv.phone, welcomeMsg, accessToken, client.phone_number_id);
  
  conv.messages.push({ role: 'assistant', content: welcomeMsg });
  conv.state = 'qualifying';
  conv.step = 0;
}

async function handleQualifying(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  const questions = client.questions?.length > 0 
    ? client.questions 
    : messages.questions;
    
  const currentQuestion = questions[conv.step];
  
  if (!currentQuestion) {
    // No more questions, ask for contact
    conv.state = 'contact';
    await sendWhatsAppMessage(conv.phone, messages.askContact, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: messages.askContact });
    return;
  }

  // Validate input
  const inputNum = parseInt(message.trim()) - 1;
  const options = currentQuestion.options || [];
  
  if (inputNum < 0 || inputNum >= options.length) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    return;
  }

  // Save answer
  const fieldNames = ['interest', 'budget', 'preference', 'extra1', 'extra2'];
  const fieldName = fieldNames[conv.step] || `answer_${conv.step}`;
  conv.data[fieldName] = options[inputNum];

  // Next question or contact
  conv.step++;
  
  const nextQuestion = questions[conv.step];
  
  if (nextQuestion) {
    await sendWhatsAppMessage(conv.phone, nextQuestion.text, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: nextQuestion.text });
  } else {
    conv.state = 'contact';
    await sendWhatsAppMessage(conv.phone, messages.askContact, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: messages.askContact });
  }
}

async function handleContact(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  // Parse contact info
  const parts = message.split(/[,،]/).map(p => p.trim());
  
  if (!parts[0] || parts[0].length < 2) {
    await sendWhatsAppMessage(
      conv.phone,
      'أرسل اسمك ورقم جوالك\n\nمثال: محمد، 0501234567',
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Save lead data
  conv.data.name = parts[0];
  conv.data.phone = parts[1] || conv.phone;
  conv.data.email = parts[2] || '';
  conv.data.whatsappPhone = conv.phone;

  // Score the lead
  const score = scoreLead(conv.data);

  // Create lead in database
  const leadId = await createLead({
    clientId: client.id,
    phone: conv.phone,
    name: conv.data.name,
    email: conv.data.email,
    data: conv.data,
    score
  });

  conv.leadId = leadId || undefined;
  conv.leadCaptured = true;

  // Save to Google Sheets if configured
  if (client.settings?.googleSheetId) {
    await saveLeadToSheet({
      name: conv.data.name,
      phone: conv.data.phone,
      email: conv.data.email,
      whatsappPhone: conv.phone,
      propertyType: conv.data.interest,
      city: conv.data.preference,
      budget: conv.data.budget,
      bedrooms: conv.data.extra1,
      timestamp: new Date().toISOString()
    });
  }

  // Notify agent(s)
  const agentNotification = formatMessage(messages.agentNotification, {
    name: conv.data.name,
    phone: conv.data.phone,
    whatsapp: conv.phone,
    interest: conv.data.interest || '-',
    budget: conv.data.budget || '-',
    details: Object.entries(conv.data)
      .filter(([k, v]) => !['name', 'phone', 'email', 'whatsappPhone', 'messageCount'].includes(k) && v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') || '-',
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  // Send to all agent phones
  for (const agentPhone of client.agent_phones || []) {
    await sendWhatsAppMessage(agentPhone, agentNotification, accessToken, client.phone_number_id);
  }

  // Thank customer
  const thankYouMsg = formatMessage(messages.thankYou, { name: conv.data.name });
  await sendWhatsAppMessage(conv.phone, thankYouMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: thankYouMsg });

  // Move to chat state
  conv.state = 'chat';

  console.log(`✅ Lead captured: ${conv.data.name} (${conv.phone}) - Score: ${score}`);
}

async function handleChat(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  // Generate AI response using knowledge base
  const response = await generateKnowledgeResponse(
    client.name,
    client.knowledge_base || [],
    conv.data,
    conv.messages,
    message
  );

  // Send response
  await sendWhatsAppMessage(conv.phone, response.answer, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: response.answer });

  // If AI suggests handover, trigger it
  if (response.suggestHandover) {
    await handleHandover(client, conv, messages, accessToken);
  }
}

async function handleAppointment(
  client: any,
  conv: ConversationState,
  message: string,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  // Simple appointment handling
  const inputNum = parseInt(message.trim());
  
  if (inputNum < 1 || inputNum > 4) {
    await sendWhatsAppMessage(conv.phone, messages.invalidInput, accessToken, client.phone_number_id);
    return;
  }

  if (inputNum === 4) {
    // No appointment wanted
    conv.state = 'chat';
    await sendWhatsAppMessage(
      conv.phone,
      'تمام! لو تحتاج أي شيء، أنا هنا 👍',
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Calculate date
  const today = new Date();
  const appointmentDate = new Date(today);
  appointmentDate.setDate(today.getDate() + (inputNum - 1));

  const dateStr = appointmentDate.toLocaleDateString('ar-SA');

  // Create appointment
  if (conv.leadId) {
    await createAppointment({
      clientId: client.id,
      leadId: conv.leadId,
      phone: conv.phone,
      date: appointmentDate.toISOString().split('T')[0],
      time: '10:00',
      type: conv.data.interest || 'general',
      notes: `تم الحجز عبر الواتساب`
    });
  }

  const confirmMsg = formatMessage(messages.appointmentConfirm, {
    date: dateStr,
    time: '10:00 صباحاً',
    location: client.settings?.location || 'سيتم التأكيد',
    doctor: ''
  });

  await sendWhatsAppMessage(conv.phone, confirmMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: confirmMsg });
  conv.data.appointmentRequested = true;

  // Update lead score
  conv.state = 'chat';
  
  // Notify agents about appointment
  for (const agentPhone of client.agent_phones || []) {
    await sendWhatsAppMessage(
      agentPhone,
      `📅 *موعد جديد!*\n\n👤 ${conv.data.name}\n📱 ${conv.phone}\n📅 ${dateStr}\n⏰ 10:00 صباحاً`,
      accessToken,
      client.phone_number_id
    );
  }

  console.log(`📅 Appointment booked: ${conv.data.name} - ${dateStr}`);
}

async function handleHandover(
  client: any,
  conv: ConversationState,
  messages: ClientMessages,
  accessToken: string
): Promise<void> {
  conv.state = 'handover';
  conv.handoverRequested = true;

  // Notify customer
  await sendWhatsAppMessage(conv.phone, messages.handoverRequested, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: messages.handoverRequested });

  // Urgent notification to agents
  const urgentMsg = `🚨 *طلب تحويل عاجل!*

👤 ${conv.data.name || 'عميل'}
�� ${conv.phone}

📝 آخر رسالة: "${conv.messages[conv.messages.length - 2]?.content || '-'}"

⚡ *تواصل معه الحين!*`;

  for (const agentPhone of client.agent_phones || []) {
    await sendWhatsAppMessage(agentPhone, urgentMsg, accessToken, client.phone_number_id);
  }

  console.log(`🚨 Handover requested: ${conv.phone}`);
}
