// ============================================================
// CONVERSATION ROUTER
// Thin state machine router — reads industry/config, delegates to flows.
// ============================================================

import { getConversation, saveConversation, getClientByPhoneNumberId } from './services/database.js';
import { getDefaultMessages, type ClientMessages, SHOPIFY_MESSAGES, SHOPIFY_EXTRA_MESSAGES, formatMessage } from './messages.js';
import { DEFAULT_APPOINTMENT_SETTINGS, type AppointmentSettings } from './services/appointments.js';
import {
  fetchProducts,
  searchProducts,
  getProductById,
  createCheckout,
  formatPriceSAR,
  type ShopifyProduct
} from './services/shopify.js';
import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } from './services/whatsapp.js';
import { normalizeArabicNumbers } from './utils/buttons.js';

// Flow handlers
import { handleShopifyAgent } from './flows/ecommerce.js';
import {
  handleWelcome,
  handleQuestions,
  handleAppointmentDate,
  handleAppointmentTime,
  handleChat,
  handleAIConversation,
  handleHandoverRequest,
  detectPostCompletionIntent,
  detectHandoverIntent,
  isAIConversationAvailable,
  type ConversationState,
  type ClientFeatures
} from './flows/common.js';

const CONVERSATION_TIMEOUT_HOURS = 24;

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleIncomingMessage(
  phoneNumberId: string,
  customerPhone: string,
  message: string,
  accessToken: string
): Promise<void> {
  // Get client configuration
  const client = await getClientByPhoneNumberId(phoneNumberId);
  if (!client) {
    console.error(`❌ No client found for: ${phoneNumberId}`);
    return;
  }

  // Parse features with defaults
  const features: ClientFeatures = {
    ai_fallback: client.features?.ai_fallback || false,
    lead_scoring: client.features?.lead_scoring || false,
    handover_detection: client.features?.handover_detection || false,
    appointment_setting: client.features?.appointment_setting || false,
    ai_conversation: client.features?.ai_conversation || false
  };

  // Get appointment settings from client or use defaults
  const appointmentSettings: AppointmentSettings = {
    ...DEFAULT_APPOINTMENT_SETTINGS,
    ...client.settings?.appointment
  };

  // Get messages - use code defaults, only override questions from database
  const defaults = getDefaultMessages(client.industry);
  const clientMessages: ClientMessages = {
    ...defaults,
    questions: client.questions?.length > 0 ? client.questions : defaults.questions
  };

  // Get or create conversation
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

  // Check for back command (only during active flow, not after completion)
  if (conv.state !== 'completed' && conv.state !== 'chat') {
    const backResult = handleBackCommand(message, conv);
    if (backResult.handled) {
      conv.state = backResult.newState as any;
      conv.step = backResult.newStep;
    }
  }

  // ============================================================
  // HANDOVER DETECTION (if enabled, works in any state)
  // ============================================================
  if (features.handover_detection && detectHandoverIntent(message)) {
    await handleHandoverRequest(client, conv, message, clientMessages, accessToken);
    await saveConversation(conv);
    return;
  }

  // ============================================================
  // ROUTE TO FLOW
  // ============================================================

  // ECOMMERCE / SHOPIFY AGENT MODE — full e-commerce flow
  const hasShopifyConfig = client.settings?.shopify_domain || client.settings?.shopify?.domain;
  if (hasShopifyConfig && (conv.state === 'welcome' || conv.state === 'shopify_agent')) {
    conv.state = 'shopify_agent';
    await handleShopifyAgent(client, conv, message, accessToken);
    await saveConversation(conv);
    return;
  }

  // AI CONVERSATION MODE — skip rigid flow entirely
  if (features.ai_conversation && isAIConversationAvailable()) {
    if (conv.state === 'welcome' || conv.state === 'ai_conversation') {
      conv.state = 'ai_conversation';
      await handleAIConversation(client, conv, message, features, accessToken);
      await saveConversation(conv);
      return;
    }
    if (conv.state === 'completed' || conv.state === 'chat') {
      await saveConversation(conv);
      return;
    }
  }

  // STANDARD FLOW — questions, appointments, etc.
  switch (conv.state) {
    case 'welcome':
      await handleWelcome(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'questions':
      await handleQuestions(client, conv, message, clientMessages, features, appointmentSettings, accessToken);
      break;
    case 'appointment_date':
      await handleAppointmentDate(client, conv, message, clientMessages, appointmentSettings, accessToken);
      break;
    case 'appointment_time':
      await handleAppointmentTime(client, conv, message, clientMessages, appointmentSettings, accessToken, features);
      break;
    // Legacy Shopify states (for clients using old shopify config, not shopify_domain)
    case 'shopify_browse':
      await handleShopifyBrowse(client, conv, message, accessToken);
      break;
    case 'shopify_search':
      await handleShopifySearch(client, conv, message, accessToken);
      break;
    case 'shopify_product':
      await handleShopifyProduct(client, conv, message, accessToken);
      break;
    case 'shopify_cart':
      await handleShopifyCart(client, conv, message, clientMessages, accessToken);
      break;
    case 'shopify_confirmed':
      await handleShopifyConfirmed(client, conv, message, accessToken);
      break;
    case 'ai_conversation':
      await handleAIConversation(client, conv, message, features, accessToken);
      break;
    case 'completed':
      conv.state = 'chat';
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
    case 'chat':
      await handleChat(client, conv, message, clientMessages, features, accessToken);
      break;
  }

  await saveConversation(conv);
}

// ============================================================
// ROUTER HELPERS
// ============================================================

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
    return { handled: true, newState: 'welcome', newStep: 0 };
  } else if (conv.state === 'appointment_date') {
    return { handled: true, newState: 'questions', newStep: conv.step };
  } else if (conv.state === 'appointment_time') {
    return { handled: true, newState: 'appointment_date', newStep: 0 };
  }
  return { handled: false, newState: conv.state, newStep: conv.step };
}

// ============================================================
// LEGACY SHOPIFY FLOW
// These states are for clients using the old shopify config
// (industry='shopify' without shopify_domain setting).
// New ecommerce clients use the Shopify Agent flow above.
// ============================================================

function getShopifyConfig(client: any): { domain: string; storefrontToken: string } | null {
  const shopify = client.settings?.shopify;
  if (!shopify?.domain || !shopify?.storefrontToken) return null;
  return { domain: shopify.domain, storefrontToken: shopify.storefrontToken };
}

async function showShopifyProductList(client: any, conv: ConversationState, accessToken: string): Promise<void> {
  const config = getShopifyConfig(client);
  if (!config) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }
  const products = await fetchProducts(config.domain, config.storefrontToken, 10);
  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noProducts, accessToken, client.phone_number_id);
    return;
  }
  conv.data.shopifyProducts = products;
  const listItems = products.map((p, i) => ({
    id: `product_${i}`,
    title: p.title.substring(0, 24),
    description: `${formatPriceSAR(p.priceMin)} ريال`
  }));
  await sendWhatsAppList(conv.phone, SHOPIFY_EXTRA_MESSAGES.productList, 'اختر منتج', listItems, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: SHOPIFY_EXTRA_MESSAGES.productList });
}

async function handleShopifyBrowse(client: any, conv: ConversationState, message: string, accessToken: string): Promise<void> {
  const products: ShopifyProduct[] = conv.data.shopifyProducts || [];
  const normalizedMessage = normalizeArabicNumbers(message.trim());
  let selectedProduct: ShopifyProduct | undefined;

  if (message.startsWith('product_')) {
    const idx = parseInt(message.replace('product_', ''));
    selectedProduct = products[idx];
  } else {
    const num = parseInt(normalizedMessage);
    if (num >= 1 && num <= products.length) {
      selectedProduct = products[num - 1];
    } else {
      selectedProduct = products.find(p => p.title.toLowerCase().includes(message.toLowerCase().trim()));
    }
  }

  if (!selectedProduct) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noProducts, accessToken, client.phone_number_id);
    await showShopifyProductList(client, conv, accessToken);
    return;
  }

  conv.data.selectedProductId = selectedProduct.id;
  conv.data.selectedProductTitle = selectedProduct.title;
  conv.data.selectedVariantId = selectedProduct.variants.find(v => v.available)?.id || selectedProduct.variants[0]?.id;
  conv.data.selectedProductPrice = selectedProduct.priceMin;
  conv.state = 'shopify_product';
  await showShopifyProductDetails(client, conv, selectedProduct, accessToken);
}

async function showShopifyProductDetails(client: any, conv: ConversationState, product: ShopifyProduct, accessToken: string): Promise<void> {
  const description = product.description ? product.description.substring(0, 200) : '';
  const detailMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.productDetails, {
    productName: product.title,
    price: formatPriceSAR(product.priceMin),
    description
  });
  await sendWhatsAppButtons(
    conv.phone, detailMsg,
    [{ id: 'order_now', title: SHOPIFY_EXTRA_MESSAGES.orderButton }],
    accessToken, client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: detailMsg });
}

async function handleShopifySearch(client: any, conv: ConversationState, message: string, accessToken: string): Promise<void> {
  const config = getShopifyConfig(client);
  if (!config) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }
  const results = await searchProducts(config.domain, config.storefrontToken, message, 10);
  if (results.length === 0) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.noSearchResults, accessToken, client.phone_number_id);
    await showShopifyProductList(client, conv, accessToken);
    conv.state = 'shopify_browse';
    return;
  }
  conv.data.shopifyProducts = results;
  conv.state = 'shopify_browse';
  await showShopifyProductList(client, conv, accessToken);
}

async function handleShopifyProduct(client: any, conv: ConversationState, message: string, accessToken: string): Promise<void> {
  const lower = message.toLowerCase().trim();
  const isOrder = lower === 'order_now' || message.includes('اطلب') || message.includes('أطلب') || message === '1';

  if (!isOrder) {
    const config = getShopifyConfig(client);
    if (conv.data.selectedProductId && config) {
      const product = await getProductById(config.domain, config.storefrontToken, conv.data.selectedProductId);
      if (product) { await showShopifyProductDetails(client, conv, product, accessToken); return; }
    }
    await sendWhatsAppButtons(
      conv.phone, `تبي تطلب *${conv.data.selectedProductTitle || 'المنتج'}*؟`,
      [{ id: 'order_now', title: SHOPIFY_EXTRA_MESSAGES.orderButton }],
      accessToken, client.phone_number_id
    );
    return;
  }

  const config = getShopifyConfig(client);
  if (!config || !conv.data.selectedVariantId) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    return;
  }

  conv.state = 'shopify_cart';
  const checkout = await createCheckout(config.domain, config.storefrontToken, conv.data.selectedVariantId, 1);
  if (!checkout) {
    await sendWhatsAppMessage(conv.phone, SHOPIFY_EXTRA_MESSAGES.apiError, accessToken, client.phone_number_id);
    conv.state = 'shopify_product';
    return;
  }

  conv.data.checkoutUrl = checkout.checkoutUrl;
  conv.data.checkoutPrice = checkout.totalPrice;

  const checkoutMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.checkoutLink, { checkoutUrl: checkout.checkoutUrl });
  await sendWhatsAppMessage(conv.phone, checkoutMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: checkoutMsg });

  const orderNotification = formatMessage(SHOPIFY_MESSAGES.agentNotification, {
    name: conv.data.name || 'غير معروف',
    phone: conv.phone,
    whatsapp: conv.phone.replace('+', ''),
    productName: conv.data.selectedProductTitle || '-',
    price: formatPriceSAR(conv.data.selectedProductPrice || conv.data.checkoutPrice),
    checkoutUrl: checkout.checkoutUrl,
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try { await sendWhatsAppMessage(agentPhone, orderNotification, accessToken, client.phone_number_id); }
    catch (err) { console.error('❌ Order notify error:', err); }
  }

  await sendWhatsAppButtons(
    conv.phone, 'بعد ما تكمل الدفع، اضغط الزر أدناه لتأكيد طلبك ✅',
    [{ id: 'confirm_payment', title: SHOPIFY_EXTRA_MESSAGES.confirmPaymentButton }],
    accessToken, client.phone_number_id
  );
}

async function handleShopifyCart(client: any, conv: ConversationState, message: string, messages: ClientMessages, accessToken: string): Promise<void> {
  const lower = message.toLowerCase().trim();
  const isConfirm = lower === 'confirm_payment'
    || message.includes('تأكيد الدفع') || message.includes('تأكيد')
    || message.includes('دفعت') || message.includes('تم الدفع');

  if (!isConfirm) {
    await sendWhatsAppButtons(
      conv.phone, 'بعد ما تكمل الدفع، اضغط الزر أدناه ✅',
      [{ id: 'confirm_payment', title: SHOPIFY_EXTRA_MESSAGES.confirmPaymentButton }],
      accessToken, client.phone_number_id
    );
    return;
  }

  conv.state = 'shopify_confirmed';

  const confirmMsg = formatMessage(SHOPIFY_EXTRA_MESSAGES.orderConfirmed, { name: conv.data.name || '' });
  await sendWhatsAppMessage(conv.phone, confirmMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: confirmMsg });

  const thankYouMsg = formatMessage(messages.thankYou, { businessName: client.name });
  await sendWhatsAppMessage(conv.phone, thankYouMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: thankYouMsg });

  const paymentNotif = formatMessage(SHOPIFY_EXTRA_MESSAGES.paymentConfirmation, {
    name: conv.data.name || 'غير معروف',
    phone: conv.phone,
    productName: conv.data.selectedProductTitle || '-',
    price: formatPriceSAR(conv.data.selectedProductPrice || conv.data.checkoutPrice || '0'),
    time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
  });

  for (const agentPhone of client.agent_phones || []) {
    try { await sendWhatsAppMessage(agentPhone, paymentNotif, accessToken, client.phone_number_id); }
    catch (err) { console.error('❌ Payment notify error:', err); }
  }

  try {
    const { createLead } = await import('./services/database.js');
    await createLead({ clientId: client.id, phone: conv.phone, name: conv.data.name || '', email: '', data: conv.data, score: 'hot' });
  } catch (err) { console.error('❌ Lead save error (shopify):', err); }

  console.log(`✅ Shopify order confirmed: ${conv.data.name} (${conv.phone}) - ${conv.data.selectedProductTitle}`);
}

async function handleShopifyConfirmed(client: any, conv: ConversationState, message: string, accessToken: string): Promise<void> {
  const intent = detectPostCompletionIntent(message);
  if (intent.forwardToAgent) {
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

    const response = INTENT_RESPONSES[intent.type];
    if (response) {
      await sendWhatsAppMessage(conv.phone, response, accessToken, client.phone_number_id);
      conv.messages.push({ role: 'assistant', content: response });
    }
    const notificationTemplate = INTENT_AGENT_NOTIFICATIONS[intent.type];
    if (notificationTemplate) {
      const notification = formatMessage(notificationTemplate, {
        name: conv.data.name || 'غير معروف',
        phone: conv.phone,
        whatsapp: conv.phone.replace('+', ''),
        message,
        time: new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })
      });
      for (const agentPhone of client.agent_phones || []) {
        try { await sendWhatsAppMessage(agentPhone, notification, accessToken, client.phone_number_id); }
        catch (error) { console.error('❌ Agent notify error:', error); }
      }
    }
    return;
  }

  const fallbackMsg = `أهلاً ${conv.data.name || ''}! 👋\nطلبك على طريقه. إذا تحتاج مساعدة، رد بـ "موظف".`;
  await sendWhatsAppMessage(conv.phone, fallbackMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: fallbackMsg });
}
