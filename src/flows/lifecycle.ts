// ============================================================
// FLOW LIFECYCLE — handover + lead completion
// End-of-flow concerns: escalating to a human agent, persisting
// the lead/appointment, notifying agents, sending the thank-you.
// ============================================================

import { sendWhatsAppMessage } from '../services/whatsapp.js';
import { createLead, createAppointment } from '../services/database.js';
import { formatMessage, type ClientMessages } from '../messages.js';
import { saveLeadToSheet } from '../services/googleSheets.js';
import { scoreLead } from '../services/knowledge.js';
import type { AppointmentSettings } from '../services/appointments.js';
import { maskPhone } from '../utils/buttons.js';
import { emitEvent } from '../services/events.js';
import type { ClientConfig, ClientFeatures } from '../types/client.js';
import type { ConversationState } from './types.js';

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
