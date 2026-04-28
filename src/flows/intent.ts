// ============================================================
// POST-COMPLETION INTENT DETECTION
// AI-first classifier with keyword fallback for messages received
// after the booking flow completes (cancel, reschedule, status,
// complaint, talk-to-agent, general).
// ============================================================

import { z } from 'zod';
import { classifyIntent } from '../services/ai-client.js';
import type { ClientConfig } from '../types/client.js';

export interface DetectedIntent {
  type: 'cancel' | 'reschedule' | 'status_update' | 'complaint' | 'talk_to_agent' | 'general';
  confidence: 'high' | 'medium';
  forwardToAgent: boolean;
}

// AI-first classifier with keyword fallback. Falls back to keyword logic
// when AI is unavailable, returns null, or reports low confidence — so
// behavior degrades gracefully and existing keyword coverage is preserved.
const PostCompletionIntentSchema = z.object({
  type: z.enum(['cancel', 'reschedule', 'status_update', 'complaint', 'talk_to_agent', 'general']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export async function classifyPostCompletionIntent(
  client: ClientConfig,
  message: string
): Promise<DetectedIntent> {
  const aiResult = await classifyIntent(
    { clientId: client.id },
    message,
    PostCompletionIntentSchema,
    `Classify a customer's WhatsApp message (Gulf Arabic or English) into one of:
- cancel: wants to cancel an order or appointment
- reschedule: wants to change a booked time
- status_update: asking about order/delivery status
- complaint: upset about a problem with their order
- talk_to_agent: wants a human
- general: small talk, thanks, greetings, anything else

Be conservative — only classify as a specific intent when clearly expressed. Use confidence "low" for ambiguous cases.`
  );

  if (aiResult && aiResult.confidence !== 'low') {
    return {
      type: aiResult.type,
      confidence: aiResult.confidence,
      forwardToAgent: aiResult.type !== 'general',
    };
  }

  return detectPostCompletionIntent(message);
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

export const INTENT_RESPONSES: Record<string, string> = {
  cancel: 'تم استلام طلب الإلغاء ✅\nفريقنا بيتواصل معك قريب لتأكيد الإلغاء.',
  reschedule: 'تم استلام طلب تغيير الموعد ✅\nفريقنا بيتواصل معك قريب لتحديد موعد جديد.',
  status_update: 'شكراً على تواصلك! 👍\nفريقنا بيرد عليك بتحديث قريب.',
  complaint: 'نعتذر عن أي إزعاج 🙏\nفريقنا بيتواصل معك بأسرع وقت لحل الموضوع.',
  talk_to_agent: 'تمام! 👍\nبنحولك لأحد فريقنا يتواصل معك خلال دقائق.',
};

export const INTENT_AGENT_NOTIFICATIONS: Record<string, string> = {
  cancel: '🚨 *طلب إلغاء*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  reschedule: '📅 *طلب تغيير موعد*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  status_update: '📦 *استفسار عن حالة*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  complaint: '⚠️ *شكوى عميل*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
  talk_to_agent: '📞 *طلب تحويل لموظف*\n\n👤 {name}\n📱 {phone}\n💬 wa.me/{whatsapp}\n\n📝 الرسالة: {message}\n⏰ {time}',
};
