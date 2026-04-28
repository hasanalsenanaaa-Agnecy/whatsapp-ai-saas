// ============================================================
// SHOPIFY AGENT — Top-level router
// Loads consent / language / global commands, dispatches to the
// per-state handlers in ./states/. Side-files: checkout.ts and
// notify.ts. State handlers themselves live one level deep so this
// router stays a flat read of the conversation lifecycle.
// ============================================================

import { sendWhatsAppMessage } from '../whatsapp.js';
import { emitEvent } from '../events.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ConversationState } from './types.js';
import {
  getShopifyAgentConfig,
  resetCurrentOrder,
  expireStaleCart,
  clearIntentScopedState,
  formatCartLine,
} from './helpers.js';
import { showProductList, showProductNames, showCart } from './display.js';
import { notifyOwner } from './notify.js';
import { handleWelcome } from './states/welcome.js';
import { handleBrowseChoice, handleImageBrowse, handleCatalogSelection } from './states/browse.js';
import { handleProductView, handleVariantSelect, handleQuantitySelect } from './states/product.js';
import { handleCart, handleCartRemove } from './states/cart.js';
import { handlePaymentConfirmation, handleOrderComplete, handleDone } from './states/payment.js';
import { handleOrderStatus, handleCustomerService } from './states/order.js';

export async function handleShopifyAgent(
  client: ClientConfig,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const config = getShopifyAgentConfig(client);
  if (!config) {
    const l: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('عذراً، المتجر غير متاح حالياً.', 'Sorry, the store is currently unavailable.', l), accessToken, client.phone_number_id);
    return;
  }

  // Initialize cart and order history for new/existing conversations
  if (!conv.data._cart) conv.data._cart = [];
  if (!conv.data._orderHistory) conv.data._orderHistory = [];

  // PDPL: consent more than 90 days old → re-ask on next interaction.
  // Aligns with the spirit of "refresh, not silent persistence" under the
  // Saudi PDPL data-processing rules (fgf.md #33).
  const CONSENT_TTL_DAYS = 90;
  const consentAt = conv.data._consentAt as string | undefined;
  if (conv.data._consentGiven && consentAt) {
    const ageDays = (Date.now() - new Date(consentAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > CONSENT_TTL_DAYS) {
      delete conv.data._consentGiven;
      delete conv.data._consentAsked;
      delete conv.data._consentAt;
    }
  }

  // Drop stale carts (>14 days) on resume — prices and stock drift, and
  // a surprise mismatch at checkout is worse than starting fresh. List the
  // prior items so the customer can re-add them at current prices instead
  // of having to remember what they'd picked weeks ago (fgf critique #9).
  const staleResult = expireStaleCart(conv);
  if (staleResult.expired) {
    const scl: string = conv.data._lang || 'ar';
    const priorList = staleResult.priorItems
      .map(it => formatCartLine(it, config.currency, { includePrice: false }))
      .join('\n');
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        `سلتك السابقة انتهت مدتها، بدأنا من جديد 🌴\n\nكانت تحتوي على:\n${priorList}\n\nتقدر تضيفها من جديد بالأسعار الحالية.`,
        `Your previous cart had expired — starting fresh 🌴\n\nIt had:\n${priorList}\n\nYou can re-add these at current prices.`,
        scl
      ),
      accessToken,
      client.phone_number_id
    );
  }

  const shopifyState = conv.data._shopifyState || 'welcome';
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // If consent was declined, stay silent for 1 hour before re-engaging.
  // PDPL posture: customer said no — we respect that. Any messages within
  // the quiet window get no reply; after 1h we treat the next message as
  // a fresh start and re-ask consent.
  if (conv.data._consentDeclined) {
    const declinedAt = conv.data._consentDeclinedAt ? Date.parse(conv.data._consentDeclinedAt) : 0;
    const oneHourMs = 60 * 60 * 1000;
    if (declinedAt && Date.now() - declinedAt < oneHourMs) {
      return; // silent window
    }
    delete conv.data._consentDeclined;
    delete conv.data._consentDeclinedAt;
    delete conv.data._consentAsked;
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // GLOBAL CANCEL — "خلاص", "وقف", "cancel", "restart"
  const cancelWords = ['وقف', 'cancel', 'restart'];
  if (cancelWords.some(w => lower === w)) {
    conv.data._cart = [];
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // GLOBAL LANGUAGE SWITCH — accept a mid-session language change so a
  // customer who picked Arabic can type "english" (or vice versa) without
  // having to restart the whole flow. Only explicit single-word triggers —
  // keep the match tight so ordinary messages can't flip the language.
  const isSwitchToEn = lower === 'english' || lower === 'en' || lower === 'lang_en';
  const isSwitchToAr = lower === 'عربي' || lower === 'العربية' || lower === 'arabic' || lower === 'ar' || lower === 'lang_ar';
  if (conv.data._lang && ((isSwitchToEn && conv.data._lang !== 'en') || (isSwitchToAr && conv.data._lang !== 'ar'))) {
    conv.data._lang = isSwitchToEn ? 'en' : 'ar';
    const sl = conv.data._lang;
    await sendWhatsAppMessage(
      conv.phone,
      msg('تم تغيير اللغة إلى العربية ✅', 'Language switched to English ✅', sl),
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // GLOBAL DATA-DELETION REQUEST — PDPL right-to-delete (fgf.md #47).
  // The customer explicitly asks us to forget them. We don't wipe in-band
  // (it would break mid-conversation); we acknowledge, flag the session,
  // and escalate to the owner so a human processes the request inside
  // the 30-day PDPL window. A scheduled anonymization cron honors the
  // flag on the next run.
  const deletionTriggers = [
    'احذف بياناتي', 'حذف بياناتي', 'احذف حسابي', 'حذف حسابي',
    'امسح بياناتي', 'delete my data', 'delete my account', 'erase my data', 'forget me',
  ];
  if (!conv.data._deletionRequestedAt && deletionTriggers.some(p => lower.includes(p))) {
    conv.data._deletionRequestedAt = new Date().toISOString();
    emitEvent(client.id, 'data_deletion_request', conv.phone);
    const dl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        'استلمنا طلب حذف بياناتك 🌴\nسيتم معالجته خلال 30 يوم حسب نظام حماية البيانات السعودي. سنتواصل معك للتأكيد.',
        'We received your data-deletion request 🌴\nIt will be processed within 30 days per Saudi PDPL. A team member will confirm by WhatsApp.',
        dl
      ),
      accessToken,
      client.phone_number_id
    );
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // GLOBAL HOME — soft reset back to intent menu.
  // Keeps language, consent, and cart. Clears intent + intent-scoped state
  // so a returning customer goes straight to the 3-option menu.
  if (trimmed === 'go_home' || lower === 'رئيسية' || lower === 'الرئيسية' || lower === 'home'
    || lower.includes('رجوع للرئيسية') || lower.includes('الرئيسية') || lower.includes('رئيسيه')) {
    clearIntentScopedState(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // GLOBAL INTENT SWITCH — if the customer is already inside an intent
  // (order_status / customer_service / new_order) and taps/types a
  // different intent's trigger, re-route instead of looping them inside
  // the current intent. Clear the previous intent's scoped state so the
  // new flow starts clean (e.g. forgetting a previously-looked-up order
  // number when they switch to customer service, fgf.md #2, #5).
  const current = conv.data._intent;
  const wantsStatus = trimmed === 'intent_status' || lower === 'حالة الطلب';
  const wantsCs = trimmed === 'intent_cs' || lower === 'خدمة العملاء' || lower === 'customer service';
  const wantsOrder = trimmed === 'intent_order';
  if (current && (
    (wantsStatus && current !== 'order_status')
    || (wantsCs && current !== 'customer_service')
    || (wantsOrder && current !== 'new_order')
  )) {
    clearIntentScopedState(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // BUTTON ID check — buttons always get priority
  const isButtonId = /^(pick_\d+|pick_group_[\d_]+|var_\d+|show_images|pick_direct|add_to_cart|back_to_list|qty_\d+|view_cart|checkout_now|add_more|remove_item|remove_\d+|no_thanks|paid_yes|paid_help|new_order|track_order|track_another|no_order_num|contact_us|continue_cart|clear_cart|go_home|lang_ar|lang_en|intent_order|intent_status|intent_cs)$/.test(trimmed);

  // GLOBAL NAV — works from any state
  if (shopifyState !== 'welcome') {
    // Browse product list — from any state (e.g. AI budget CTA)
    if (trimmed === 'pick_direct' || (!isButtonId && (lower.includes('قائمة') || lower.includes('مباشرة')))) {
      await showProductList(client, conv, config, accessToken);
      conv.data._shopifyState = 'catalog';
      return;
    }
    // Browse images — from any state
    if (trimmed === 'show_images' && shopifyState !== 'image_browse') {
      await showProductNames(client, conv, config, accessToken);
      return;
    }
  }

  if (!isButtonId && shopifyState !== 'welcome') {
    if ((lower === 'view_cart' || lower === 'سلة' || lower === 'cart') && conv.data._cart.length > 0) {
      conv.data._shopifyState = 'cart';
      await showCart(client, conv, config, accessToken);
      return;
    }
    // Global contact us — works from any state. Ping owner once per
    // session: repeat taps should re-acknowledge the customer but not
    // re-page the owner (anti-spam rule).
    if (lower === 'contact_us_global' || lower === 'contact_us') {
      const gcl: string = conv.data._lang || 'ar';
      await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', gcl), accessToken, client.phone_number_id);
      if (!conv.data._globalContactNotified) {
        conv.data._globalContactNotified = true;
        await notifyOwner(client, conv, config, 'help', accessToken);
      }
      return;
    }
  }

  switch (shopifyState) {
    case 'welcome':
      await handleWelcome(client, conv, config, message, accessToken);
      break;
    case 'browse_choice':
      await handleBrowseChoice(client, conv, config, message, accessToken);
      break;
    case 'catalog':
      await handleCatalogSelection(client, conv, config, message, accessToken);
      break;
    case 'image_browse':
      await handleImageBrowse(client, conv, config, message, accessToken);
      break;
    case 'product_view':
      await handleProductView(client, conv, config, message, accessToken);
      break;
    case 'variant_select':
      await handleVariantSelect(client, conv, config, message, accessToken);
      break;
    case 'quantity_select':
      await handleQuantitySelect(client, conv, config, message, accessToken);
      break;
    case 'cart':
    case 'cart_add':
      await handleCart(client, conv, config, message, accessToken);
      break;
    case 'cart_remove':
      await handleCartRemove(client, conv, config, message, accessToken);
      break;
    case 'awaiting_payment':
      await handlePaymentConfirmation(client, conv, config, message, accessToken);
      break;
    case 'order_complete':
      await handleOrderComplete(client, conv, config, message, accessToken);
      break;
    case 'done':
      await handleDone(client, conv, config, message, accessToken);
      break;
    case 'order_status':
      await handleOrderStatus(client, conv, config, message, accessToken);
      break;
    case 'customer_service':
      await handleCustomerService(client, conv, config, message, accessToken);
      break;
    default:
      await handleWelcome(client, conv, config, message, accessToken);
  }
}
