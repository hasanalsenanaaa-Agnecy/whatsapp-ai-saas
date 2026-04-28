// ============================================================
// SHOPIFY STATES — awaiting_payment + order_complete + done
// Handles payment-confirmation waiting, post-paid follow-up
// (track / contact / new), and the post-completion "done" silence
// where only `new_order` re-opens the flow.
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons } from '../../whatsapp.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState } from '../types.js';
import {
  isQuestionMessage,
  markReprompted,
  resetCurrentOrder,
  pushCurrentOrderToHistory,
} from '../helpers.js';
import { tryAIAnswer } from '../ai.js';
import { notifyOwner } from '../notify.js';
import { handleWelcome } from './welcome.js';

export async function handlePaymentConfirmation(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const l: string = conv.data._lang || 'ar';

  // Cancel intent → reset order. Tightened to explicit cancel words only
  // (fgf.md #21): "مو عارف" / "بكره" are uncertainty, not cancellation —
  // they should fall through to the help menu below, not wipe the order.
  // Short words (وقف / cancel) require exact match; full phrases use includes.
  const isCancelIntent = lower === 'وقف' || lower === 'cancel' || lower === 'الغاء' || lower === 'إلغاء'
    || lower.includes('الغاء الطلب') || lower.includes('إلغاء الطلب') || lower.includes('cancel order');
  if (isCancelIntent) {
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await sendWhatsAppMessage(conv.phone, msg('تم إلغاء الطلب. تقدر تبدأ من جديد في أي وقت.', 'Order cancelled. You can start over anytime.', l), accessToken, client.phone_number_id);
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // New order → start fresh
  if (lower === 'new_order' || lower.includes('طلب جديد')) {
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // Owner-notify: ping once per payment session. First help/follow-up pages
  // the owner; subsequent messages re-acknowledge the customer but never
  // re-page (anti-spam rule — Con-flow L43).
  const shouldNotifyOwner = !conv.data._paymentHelpNotified;

  // Help button or help words → escalate to owner
  if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف') || lower.includes('help')) {
    await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', l), accessToken, client.phone_number_id);
    if (shouldNotifyOwner) {
      conv.data._paymentHelpNotified = true;
      await notifyOwner(client, conv, config, 'help', accessToken);
    }
    return;
  }

  // Gratitude — ack warmly, don't treat as a help request.
  if ((lower.includes('شكر') || lower.includes('مشكور') || lower.includes('thanks') || lower.includes('thank you') || lower === '🙏') && !conv.data._gratitudeAcked) {
    conv.data._gratitudeAcked = true;
    await sendWhatsAppMessage(conv.phone, msg('العفو! 😊', 'You\'re welcome! 😊', l), accessToken, client.phone_number_id);
    return;
  }

  // Questions mid-payment ("متى يوصل؟" / "what's the total?") — route to AI
  // so the customer gets a real answer instead of the generic "waiting for
  // confirmation" prompt. Product catalog is already loaded at this stage.
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
  }

  // Any other message → show help/home options, notify owner (once only)
  if (shouldNotifyOwner) {
    conv.data._paymentHelpNotified = true;
    await notifyOwner(client, conv, config, 'help', accessToken);
  }

  await sendWhatsAppButtons(
    conv.phone,
    msg(
      'نحن بانتظار تأكيد الدفع 🔄\nإذا تحتاج مساعدة، فريقنا جاهز 👇',
      'We\'re waiting for payment confirmation 🔄\nIf you need help, our team is ready 👇',
      l
    ),
    [
      { id: 'paid_help', title: msg('أحتاج مساعدة', 'Need Help', l) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
    ],
    accessToken,
    client.phone_number_id
  );
}

export async function handleOrderComplete(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // New order — reset and restart
  if (lower === 'new_order' || lower.includes('طلب جديد')) {
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // Track order → scripted once + notify owner (first time only) + silence
  if (lower === 'track_order' || lower.includes('تتبع') || lower.includes('وين طلبي') || lower.includes('حالة الطلب')) {
    const l: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً بتحديث طلبك.', 'Our team will reach out shortly with an update on your order.', l), accessToken, client.phone_number_id);
    if (!conv.data._orderCompleteNotified) {
      conv.data._orderCompleteNotified = true;
      await notifyOwner(client, conv, config, 'urgent', accessToken);
    }
    markReprompted(conv);
    return;
  }

  // Contact us / any complaint / cancel → scripted once + notify owner (first time only) + silence
  if (lower === 'contact_us' || lower.includes('تواصل') || lower.includes('مساعدة') || lower.includes('موظف')
    || lower.includes('استرجاع') || lower.includes('الغ') || lower.includes('مشكلة')
    || lower.includes('تأخر') || lower.includes('ما وصل')) {
    await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', conv.data._lang || 'ar'), accessToken, client.phone_number_id);
    if (!conv.data._orderCompleteNotified) {
      conv.data._orderCompleteNotified = true;
      await notifyOwner(client, conv, config, 'urgent', accessToken);
    }
    markReprompted(conv);
    return;
  }

  // Gratitude — acknowledge warmly, once
  if ((lower.includes('شكر') || lower.includes('شكراً') || lower.includes('مشكور') || lower.includes('thanks') || lower === '🙏') && !conv.data._gratitudeAcked) {
    conv.data._gratitudeAcked = true;
    await sendWhatsAppMessage(conv.phone, msg('العفو! 😊 يسعدنا خدمتك دايماً.', 'You\'re welcome! 😊 Always happy to serve you.', conv.data._lang || 'ar'), accessToken, client.phone_number_id);
    return;
  }

  // Everything else — silence
}

export async function handleDone(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  if (lower === 'new_order' || lower.includes('طلب جديد')) {
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
  }
  // Everything else — silence
}
