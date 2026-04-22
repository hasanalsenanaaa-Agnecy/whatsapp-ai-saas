// ============================================================
// SHOPIFY AGENT — State handlers + checkout + owner notifications
// ============================================================

import {
  createCheckout,
  createMultiItemCheckout,
  formatPrice,
  type ShopifyProduct
} from '../shopify.js';
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppButtonsWithImage,
  sendWhatsAppList
} from '../whatsapp.js';
import { normalizeArabicNumbers } from '../../utils/buttons.js';
import { emitEvent } from '../events.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, wa, type ShopifyAgentConfig, type ConversationState, type CartItem } from './types.js';
import {
  fetchProductsCached,
  fetchProductsWithStatus,
  getShopifyAgentConfig,
  phoneToCountryCode,
  matchProduct,
  matchVariant,
  tryAnswerProductQuestion,
  getTopProductsByQuery,
  addToCart,
  pushCurrentOrderToHistory,
  resetCurrentOrder,
  isQuestionMessage,
  shouldSilence,
  shouldSendHint,
  markReprompted,
  markHinted,
  getOrderByNumber,
  getOrdersByPhone,
  formatOrderStatus,
  expireStaleCart,
  WEIGHT_STRIP_REGEX,
  WEIGHT_MATCH_REGEX
} from './helpers.js';
import {
  showProductView,
  showProductList,
  showProductNames,
  showVariantOrProductView,
  showProductWithQty,
  showTopProducts,
  showCart,
  showCartForRemoval,
  sendHomeHint,
} from './display.js';
import { tryAIAnswer } from './ai.js';
import { trackClientError } from '../alerts.js';

// ============================================================
// MAIN HANDLER
// ============================================================

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
    const priorList = staleResult.priorItems.map(it => {
      const qty = it.quantity || 1;
      let line = `- ${it.productTitle}`;
      if (it.variantTitle && it.variantTitle !== 'Default Title') line += ` (${it.variantTitle})`;
      if (qty > 1) line += ` x${qty}`;
      return line;
    }).join('\n');
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
    delete conv.data._intent;
    delete conv.data._intentAsked;
    delete conv.data._osOrderNum;
    delete conv.data._osOrderNumAsked;
    delete conv.data._osContextForwarded;
    delete conv.data._osLastForwardedAt;
    delete conv.data._osEmail;
    delete conv.data._osEmailAsked;
    delete conv.data._osFollowupAcked;
    delete conv.data._osNotifiedOwner;
    delete conv.data._osPhoneLookupTried;
    delete conv.data._osPhoneOrderNums;
    delete conv.data._csAcknowledged;
    delete conv.data._csStartedAt;
    delete conv.data._csRepeatAcked;
    delete conv.data._csLastNotifiedAt;
    // Home = fresh intent branch → reset owner-ping guards so a new CS or
    // status request from the same customer re-pages the owner.
    delete conv.data._globalContactNotified;
    delete conv.data._orderCompleteNotified;
    delete conv.data._paymentHelpNotified;
    // Home = fresh start for AI budget too (fgf.md #39).
    delete conv.data._aiAnswerCount;
    delete conv.data._aiExhaustedNotified;
    delete conv.data._aiBudgetRefunded;
    conv.data._reprompted = null;
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
    delete conv.data._intent;
    delete conv.data._intentAsked;
    delete conv.data._osOrderNum;
    delete conv.data._osOrderNumAsked;
    delete conv.data._osContextForwarded;
    delete conv.data._osLastForwardedAt;
    delete conv.data._osEmail;
    delete conv.data._osEmailAsked;
    delete conv.data._osFollowupAcked;
    delete conv.data._osNotifiedOwner;
    delete conv.data._osPhoneLookupTried;
    delete conv.data._osPhoneOrderNums;
    delete conv.data._csAcknowledged;
    delete conv.data._csStartedAt;
    delete conv.data._csRepeatAcked;
    delete conv.data._csLastNotifiedAt;
    // Reset owner-ping guards so the new intent can re-page as first contact.
    delete conv.data._globalContactNotified;
    delete conv.data._orderCompleteNotified;
    delete conv.data._paymentHelpNotified;
    // Fresh intent branch → give the customer a fresh AI budget (fgf.md #39).
    // Otherwise a customer who used all 6 AI answers in CS gets silence the
    // moment they try a new order.
    delete conv.data._aiAnswerCount;
    delete conv.data._aiExhaustedNotified;
    delete conv.data._aiBudgetRefunded;
    conv.data._reprompted = null;
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

// ============================================================
// STATE: WELCOME — Language → Intent → Browse
// ============================================================

async function handleWelcome(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // STEP 1: Language selection
  const lang: string | undefined = conv.data._lang;
  if (!lang) {
    if (!conv.data._langAsked) {
      const nameParts = config.storeName.split(' | ');
      const nameAr = nameParts.length > 1 ? nameParts[1] : config.storeName;
      const nameEn = nameParts[0];
      await sendWhatsAppButtons(
        conv.phone,
        `أهلاً بك في *${wa(nameAr)}*! 🌴\nWelcome to *${wa(nameEn)}*! 🌴\n\n🌐 اختر لغتك / Choose your language`,
        [
          { id: 'lang_ar', title: 'العربية' },
          { id: 'lang_en', title: 'English' }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._langAsked = true;
      return;
    }
    const isArabic = lower === 'lang_ar' || lower.includes('عرب') || lower.includes('arabic') || lower === 'ar';
    const isEnglish = lower === 'lang_en' || lower.includes('english') || lower.includes('انجليزي') || lower.includes('إنجليزي') || lower === 'en';
    if (isArabic) {
      conv.data._lang = 'ar';
    } else if (isEnglish) {
      conv.data._lang = 'en';
    } else {
      const nameParts2 = config.storeName.split(' | ');
      const nameAr2 = nameParts2.length > 1 ? nameParts2[1] : config.storeName;
      const nameEn2 = nameParts2[0];
      await sendWhatsAppButtons(
        conv.phone,
        `أهلاً بك في *${wa(nameAr2)}*! 🌴\nWelcome to *${wa(nameEn2)}*! 🌴\n\n🌐 اختر لغتك / Choose your language`,
        [
          { id: 'lang_ar', title: 'العربية' },
          { id: 'lang_en', title: 'English' }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  const l: string = conv.data._lang || 'ar';

  // STEP 2: PDPL consent (one-time)
  if (!conv.data._consentGiven) {
    if (!conv.data._consentAsked) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'نحفظ بيانات محادثتك لمعالجة طلبك. بالاستمرار أنت توافق على سياسة الخصوصية.',
          'We store your conversation data to process your order. By continuing, you agree to our privacy policy.',
          l
        ),
        [
          { id: 'consent_yes', title: msg('موافق ✅', 'I Agree ✅', l) },
          { id: 'consent_no', title: msg('لا أوافق ❌', 'Decline ❌', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._consentAsked = true;
      return;
    }
    if (lower === 'consent_yes' || lower.includes('موافق') || lower.includes('agree') || lower.includes('نعم') || lower === 'yes' || lower === 'ok') {
      conv.data._consentGiven = true;
      conv.data._consentAt = new Date().toISOString();
    } else if (lower === 'consent_no' || lower.includes('لا أوافق') || lower.includes('decline') || lower.includes('رفض') || lower === 'no') {
      await sendWhatsAppMessage(
        conv.phone,
        msg(
          'نحترم خصوصيتك. لا يمكننا متابعة الخدمة بدون موافقتك على حفظ البيانات.\n\nإذا غيّرت رأيك، أرسل أي رسالة للبدء من جديد.',
          'We respect your privacy. We cannot continue without your consent to store data.\n\nIf you change your mind, send any message to start over.',
          l
        ),
        accessToken,
        client.phone_number_id
      );
      conv.data._consentDeclined = true;
      conv.data._consentDeclinedAt = new Date().toISOString();
      return;
    } else {
      // Didn't understand — re-ask
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'الرجاء اختيار أحد الخيارات:',
          'Please choose one of the options:',
          l
        ),
        [
          { id: 'consent_yes', title: msg('موافق ✅', 'I Agree ✅', l) },
          { id: 'consent_no', title: msg('لا أوافق ❌', 'Decline ❌', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  // STEP 3: Intent menu
  if (!conv.data._intent) {
    const cartCount = (conv.data._cart || []).length;
    const cartHint = cartCount > 0
      ? msg(
          `\n\n🛒 عندك ${cartCount} منتج في السلة — اختر *القائمة* للعودة له.`,
          `\n\n🛒 You have ${cartCount} item(s) in cart — pick *Menu* to resume.`,
          l
        )
      : '';
    // Warm greeting on the very first intent-menu show, so a bare "hi" /
    // "🌴" / emoji opener doesn't feel like the bot jumped straight to a menu.
    // Subsequent re-prompts (customer typed something we didn't recognize)
    // skip the greeting — it would feel redundant.
    const greetName = conv.data.name ? (l === 'en' ? ` ${conv.data.name}` : ` ${conv.data.name}`) : '';
    const warmGreeting = !conv.data._intentAsked
      ? msg(`أهلاً${greetName} 🌴\n\n`, `Hello${greetName} 🌴\n\n`, l)
      : '';
    const intentPrompt = msg(
      `${warmGreeting}كيف نقدر نساعدك؟ 😊${cartHint}\n\n💡 اكتب *رئيسية* في أي وقت للرجوع لهذه القائمة`,
      `${warmGreeting}How can we help you? 😊${cartHint}\n\n💡 Type *home* anytime to return to this menu`,
      l
    );
    const intentButtons = [
      { id: 'intent_order', title: msg('القائمة 🌴', 'Menu 🌴', l) },
      { id: 'intent_status', title: msg('حالة الطلب 📦', 'Order Status 📦', l) },
      { id: 'intent_cs', title: msg('خدمة العملاء 💬', 'Customer Service 💬', l) }
    ];
    if (!conv.data._intentAsked) {
      // If the customer's first post-consent message is a product question
      // ("هل عندكم سكري؟"), answer it before showing the intent menu so
      // they don't have to re-ask after tapping through. Mark menu as asked
      // so subsequent free-text falls into the AI-1 branch below.
      if (isQuestionMessage(message)) {
        if (!conv.data._products || conv.data._products.length === 0) {
          const loaded = await fetchProductsCached(config.domain, config.storefrontToken, conv.data._lang || 'ar');
          if (loaded.length > 0) {
            conv.data._products = loaded.map(p => ({
              id: p.id, title: p.title, description: p.description,
              priceMin: p.priceMin, priceMax: p.priceMax, imageUrl: p.imageUrl,
              variants: p.variants, tags: p.tags, compareAtPriceMin: p.compareAtPriceMin
            }));
          }
        }
        const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
        if (aiHandled) {
          conv.data._intentAsked = true;
          return;
        }
      }
      await sendWhatsAppButtons(conv.phone, intentPrompt, intentButtons, accessToken, client.phone_number_id);
      conv.data._intentAsked = true;
      return;
    }
    const isOrderIntent = lower === 'intent_order'
      || lower === 'pick_direct' || lower === 'show_images'
      || lower.includes('قائمة') || lower.includes('menu')
      || lower.includes('منتجات') || lower.includes('products')
      || lower.includes('سلة') || lower.includes('cart');
    const isStatusIntent = lower === 'intent_status'
      || lower.includes('حالة') || lower.includes('تتبع')
      || (lower.includes('order') && lower.includes('status')) || lower.includes('track');
    const isCsIntent = lower === 'intent_cs'
      || lower.includes('خدمة') || lower.includes('عملاء')
      || lower.includes('customer') || lower.includes('support');

    if (isOrderIntent) {
      conv.data._intent = 'new_order';
    } else if (isStatusIntent) {
      conv.data._intent = 'order_status';
      conv.data._shopifyState = 'order_status';
      await handleOrderStatus(client, conv, config, message, accessToken);
      return;
    } else if (isCsIntent) {
      conv.data._intent = 'customer_service';
      conv.data._shopifyState = 'customer_service';
      await handleCustomerService(client, conv, config, message, accessToken);
      return;
    } else {
      // Load products so we can match "ابغى السكري" against the catalog and
      // feed AI with context for questions. Both paths need them.
      if (!conv.data._products || conv.data._products.length === 0) {
        const loaded = await fetchProductsCached(config.domain, config.storefrontToken, conv.data._lang || 'ar');
        if (loaded.length > 0) {
          conv.data._products = loaded.map(p => ({
            id: p.id, title: p.title, description: p.description,
            priceMin: p.priceMin, priceMax: p.priceMax, imageUrl: p.imageUrl,
            variants: p.variants, tags: p.tags, compareAtPriceMin: p.compareAtPriceMin
          }));
        }
      }
      // Declarative buying intent ("ابغى السكري" / "I want the sukkari") —
      // match against product names and route straight to the new-order flow.
      const directMatch = matchProduct(message, conv.data._products || []);
      if (directMatch) {
        conv.data._intent = 'new_order';
        conv.data._selectedProduct = directMatch;
        conv.data._browseMode = 'list';
        conv.data._shopifyState = 'variant_select';
        await showVariantOrProductView(client, conv, config, accessToken, directMatch);
        return;
      }
      // Question form — let Claude answer before falling back to the menu reprompt.
      if (isQuestionMessage(message)) {
        const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
        if (aiHandled) return;
      }
      await sendWhatsAppButtons(conv.phone, intentPrompt, intentButtons, accessToken, client.phone_number_id);
      return;
    }
  }

  // Route non-new-order intents
  if (conv.data._intent === 'order_status') {
    conv.data._shopifyState = 'order_status';
    await handleOrderStatus(client, conv, config, message, accessToken);
    return;
  }
  if (conv.data._intent === 'customer_service') {
    conv.data._shopifyState = 'customer_service';
    await handleCustomerService(client, conv, config, message, accessToken);
    return;
  }

  // NEW ORDER FLOW
  const existingCart: CartItem[] = conv.data._cart || [];

  // STEP 4: Session resume — if cart has items, ask to continue
  if (existingCart.length > 0) {
    if (lower === 'continue_cart' || lower === 'اكمل' || lower === 'أكمل') {
      conv.data._shopifyState = 'cart';
      await showCart(client, conv, config, accessToken);
      return;
    }
    if (
      lower === 'clear_cart' || lower === 'لا' || lower.includes('من جديد') ||
      lower === 'show_images' || lower === 'pick_direct' || lower === 'asst_help'
    ) {
      conv.data._cart = [];
      resetCurrentOrder(conv);
      await sendWhatsAppMessage(
        conv.phone,
        msg('تم مسح السلة ✓', 'Cart cleared ✓', l),
        accessToken,
        client.phone_number_id
      );
    } else {
      const cartLines = existingCart.map(item => {
        const qty = item.quantity || 1;
        const lineTotal = (parseFloat(item.price) * qty).toFixed(2);
        let line = `- ${item.productTitle}`;
        if (item.variantTitle && item.variantTitle !== 'Default Title') line += ` (${item.variantTitle})`;
        if (qty > 1) line += ` x${qty}`;
        line += ` — ${formatPrice(lineTotal, config.currency)}`;
        return line;
      }).join('\n');

      await sendWhatsAppButtons(
        conv.phone,
        msg(
          `أهلاً! 👋\n\nعندك في سلتك:\n${cartLines}\n\nتبي تكمل طلبك؟`,
          `Welcome back! 👋\n\nYour cart:\n${cartLines}\n\nWould you like to continue?`,
          l
        ),
        [
          { id: 'continue_cart', title: msg('أكمل الطلب', 'Continue Order', l) },
          { id: 'clear_cart', title: msg('لا، من جديد', 'Start Over', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  // STEP 5: Fetch products (cached per store+language, 15 min TTL).
  // Use the status-returning variant so we can show a retry button if
  // Shopify is down, instead of silently telling the customer the store
  // is empty (fgf.md #46).
  const { products, apiError } = await fetchProductsWithStatus(config.domain, config.storefrontToken, conv.data._lang || 'ar');

  if (apiError) {
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `عذراً، فيه مشكلة مؤقتة في الاتصال بـ *${wa(config.storeName)}*. جرب مرة ثانية بعد دقيقة 🌴`,
        `Sorry, we're having a temporary connection issue with *${wa(config.storeName)}*. Please try again in a minute 🌴`,
        l
      ),
      [
        { id: 'pick_direct', title: msg('حاول مرة ثانية', 'Try Again', l) },
        { id: 'intent_cs', title: msg('خدمة العملاء', 'Customer Service', l) }
      ],
      accessToken,
      client.phone_number_id
    );
    await trackClientError(client, 'Shopify Products', new Error('Shopify API unreachable'));
    return;
  }

  if (products.length === 0) {
    const greetName = conv.data.name ? (l === 'en' ? ` ${conv.data.name}` : ` ${conv.data.name}`) : '';
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        `أهلاً${greetName}! عذراً، ما فيه منتجات متوفرة في *${wa(config.storeName)}* حالياً.`,
        `Hello${greetName}! Sorry, no products are available in *${wa(config.storeName)}* right now.`,
        l
      ),
      accessToken,
      client.phone_number_id
    );
    await trackClientError(client, 'Shopify Products', new Error('Product catalog returned empty'));
    return;
  }

  config.currency = config.currency || 'KWD';

  conv.data._products = products.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    imageUrl: p.imageUrl,
    variants: p.variants,
    tags: p.tags,
    compareAtPriceMin: p.compareAtPriceMin
  }));

  const isReturning = conv.data._orderHistory?.length > 0;
  const nameGreet = isReturning
    ? msg('أهلاً مجدداً! 👋\n\n', 'Welcome back! 👋\n\n', l)
    : '';

  await sendWhatsAppButtons(
    conv.phone,
    `${nameGreet}${msg(`كيف تبي تتصفح *${wa(config.storeName)}*؟`, `How would you like to browse *${wa(config.storeName)}*?`, l)}`,
    [
      { id: 'show_images', title: msg('شوف الصور', 'View Images', l) },
      { id: 'pick_direct', title: msg('قائمة المنتجات', 'Product List', l) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'browse_choice';
}

// ============================================================
// STATE: BROWSE_CHOICE
// ============================================================

async function handleBrowseChoice(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const products: ShopifyProduct[] = conv.data._products || [];

  if (lower === 'show_images' || lower.includes('صور') || lower.includes('شوف')) {
    conv.data._reprompted = null;
    await showProductNames(client, conv, config, accessToken);
    conv.data._shopifyState = 'image_browse';
    return;
  }

  if (lower === 'pick_direct' || lower.includes('قائمة') || lower.includes('مباشرة')) {
    conv.data._reprompted = null;
    await showProductList(client, conv, config, accessToken);
    conv.data._shopifyState = 'catalog';
    return;
  }

  // Question form → AI first (fgf.md #41). "وش أفضل منتج؟" is a question and
  // deserves a real answer, not 3 best-seller cards. Only fall through to the
  // pattern matcher when the message is a bare navigation keyword ("الأفضل").
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
  }

  // "Best of" queries — navigation intent, show top 3 cards (not a text answer)
  const topProducts = getTopProductsByQuery(message, products);
  if (topProducts.length > 0) {
    conv.data._reprompted = null;
    await showTopProducts(client, conv, config, accessToken, topProducts);
    return;
  }

  // Pattern-based product navigation (non-question intent: "الأرخص", "الأفضل" as nav, not inquiry)
  const questionMatch = tryAnswerProductQuestion(message, products, config.currency);
  if (questionMatch) {
    conv.data._reprompted = null;
    conv.data._selectedProduct = questionMatch;
    conv.data._browseMode = 'list';
    await showVariantOrProductView(client, conv, config, accessToken, questionMatch);
    return;
  }

  // Non-question unmatched — try AI as fallback before reprompt/silence
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) return;

  // Reprompt → hint → silence
  if (shouldSilence(conv)) return;
  const l2: string = conv.data._lang || 'ar';
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  const repromptName = conv.data.name ? (l2 === 'en' ? `, ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  await sendWhatsAppButtons(
    conv.phone,
    msg(`كيف تبي تتصفح *${wa(config.storeName)}*${repromptName}؟`, `How would you like to browse *${wa(config.storeName)}*${repromptName}?`, l2),
    [
      { id: 'show_images', title: msg('شوف الصور', 'View Images', l2) },
      { id: 'pick_direct', title: msg('قائمة المنتجات', 'Product List', l2) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l2) }
    ],
    accessToken,
    client.phone_number_id
  );
  markReprompted(conv);
}

// ============================================================
// STATE: IMAGE_BROWSE
// ============================================================

async function handleImageBrowse(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];

  let selected = matchProduct(message, products);

  // Question form → AI first, so they get a real answer instead of a
  // pattern-guessed product card (fgf.md #41, AI-2/9). Only fall through to
  // the "Best of" pattern matcher when it's a bare navigation keyword.
  if (!selected && isQuestionMessage(message)) {
    const aiFirst = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiFirst) return;
  }

  // "Best of" queries — show top 3 cards with images
  if (!selected) {
    const topProducts = getTopProductsByQuery(message, products);
    if (topProducts.length > 0) {
      conv.data._reprompted = null;
      await showTopProducts(client, conv, config, accessToken, topProducts);
      return;
    }
  }

  if (!selected) selected = tryAnswerProductQuestion(message, products, config.currency);

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    if (shouldSendHint(conv)) {
      await sendHomeHint(client, conv, accessToken);
      markHinted(conv);
      return;
    }
    await showProductNames(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
  conv.data._selectedProduct = selected;
  await showVariantOrProductView(client, conv, config, accessToken, selected);
}

// ============================================================
// STATE: CATALOG (LIST MODE)
// ============================================================

async function handleCatalogSelection(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  const trimmed = message.trim();

  // Cart nav buttons
  if (trimmed === 'view_cart') {
    conv.data._shopifyState = 'cart';
    await showCart(client, conv, config, accessToken);
    return;
  }
  if (trimmed === 'checkout_now') {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // Grouped product selection — show weight options. WhatsApp buttons cap
  // at 3, so groups with 4+ weights previously dropped the rest silently.
  // Fall back to a list picker (up to 10 rows) when the group overflows.
  if (trimmed.startsWith('pick_group_')) {
    const groupIndices: number[] | undefined = conv.data._productGroups?.[trimmed];
    if (groupIndices && groupIndices.length > 0) {
      const groupProducts = groupIndices.map((i: number) => products[i]).filter(Boolean) as ShopifyProduct[];
      const gl: string = conv.data._lang || 'ar';
      const baseName = groupProducts[0]!.title.replace(WEIGHT_STRIP_REGEX, '').trim();
      const bodyText = `*${wa(baseName)}*\n${msg('اختر الوزن:', 'Choose weight:', gl)}`;
      const imageUrl = groupProducts[0]!.imageUrl;

      if (groupProducts.length <= 3) {
        const buttons = groupProducts.map((p, j) => {
          const wm = p.title.match(WEIGHT_MATCH_REGEX);
          const weight = wm ? wm[0].trim() : p.title;
          return { id: `pick_${groupIndices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
        });
        if (buttons.length < 3) buttons.push({ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', gl) });
        if (imageUrl) {
          await sendWhatsAppButtonsWithImage(conv.phone, imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
        } else {
          await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
        }
      } else {
        const rows = groupProducts.slice(0, 10).map((p, j) => {
          const wm = p.title.match(WEIGHT_MATCH_REGEX);
          const weight = wm ? wm[0].trim() : p.title;
          return { id: `pick_${groupIndices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
        });
        await sendWhatsAppList(
          conv.phone,
          bodyText,
          msg('الأوزان', 'Weights', gl),
          rows,
          accessToken,
          client.phone_number_id
        );
      }
      return;
    }
  }

  // Try direct product name match
  let selected = matchProduct(message, products);

  // Question form → AI first, ahead of pattern matcher (fgf.md #41).
  if (!selected && isQuestionMessage(message)) {
    const aiFirst = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiFirst) return;
  }

  // "Best of" queries — show top 3 product cards with image + price + CTA
  if (!selected) {
    const topProducts = getTopProductsByQuery(message, products);
    if (topProducts.length > 0) {
      conv.data._reprompted = null;
      await showTopProducts(client, conv, config, accessToken, topProducts);
      return;
    }
  }

  // Try pattern-based question if no direct match (single-product fallback)
  if (!selected) {
    selected = tryAnswerProductQuestion(message, products, config.currency);
  }

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    if (shouldSendHint(conv)) {
      await sendHomeHint(client, conv, accessToken);
      markHinted(conv);
      return;
    }
    await showProductList(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
  conv.data._selectedProduct = selected;
  await showVariantOrProductView(client, conv, config, accessToken, selected);
}

// ============================================================
// STATE: PRODUCT_VIEW
// ============================================================

async function handleProductView(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const trimmed = message.trim();
  const product: ShopifyProduct = conv.data._selectedProduct;

  if (!product) {
    // Stale state (e.g. server restart) — recover by showing product list
    await showProductList(client, conv, config, accessToken);
    return;
  }

  if (trimmed === 'add_to_cart') {
    // Variant already selected upstream — go straight to qty (with image)
    const variant = conv.data._selectedVariant || product.variants[0];
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;
    await showProductWithQty(client, conv, config, accessToken, product);
    return;
  }

  if (trimmed === 'back_to_list') {
    // Go back to the mode they came from
    const browseMode = conv.data._browseMode || 'list';
    if (browseMode === 'image') {
      await showProductNames(client, conv, config, accessToken);
      conv.data._shopifyState = 'image_browse';
    } else {
      await showProductList(client, conv, config, accessToken);
      conv.data._shopifyState = 'catalog';
    }
    return;
  }

  if (trimmed === 'view_cart') {
    conv.data._shopifyState = 'cart';
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Try AI for product questions, then re-show the action buttons
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) {
      await showProductView(client, conv, config, accessToken, product);
      return;
    }
  }

  // Unrecognized — reprompt → hint → silence
  if (shouldSilence(conv)) return;
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  await showProductView(client, conv, config, accessToken, product);
  markReprompted(conv);
}

// ============================================================
// STATE: VARIANT_SELECT
// ============================================================

async function handleVariantSelect(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const product: ShopifyProduct = conv.data._selectedProduct;
  const availableVariants = product.variants.filter((v: any) => v.available);

  const variant = matchVariant(message, availableVariants);
  if (!variant) {
    // Customer typed a question instead of picking a size/variant — e.g.
    // "what's the difference between small and large?". Answer it, then
    // re-show the variant card so they can still pick (fgf.md #40).
    if (isQuestionMessage(message)) {
      const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
      if (aiHandled) {
        await showVariantOrProductView(client, conv, config, accessToken, product);
        return;
      }
    }
    const vsl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('اختر من الخيارات المتاحة 👇', 'Please choose from the available options 👇', vsl), accessToken, client.phone_number_id);
    // Re-render the variant card so the buttons are within reach instead of
    // forcing the customer to scroll back up the chat.
    await showVariantOrProductView(client, conv, config, accessToken, product);
    return;
  }

  conv.data._selectedVariant = variant;
  conv.data._selectedVariantId = variant.id;
  conv.data._selectedVariantTitle = variant.title;
  // Variant chosen — show product card again with qty buttons (image stays visible)
  await showProductWithQty(client, conv, config, accessToken, product);
}

// ============================================================
// STATE: QUANTITY_SELECT
// ============================================================

async function handleQuantitySelect(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.trim().toLowerCase();

  // Match qty_N button IDs
  const qtyBtnMatch = lower.match(/^qty_(\d+)$/);
  let qty: number;
  if (qtyBtnMatch) {
    qty = parseInt(qtyBtnMatch[1]!);
  } else {
    const normalized = normalizeArabicNumbers(lower);
    qty = parseInt(normalized);
  }

  const MAX_QTY = 20;
  const qtyl: string = conv.data._lang || 'ar';
  if (isNaN(qty) || qty < 1) {
    // Question during quantity pick ("كم السعر للكيلو؟") — answer and
    // re-show the quantity card instead of silencing (fgf.md #40).
    if (isQuestionMessage(message)) {
      const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
      if (aiHandled) {
        const prod: ShopifyProduct = conv.data._selectedProduct;
        if (prod) await showProductWithQty(client, conv, config, accessToken, prod);
        return;
      }
    }
    await sendWhatsAppMessage(conv.phone, msg('اكتب رقم الكمية (مثال: 1، 2، 3) 👇', 'Enter a quantity (e.g. 1, 2, 3) 👇', qtyl), accessToken, client.phone_number_id);
    // Re-render the qty buttons so the customer can tap instead of typing.
    const prodRetry: ShopifyProduct = conv.data._selectedProduct;
    if (prodRetry) await showProductWithQty(client, conv, config, accessToken, prodRetry);
    return;
  }
  if (qty > MAX_QTY) {
    await sendWhatsAppMessage(conv.phone, msg(`الحد الأقصى ${MAX_QTY} قطعة. اكتب كمية أقل.`, `Maximum quantity is ${MAX_QTY}. Please enter a smaller amount.`, qtyl), accessToken, client.phone_number_id);
    const prodMax: ShopifyProduct = conv.data._selectedProduct;
    if (prodMax) await showProductWithQty(client, conv, config, accessToken, prodMax);
    return;
  }

  const product: ShopifyProduct = conv.data._selectedProduct;
  if (!product) {
    await showProductList(client, conv, config, accessToken);
    return;
  }
  const variant = conv.data._selectedVariant || product.variants[0];

  // Add to cart with quantity
  const wasEmpty = (conv.data._cart || []).length === 0;
  addToCart(conv, product, variant?.id, variant?.title, variant?.price || product.priceMin, qty);

  // Refund the AI budget once per session when the customer first adds to
  // cart — they've shown purchase intent, and cart/payment-stage questions
  // ("when does it arrive?", "can I pay on delivery?") are higher-leverage
  // than browse chatter. Without this, a chatty browser could exhaust the
  // 6-question budget before ever reaching checkout (critique #15).
  if (wasEmpty && !conv.data._aiBudgetRefunded) {
    conv.data._aiAnswerCount = 0;
    conv.data._aiExhaustedNotified = false;
    conv.data._aiBudgetRefunded = true;
  }


  const itemLabel = variant?.title && variant.title !== 'Default Title'
    ? `${product.title} (${variant.title})`
    : product.title;
  const qtyLabel = qty > 1 ? ` x${qty}` : '';
  const cartl: string = conv.data._lang || 'ar';

  conv.messages.push({ role: 'assistant', content: `Added ${itemLabel} x${qty} to cart` });

  // Go to cart — prefix tells the customer what was just added
  const justAdded = `✅ ${msg('تمت الإضافة', 'Added', cartl)}: *${itemLabel}*${qtyLabel}`;
  await showCart(client, conv, config, accessToken, justAdded);
}

// ============================================================
// STATE: CART
// ============================================================

async function handleCart(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Add more products — respect the mode they originally picked. On
  // session resume `_browseMode` can be missing (older conversations
  // didn't set it), so silently defaulting to list regresses image-browse
  // users. When unknown, re-show the browse-choice picker instead.
  if (lower === 'add_more' || lower === 'تسوق' || lower === 'تسوق أكثر'
    || lower.includes('أضف منتج') || lower.includes('ضيف منتج') || lower.includes('زيد منتج')
    || lower.includes('أضف أكثر') || lower.includes('تسوق أكثر')) {
    // Always use the compact product list for add-more — re-dumping the
    // full image gallery is spammy when the customer already picked once.
    await showProductList(client, conv, config, accessToken);
    conv.data._shopifyState = 'catalog';
    return;
  }

  // Remove a product
  if (lower === 'remove_item' || lower.includes('حذف') || lower.includes('شيل') || lower.includes('أزل')) {
    conv.data._shopifyState = 'cart_remove';
    await showCartForRemoval(client, conv, config, accessToken);
    return;
  }

  // Checkout — explicit words + short "اطلب" alone
  if (lower === 'checkout_now' || lower === 'اطلب'
    || lower.includes('اطلب الآن') || lower.includes('اطلب الان')
    || lower.includes('اتمام الطلب') || lower.includes('اتمام')
    || lower.includes('ادفع') || lower.includes('أطلب الآن') || lower.includes('أطلب الان')) {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // View cart (re-show)
  if (lower === 'view_cart') {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Try AI answer (product questions mid-cart) before reprompt.
  // After an AI answer in cart state, re-show the cart menu so the
  // checkout button stays within reach (AI-8).
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Didn't understand — reprompt → hint → silence
  if (shouldSilence(conv)) return;
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  await showCart(client, conv, config, accessToken);
  markReprompted(conv);
}

// ============================================================
// STATE: CART_REMOVE
// ============================================================

async function handleCartRemove(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];
  const lower = message.toLowerCase().trim();

  // Match by remove_N button ID
  const removeMatch = lower.match(/^remove_(\d+)$/);
  let idx = -1;
  if (removeMatch) {
    idx = parseInt(removeMatch[1]!);
  } else {
    // Try number match
    const num = parseInt(normalizeArabicNumbers(lower));
    if (num >= 1 && num <= cart.length) idx = num - 1;
  }

  if (idx >= 0 && idx < cart.length) {
    const removed = cart.splice(idx, 1)[0]!;
    conv.data._cart = cart;
    conv.data._cartUpdatedAt = new Date().toISOString();
    const crl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg(`تم حذف *${removed.productTitle}* من السلة.`, `*${removed.productTitle}* removed from cart.`, crl), accessToken, client.phone_number_id);

    if (cart.length === 0) {
      await sendWhatsAppMessage(conv.phone, msg('السلة فاضية.', 'Your cart is empty.', crl), accessToken, client.phone_number_id);
      await showProductList(client, conv, config, accessToken);
      return;
    }

    // Back to cart with updated cart
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Cancel removal
  if (lower.includes('لا') || lower.includes('رجوع') || lower.includes('كنسل')) {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Question during remove-item prompt — answer, then re-show removal
  // menu so they can still pick an item (fgf.md #40).
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) {
      await showCartForRemoval(client, conv, config, accessToken);
      return;
    }
  }

  // Re-show removal options
  await showCartForRemoval(client, conv, config, accessToken);
}

// ============================================================
// STATE: AWAITING_PAYMENT
// ============================================================

async function handlePaymentConfirmation(
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

// ============================================================
// STATE: ORDER_COMPLETE
// ============================================================

async function handleOrderComplete(
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

// ============================================================
// STATE: DONE — Pure silence. New order is the only escape.
// ============================================================

async function handleDone(
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

// ============================================================
// STATE: ORDER_STATUS
// ============================================================

async function handleOrderStatus(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const l: string = conv.data._lang || 'ar';
  const lowerMsg = message.toLowerCase().trim();

  // "Track another" shortcut — clear saved order number so the flow
  // re-asks without the customer having to go home + re-enter the
  // order-status intent (fgf.md #28). We also clear the phone-lookup flag
  // so "track another" re-offers the saved-orders picker.
  if (lowerMsg === 'track_another' || lowerMsg.includes('طلب ثاني') || lowerMsg.includes('another order') || lowerMsg.includes('طلب اخر') || lowerMsg.includes('طلب آخر')) {
    delete conv.data._osOrderNum;
    conv.data._osOrderNumAsked = false;
    delete conv.data._osContextForwarded;
    delete conv.data._osLastForwardedAt;
    delete conv.data._osPhoneLookupTried;
    delete conv.data._osPhoneOrderNums;
  }

  // "Not mine" (customer rejected the picker) — fall through to manual entry.
  if (lowerMsg === 'os_not_mine' || lowerMsg.includes('مو طلبي') || lowerMsg.includes('not mine')) {
    delete conv.data._osPhoneOrderNums;
  }

  // Customer picked one of the matched orders from the phone-lookup picker.
  // Button id is `os_pick_<order_number>`; set _osOrderNum and flow through
  // to the normal Admin lookup below so we get the full formatted status.
  if (lowerMsg.startsWith('os_pick_')) {
    const picked = lowerMsg.slice('os_pick_'.length);
    if (/^\d+$/.test(picked)) {
      conv.data._osOrderNum = picked;
    }
  }

  // STEP 0: Try phone lookup once per session (Con-flow L17). If we find
  // exactly one order, show it directly. If we find several, offer a
  // picker. If none (or no admin token), fall through to asking for the
  // order number. We only try this once to avoid hammering the API when
  // the customer retries within the same session.
  const adminTokenEarly = client.settings?.shopify_admin_token || client.settings?.shopify?.adminToken;
  if (!conv.data._osOrderNum && !conv.data._osPhoneLookupTried && adminTokenEarly) {
    conv.data._osPhoneLookupTried = true;
    const recentOrders = await getOrdersByPhone(config.domain, adminTokenEarly, conv.phone);
    if (recentOrders.length === 1) {
      const only = recentOrders[0]!;
      await sendWhatsAppButtons(
        conv.phone,
        formatOrderStatus(only, l),
        [
          { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      markReprompted(conv);
      return;
    }
    if (recentOrders.length > 1) {
      // Show up to 3 most recent as buttons (WhatsApp caps interactive
      // buttons at 3). Remaining orders are available by typing the number.
      const picks = recentOrders.slice(0, 2).map(o => ({
        id: `os_pick_${o.order_number}`,
        title: `#${o.order_number}`
      }));
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          `لقينا ${recentOrders.length} طلبات مربوطة برقم جوالك. أي طلب تبي تتابع؟`,
          `We found ${recentOrders.length} orders linked to your phone. Which one would you like to track?`,
          l
        ),
        [
          ...picks,
          { id: 'os_not_mine', title: msg('غير ذلك', 'Other', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._osPhoneOrderNums = recentOrders.map(o => String(o.order_number));
      return;
    }
    // 0 results → fall through to normal "ask for number" flow.
  }

  // STEP 1: Ask for order number
  if (!conv.data._osOrderNum) {
    if (!conv.data._osOrderNumAsked) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'أرسل لنا رقم طلبك 📦\n_(مثال: #1042)_\n\nإذا ما عندك الرقم، اضغط تحت وراح نساعدك.',
          'Please send your order number 📦\n_(e.g. #1042)_\n\nIf you don\'t have the number, tap below and we\'ll help you.',
          l
        ),
        [
          { id: 'no_order_num', title: msg('ما عندي الرقم', 'I don\'t have it', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._osOrderNumAsked = true;
      return;
    }
    // "I don't have it" — escalate to owner so a human can look them up
    // by phone or past order history (fgf.md #25). Without Admin API
    // there's no automatic phone→orders lookup we can offer safely.
    if (lowerMsg === 'no_order_num' || lowerMsg.includes('ما عندي') || lowerMsg.includes('don\'t have') || lowerMsg.includes('dont have') || lowerMsg.includes('forgot') || lowerMsg.includes('نسيت')) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'لا عليك 🙏 فريقنا راح يراجع طلباتك عبر رقم جوالك ويتواصل معك قريباً.\n\nلو تبغى تسرع العملية، أرسل اسمك والمنتج وتاريخ الطلب تقريباً.',
          'No problem 🙏 Our team will review your orders by your phone number and contact you shortly.\n\nTo speed things up, send your name, the product, and approximate order date.',
          l
        ),
        [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
        accessToken,
        client.phone_number_id
      );
      if (!conv.data._osNotifiedOwner) {
        conv.data._osNotifiedOwner = true;
        await notifyOwner(client, conv, config, 'urgent', accessToken);
      }
      conv.data._osContextForwarded = true;
      conv.data._osLastForwardedAt = Date.now();
      markReprompted(conv);
      return;
    }
    // Already escalated (customer tapped "I don't have it") — any further
    // free-text is extra context. The owner was pinged on the first
    // escalation and will see any follow-up messages in the WhatsApp thread
    // anyway, so we never re-page them here (anti-spam rule). Only a
    // late-arriving explicit #1042 falls through to lookup. We also ack only
    // on the first follow-up; subsequent messages are silent so we don't
    // spam the customer with "forwarded ✅" on every message.
    if (conv.data._osContextForwarded && !/#\s*\d+/.test(normalizeArabicNumbers(message))) {
      if (!conv.data._osFollowupAcked) {
        conv.data._osFollowupAcked = true;
        await sendWhatsAppButtons(
          conv.phone,
          msg(
            'تم إرسال رسالتك للفريق ✅',
            'Your message has been forwarded to our team ✅',
            l
          ),
          [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
          accessToken,
          client.phone_number_id
        );
      }
      return;
    }
    // Prefer #N pattern; otherwise longest 3+ digit run so phone numbers/years
    // don't leak in as order numbers.
    const normalized = normalizeArabicNumbers(message);
    let parsedOrderNum: string | undefined;
    const hashMatch = normalized.match(/#\s*(\d+)/);
    if (hashMatch) {
      parsedOrderNum = hashMatch[1]!;
    } else {
      const runs = [...normalized.matchAll(/(\d{3,})/g)].map(m => m[1]!);
      if (runs.length > 0) {
        parsedOrderNum = runs.sort((a, b) => b.length - a.length)[0]!;
      }
    }
    if (!parsedOrderNum) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'ما قدرت أقرأ رقم الطلب. أرسله بهالشكل: #1042',
          'Could not read the order number. Send it like: #1042',
          l
        ),
        [
          { id: 'no_order_num', title: msg('ما عندي الرقم', 'I don\'t have it', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
    conv.data._osOrderNum = parsedOrderNum;
  }

  // STEP 2: Try Shopify Admin API if token available
  const adminToken = client.settings?.shopify_admin_token || client.settings?.shopify?.adminToken;
  if (adminToken) {
    await sendWhatsAppMessage(
      conv.phone,
      msg('جاري التحقق من طلبك...', 'Looking up your order...', l),
      accessToken,
      client.phone_number_id
    );
    const order = await getOrderByNumber(config.domain, adminToken, conv.data._osOrderNum);
    if (order) {
      await sendWhatsAppButtons(
        conv.phone,
        formatOrderStatus(order, l),
        [
          { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      markReprompted(conv);
      return;
    }
    // Order not found — ping owner once so a human can look the customer
    // up by phone or past history (Con-flow L21). Repeat lookups in the
    // same session don't re-page (anti-spam rule).
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `ما قدرنا نجد طلب برقم #${conv.data._osOrderNum}. تأكد من الرقم أو تواصل مع فريقنا.`,
        `We couldn't find order #${conv.data._osOrderNum}. Please verify the number or contact our team.`,
        l
      ),
      [
        { id: 'track_another', title: msg('جرب رقم ثاني', 'Try Another', l) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
      ],
      accessToken,
      client.phone_number_id
    );
    if (!conv.data._osNotifiedOwner) {
      conv.data._osNotifiedOwner = true;
      await notifyOwner(client, conv, config, 'urgent', accessToken);
    }
    markReprompted(conv);
    return;
  }

  // No Admin token — fallback: notify owner manually. Ask for context so
  // the owner can find the order faster, instead of just "team will review"
  // (fgf.md #26). Ping owner only once per session (anti-spam rule).
  await sendWhatsAppButtons(
    conv.phone,
    msg(
      `شكراً! فريقنا راح يراجع طلبك #${conv.data._osOrderNum} ويتواصل معك قريباً.\n\nلو تبغى تسرع، أرسل اسمك والمنتج وتاريخ الطلب تقريباً.`,
      `Thank you! Our team will review order #${conv.data._osOrderNum} and contact you shortly.\n\nTo speed things up, send your name, the product, and approximate order date.`,
      l
    ),
    [
      { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
    ],
    accessToken,
    client.phone_number_id
  );
  if (!conv.data._osNotifiedOwner) {
    conv.data._osNotifiedOwner = true;
    await notifyOwner(client, conv, config, 'urgent', accessToken);
  }
  markReprompted(conv);
}

// ============================================================
// STATE: CUSTOMER_SERVICE
// ============================================================

async function handleCustomerService(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  _message: string,
  accessToken: string
): Promise<void> {
  const l: string = conv.data._lang || 'ar';

  // First contact — send acknowledgment once. No time window promised;
  // we can't guarantee a specific SLA, and giving a number sets a false
  // expectation when the owner is slow to reply.
  if (!conv.data._csAcknowledged) {
    conv.data._csAcknowledged = true;
    conv.data._csStartedAt = new Date().toISOString();
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        'وصل طلبك ✅ فريقنا راح يتواصل معك قريباً.\n\nإذا عندك تفاصيل إضافية، اكتبها هنا وراح توصل للفريق.',
        'Your request has been received ✅ Our team will be in touch soon.\n\nIf you have additional details, write them here and they will be forwarded to our team.',
        l
      ),
      accessToken,
      client.phone_number_id
    );
    conv.data._csLastNotifiedAt = Date.now();
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // Second message after ack — remind them once that the team will be in
  // touch, give a Home escape button, then go silent. The owner was
  // already notified on the first message and can read the full thread in
  // WhatsApp — no re-ping (anti-spam rule, Con-flow L25).
  if (!conv.data._csRepeatAcked) {
    conv.data._csRepeatAcked = true;
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        'فريقنا بيتواصل معك قريباً 🙏\n\nتقدر ترجع للرئيسية أو تنتظر رد الفريق.',
        'Our team will be in touch soon 🙏\n\nYou can return home or wait for our team to reply.',
        l
      ),
      [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Already acked twice — silent. Owner is handling it. Customer can still
  // type "رئيسية" / "home" or tap the Home button (global handler catches it).
}

// ============================================================
// CHECKOUT PROCESSING
// ============================================================

async function processCheckout(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];
  if (cart.length === 0) {
    const ecl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('السلة فاضية، اختر منتج أول.', 'Your cart is empty. Please choose a product first.', ecl), accessToken, client.phone_number_id);
    await showProductList(client, conv, config, accessToken);
    return;
  }

  // Guard against double-tap: if a checkout is already in progress,
  // ignore this tap — but treat the flag as stale after 30 seconds so a
  // hung/crashed prior attempt doesn't lock the customer out forever
  // (fgf.md #20). 30s is well above the worst-case Shopify checkout call.
  const CHECKOUT_LOCK_TIMEOUT_MS = 30_000;
  const lockStartedAt = conv.data._checkoutInProgressAt as number | undefined;
  if (conv.data._checkoutInProgress && lockStartedAt && Date.now() - lockStartedAt < CHECKOUT_LOCK_TIMEOUT_MS) {
    return;
  }
  conv.data._checkoutInProgress = true;
  conv.data._checkoutInProgressAt = Date.now();

  const pcl: string = conv.data._lang || 'ar';
  await sendWhatsAppMessage(conv.phone, msg('جاري تجهيز طلبك...', 'Preparing your order...', pcl), accessToken, client.phone_number_id);

  // ─── Cart revalidation (#20) — refuse to checkout stale carts
  // Re-fetch products and check each cart item is still available at the same price.
  const freshProducts = await fetchProductsCached(config.domain, config.storefrontToken, conv.data._lang || 'ar');
  const removedTitles: string[] = [];
  const changedLines: string[] = [];
  const validCart: CartItem[] = [];
  for (const item of cart) {
    const prod = freshProducts.find(p => p.id === item.productId);
    const variant = prod?.variants.find(v => v.id === item.variantId);
    if (!prod || !variant || !variant.available) {
      removedTitles.push(item.productTitle + (item.variantTitle && item.variantTitle !== 'Default Title' ? ` (${item.variantTitle})` : ''));
      continue;
    }
    if (variant.price !== item.price) {
      changedLines.push(`• ${item.productTitle}${item.variantTitle && item.variantTitle !== 'Default Title' ? ` (${item.variantTitle})` : ''}: ${formatPrice(item.price, config.currency)} → ${formatPrice(variant.price, config.currency)}`);
      item.price = variant.price;
    }
    validCart.push(item);
  }
  if (removedTitles.length > 0 || changedLines.length > 0) {
    conv.data._cart = validCart;
    let notice = msg('⚠️ تحديث على سلتك قبل الدفع:', '⚠️ Cart updated before checkout:', pcl);
    if (removedTitles.length > 0) {
      notice += '\n\n' + msg('تم حذف المنتجات التالية (غير متوفرة):', 'Removed (no longer available):', pcl);
      notice += '\n' + removedTitles.map(t => `• ${t}`).join('\n');
    }
    if (changedLines.length > 0) {
      notice += '\n\n' + msg('تغيرت الأسعار:', 'Prices changed:', pcl);
      notice += '\n' + changedLines.join('\n');
    }
    await sendWhatsAppMessage(conv.phone, notice, accessToken, client.phone_number_id);
    conv.data._checkoutInProgress = false;
    if (validCart.length === 0) {
      await sendWhatsAppMessage(conv.phone, msg('السلة فاضية الآن. اختر منتج جديد.', 'Your cart is now empty. Please pick a new product.', pcl), accessToken, client.phone_number_id);
      await showProductList(client, conv, config, accessToken);
      return;
    }
    // Re-show cart so the customer confirms the new totals before checkout
    conv.data._shopifyState = 'cart';
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Create multi-item checkout — pass country code so Shopify Markets shows local currency
  const countryCode = phoneToCountryCode(conv.phone);
  const lines = cart.map(item => ({ variantId: item.variantId, quantity: item.quantity || 1 }));
  let checkout = await createMultiItemCheckout(config.domain, config.storefrontToken, lines, countryCode);

  // Fallback: try single-item checkout if only 1 item and multi failed
  if (!checkout && cart.length === 1) {
    checkout = await createCheckout(config.domain, config.storefrontToken, cart[0]!.variantId, cart[0]!.quantity || 1, countryCode);
  }

  if (!checkout) {
    conv.data._checkoutInProgress = false; // allow retry
    await sendWhatsAppMessage(conv.phone, msg('عذراً، صار خطأ في إنشاء الطلب. جرب مرة ثانية.', 'Sorry, there was an error creating your order. Please try again.', conv.data._lang || 'ar'), accessToken, client.phone_number_id);
    // Notify owner — customer was ready to pay but checkout failed
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    await trackClientError(client, 'Shopify Checkout', new Error('Checkout creation failed'));
    return;
  }

  delete conv.data._checkoutInProgress; // checkout created — no longer needed

  // Calculate cart total from our local cart (source of truth) — with quantities
  const cartTotal = cart.reduce((sum: number, i: CartItem) => sum + parseFloat(i.price) * (i.quantity || 1), 0);
  const cartTotalStr = cartTotal.toFixed(2);

  // Alert owner + warn customer if Shopify price differs significantly (>1%)
  // — discount/bundle/tax; customer shouldn't be surprised at the checkout page.
  let mismatchNote = '';
  if (checkout.totalPrice) {
    const shopifyTotal = parseFloat(checkout.totalPrice);
    const diffPct = Math.abs(shopifyTotal - cartTotal) / cartTotal;
    if (diffPct > 0.01) {
      console.warn(`⚠️ Price mismatch: Shopify=${checkout.totalPrice}, Cart=${cartTotalStr} (${(diffPct * 100).toFixed(1)}%)`);
      await notifyOwner(client, conv, config, 'urgent', accessToken);
      const shopifyPriceStr = formatPrice(checkout.totalPrice, checkout.currency);
      mismatchNote = msg(
        `\n\n⚠️ ملاحظة: المبلغ الفعلي على صفحة الدفع هو ${shopifyPriceStr} (قد يشمل ضريبة/شحن/خصم).`,
        `\n\n⚠️ Note: the actual amount on the checkout page is ${shopifyPriceStr} (may include tax/shipping/discount).`,
        pcl
      );
    }
  }

  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: cartTotalStr,  // Use cart-calculated total, not Shopify API
    currency: checkout.currency
  };
  emitEvent(client.id, 'checkout_created', conv.phone, {
    items: cart.length,
    total: cartTotalStr,
    currency: checkout.currency,
    products: cart.map((i: any) => ({ title: i.productTitle, variant: i.variantTitle, qty: i.quantity || 1, price: i.price }))
  });

  // Build cart summary for payment message
  let cartSummary = '';
  for (const item of cart) {
    const qty = item.quantity || 1;
    cartSummary += `- ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') {
      cartSummary += ` (${item.variantTitle})`;
    }
    if (qty > 1) cartSummary += ` x${qty}`;
    cartSummary += ` — ${formatPrice((parseFloat(item.price) * qty).toFixed(2), checkout.currency)}`;
    cartSummary += '\n';
  }

  const price = formatPrice(cartTotalStr, checkout.currency);

  // Single message: order summary + payment link — no buttons, webhook confirms payment
  const nameGreet = conv.data.name ? (pcl === 'en' ? ` ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  const paymentMsg = msg(
    `تمام${nameGreet}! هذي تفاصيل طلبك:\n\n${cartSummary}\n*المجموع: ${price}*${mismatchNote}\n\n💳 رابط الدفع:\n${checkout.checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅`,
    `Great${nameGreet}! Here are your order details:\n\n${cartSummary}\n*Total: ${price}*${mismatchNote}\n\n💳 Payment link:\n${checkout.checkoutUrl}\n\nWe'll confirm your payment automatically ✅`,
    pcl
  );
  await sendWhatsAppMessage(conv.phone, paymentMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: paymentMsg });

  conv.data._checkoutSentAt = new Date().toISOString();
  conv.data._shopifyState = 'awaiting_payment';
}

// ============================================================
// OWNER NOTIFICATION
// ============================================================

async function notifyOwner(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  type: 'paid' | 'help' | 'urgent' | 'unverified',
  accessToken: string
): Promise<void> {
  if (type === 'help' || type === 'urgent') {
    emitEvent(client.id, 'escalation', conv.phone, { reason: type });
  }
  const cart: CartItem[] = conv.data._cart || [];
  const checkout = conv.data._checkout;
  const totalPrice = checkout?.totalPrice || (cart.length > 0 ? cart.reduce((s: number, i: CartItem) => s + parseFloat(i.price) * (i.quantity || 1), 0).toFixed(2) : '0');
  const price = formatPrice(totalPrice, checkout?.currency || config.currency);
  // Owner-notification language is independent of the customer's language:
  // a Saudi shop can have English-speaking staff handling Arabic customers.
  const ownerLang: 'ar' | 'en' = client.settings?.owner_notification_lang === 'en' ? 'en' : 'ar';
  const time = new Date().toLocaleString(
    ownerLang === 'en' ? 'en-GB' : 'ar-SA',
    { timeZone: 'Asia/Riyadh' }
  );
  const displayName = conv.data.name || conv.phone;

  // Build cart text
  let cartText = '';
  if (cart.length > 0) {
    cartText = cart.map(i => {
      const qty = i.quantity || 1;
      let line = `📦 ${i.productTitle}`;
      if (i.variantTitle && i.variantTitle !== 'Default Title') line += ` (${i.variantTitle})`;
      if (qty > 1) line += ` x${qty}`;
      line += ` — ${formatPrice((parseFloat(i.price) * qty).toFixed(2), checkout?.currency || config.currency)}`;
      return line;
    }).join('\n');
  } else if (conv.data._selectedProduct) {
    cartText = `📦 ${conv.data._selectedProduct.title}`;
    if (conv.data._selectedVariantTitle && conv.data._selectedVariantTitle !== 'Default Title') {
      const variantLabel = ownerLang === 'en' ? 'Variant' : 'النوع';
      cartText += `\n📏 ${variantLabel}: ${conv.data._selectedVariantTitle}`;
    }
  }

  // Order history summary
  const history = conv.data._orderHistory || [];
  const historyText = history.length > 0
    ? (ownerLang === 'en'
        ? `\n📜 Previous orders: ${history.length}`
        : `\n📜 طلبات سابقة: ${history.length}`)
    : '';

  let notification = '';

  if (type === 'paid') {
    notification = ownerLang === 'en'
      ? `✅ *Paid order — ${config.storeName}*

👤 Customer: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 Total: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⏰ ${time}`
      : `✅ *طلب مدفوع — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 المجموع: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⏰ ${time}`;
  } else if (type === 'unverified') {
    notification = ownerLang === 'en'
      ? `⏳ *Order awaiting verification — ${config.storeName}*

👤 Customer: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 Total: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⚠️ Payment not verified yet
⏰ ${time}`
      : `⏳ *طلب بانتظار التحقق — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 المجموع: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⚠️ لم يتم التحقق من الدفع بعد
⏰ ${time}`;
  } else if (type === 'help') {
    const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user')?.content || '-';
    notification = ownerLang === 'en'
      ? `⚠️ *Customer needs help — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '-'}
💰 ${price}
🔗 ${checkout?.url || '-'}${historyText}

💬 "${lastUserMsg}"

⏰ ${time}`
      : `⚠️ *عميل يحتاج مساعدة — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '-'}
💰 ${price}
🔗 ${checkout?.url || '-'}${historyText}

💬 "${lastUserMsg}"

⏰ ${time}`;
  } else {
    const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user')?.content || '-';
    notification = ownerLang === 'en'
      ? `🚨 *Urgent — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 Last order: -'}
💰 ${price}${historyText}

Last message: ${lastUserMsg}

⏰ ${time}`
      : `🚨 *طلب عاجل — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 آخر طلب: -'}
💰 ${price}${historyText}

آخر رسالة: ${lastUserMsg}

⏰ ${time}`;
  }

  // Send to all agent phones
  for (const agentPhone of client.agent_phones || []) {
    try {
      await sendWhatsAppMessage(agentPhone, notification, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('❌ Owner notify error:', err);
    }
  }

  // Also send to owner phone from config (if different)
  if (config.ownerPhone && !(client.agent_phones || []).includes(config.ownerPhone)) {
    try {
      await sendWhatsAppMessage(config.ownerPhone, notification, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('❌ Owner notify error:', err);
    }
  }
}
