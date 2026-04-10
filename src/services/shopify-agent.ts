// ============================================================
// SHOPIFY AI AGENT
// Full e-commerce WhatsApp agent with multi-item cart:
//   Welcome → Browse → Catalog → Product → Cart → Payment → Completion
// Works with tokenless Shopify Storefront API.
// ============================================================

import {
  fetchProducts,
  createCheckout,
  createMultiItemCheckout,
  formatPrice,
  type ShopifyProduct
} from './shopify.js';
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppList,
  sendWhatsAppImage
} from './whatsapp.js';
import { createLead } from './database.js';
import { looksLikeQuestion, generateKnowledgeResponse, isAIAvailable } from './knowledge.js';
import { smartTitle, truncate, normalizeArabicNumbers } from '../utils/buttons.js';

// ============================================================
// TYPES
// ============================================================

interface ShopifyAgentConfig {
  domain: string;              // e.g. "hsespd-dv.myshopify.com"
  storefrontToken?: string;    // optional — tokenless works
  storeName: string;           // e.g. "ARAB | عرب"
  ownerPhone?: string;         // owner gets receipts
  currency?: string;           // auto-detected from products
}

interface ConversationState {
  clientId: string;
  phone: string;
  messages: { role: string; content: string }[];
  state: string;
  step: number;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface CartItem {
  productTitle: string;
  productId: string;
  variantId: string;
  variantTitle: string;
  price: string;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleShopifyAgent(
  client: any,
  conv: ConversationState,
  message: string,
  accessToken: string
): Promise<void> {
  const config = getShopifyAgentConfig(client);
  if (!config) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، المتجر غير متاح حالياً.', accessToken, client.phone_number_id);
    return;
  }

  // Initialize cart and order history for new/existing conversations
  if (!conv.data._cart) conv.data._cart = [];
  if (!conv.data._orderHistory) conv.data._orderHistory = [];

  const shopifyState = conv.data._shopifyState || 'welcome';

  // Smart AI answering — intercept product questions at any state (except welcome)
  if (shopifyState !== 'welcome') {
    const isButtonId = /^(pick_\d+|var_\d+|show_images|pick_direct|paid_yes|paid_help|new_order|talk_agent|add_more|checkout_now|view_cart|no_thanks|remove_item|remove_\d+|help_menu|help_order_status|help_returns|help_agent)$/.test(message.trim());
    if (!isButtonId && looksLikeQuestion(message)) {
      const answered = await handleProductQuestion(client, conv, config, message, accessToken);
      if (answered) return;
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
    case 'product_detail':
      await handleProductAction(client, conv, config, message, accessToken);
      break;
    case 'cart_add':
      await handleCartAdd(client, conv, config, message, accessToken);
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
    default:
      await handleWelcome(client, conv, config, message, accessToken);
  }
}

// ============================================================
// STATE: WELCOME — Greet + fetch products + ask browse preference
// ============================================================

async function handleWelcome(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  _message: string,
  accessToken: string
): Promise<void> {
  // Send welcome
  const welcome = `أهلاً وسهلاً في *${config.storeName}*\n\nيسعدنا نخدمك. خلني أعرض لك منتجاتنا`;
  await sendWhatsAppMessage(conv.phone, welcome, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: welcome });

  // Fetch products
  const products = await fetchProducts(config.domain, config.storefrontToken, 10);

  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، ما فيه منتجات متوفرة حالياً.', accessToken, client.phone_number_id);
    return;
  }

  // Detect currency from first product
  config.currency = config.currency || 'KWD';

  // Store products in conversation
  conv.data._products = products.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    imageUrl: p.imageUrl,
    variants: p.variants
  }));

  // Ask customer preference before sending images
  await sendWhatsAppButtons(
    conv.phone,
    'تبي تشوف صور المنتجات ولا تختار من القائمة مباشرة؟',
    [
      { id: 'show_images', title: 'عرض الصور' },
      { id: 'pick_direct', title: 'اختر مباشرة' }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'browse_choice';
}

// ============================================================
// STATE: BROWSE_CHOICE — Customer decides images or direct list
// ============================================================

async function handleBrowseChoice(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const products: ShopifyProduct[] = conv.data._products || [];

  const wantsImages = lower === 'show_images' || lower.includes('صور') || lower.includes('شوف');
  const wantsDirect = lower === 'pick_direct' || lower.includes('مباشرة') || lower.includes('قائمة') || lower.includes('اختر');

  if (wantsImages) {
    // Send all product images first
    for (const product of products) {
      const priceText = formatPrice(product.priceMin, config.currency);
      const caption = `*${product.title}*\n${priceText}`;
      if (product.imageUrl) {
        await sendWhatsAppImage(conv.phone, product.imageUrl, caption, accessToken, client.phone_number_id);
      } else {
        await sendWhatsAppMessage(conv.phone, caption, accessToken, client.phone_number_id);
      }
      await sleep(500);
    }
    // Then show selection list
    await showProductCatalog(client, conv, config, accessToken, 'اختر المنتج اللي تبيه:');
    conv.data._shopifyState = 'catalog';
    return;
  }

  if (wantsDirect) {
    // Skip images, show list directly
    await showProductCatalog(client, conv, config, accessToken, 'اختر المنتج اللي تبيه:');
    conv.data._shopifyState = 'catalog';
    return;
  }

  // Maybe they already typed a product name — try to match
  const matched = matchProduct(message, products);
  if (matched) {
    conv.data._shopifyState = 'catalog';
    await handleCatalogSelection(client, conv, config, message, accessToken);
    return;
  }

  // Re-show the choice buttons
  await sendWhatsAppButtons(
    conv.phone,
    'تبي تشوف صور المنتجات ولا تختار من القائمة مباشرة؟',
    [
      { id: 'show_images', title: 'عرض الصور' },
      { id: 'pick_direct', title: 'اختر مباشرة' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// STATE: CATALOG — Customer picks a product (auto-adds to cart)
// ============================================================

async function handleCatalogSelection(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  const trimmed = message.trim();

  // Cart action buttons (shown alongside catalog when cart has items)
  if (trimmed === 'view_cart') {
    conv.data._shopifyState = 'cart_add';
    await showCartAndAskMore(client, conv, config, accessToken);
    return;
  }
  if (trimmed === 'checkout_now') {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  const selected = matchProduct(message, products);

  if (!selected) {
    await sendWhatsAppMessage(conv.phone, 'ما فهمت اختيارك. اختر من القائمة أو اكتب اسم المنتج.', accessToken, client.phone_number_id);
    return;
  }

  // Save selection
  conv.data._selectedProduct = selected;
  conv.data._selectedIndex = products.findIndex(p => p.id === selected.id);

  // Check if product has multiple variants
  const availableVariants = selected.variants.filter(v => v.available);
  if (availableVariants.length > 1 && availableVariants.some(v => v.title !== 'Default Title')) {
    // Show variant selection — user must pick before we can add to cart
    const variantList = availableVariants.slice(0, 3).map((v, i) => ({
      id: `var_${i}`,
      title: smartVariantTitle(v.title, v.price, config.currency, 20)
    }));
    await sendWhatsAppButtons(
      conv.phone,
      `*${selected.title}*\nاختر النوع:`,
      variantList,
      accessToken,
      client.phone_number_id
    );
    conv.data._shopifyState = 'product_detail';
  } else {
    // Single variant — add to cart immediately, re-show catalog
    const variant = availableVariants[0] || selected.variants[0];
    addToCart(conv, selected, variant?.id, variant?.title, variant?.price || selected.priceMin);

    const price = formatPrice(variant?.price || selected.priceMin, config.currency);
    await sendWhatsAppMessage(
      conv.phone,
      `تمت إضافة *${selected.title}* للسلة. (${price})`,
      accessToken, client.phone_number_id
    );
    conv.messages.push({ role: 'assistant', content: `Added ${selected.title} to cart` });

    // Stay in catalog — show products again with cart actions
    await sleep(300);
    await showProductCatalog(client, conv, config, accessToken, 'اختر منتج ثاني أو اعرض السلة:');
  }
}

// ============================================================
// STATE: PRODUCT_DETAIL — Variant selection, then auto-add to cart
// ============================================================

async function handleProductAction(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const trimmed = message.trim();

  // Cart action buttons (in case user clicks them while on variant screen)
  if (trimmed === 'view_cart') {
    conv.data._shopifyState = 'cart_add';
    await showCartAndAskMore(client, conv, config, accessToken);
    return;
  }
  if (trimmed === 'checkout_now') {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  const product: ShopifyProduct = conv.data._selectedProduct;
  const availableVariants = product.variants.filter(v => v.available);

  // Match variant
  let variant = matchVariant(message, availableVariants);
  if (!variant) {
    await sendWhatsAppMessage(conv.phone, 'اختر من الخيارات المتاحة', accessToken, client.phone_number_id);
    return;
  }

  // Add to cart immediately after variant selection
  addToCart(conv, product, variant.id, variant.title, variant.price);

  const price = formatPrice(variant.price, config.currency);
  await sendWhatsAppMessage(
    conv.phone,
    `تمت إضافة *${product.title}* (${variant.title}) للسلة. (${price})`,
    accessToken, client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: `Added ${product.title} (${variant.title}) to cart` });

  // Back to catalog — show products again with cart actions
  conv.data._shopifyState = 'catalog';
  await sleep(300);
  await showProductCatalog(client, conv, config, accessToken, 'اختر منتج ثاني أو اعرض السلة:');
}

// ============================================================
// STATE: CART_ADD — Add more items or checkout
// ============================================================

async function handleCartAdd(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Add more products
  if (lower === 'add_more' || lower.includes('أضف') || lower.includes('ضيف') || lower.includes('زيد')) {
    conv.data._shopifyState = 'catalog';
    await showProductCatalog(client, conv, config, accessToken, 'تفضل اختر منتج:');
    return;
  }

  // Remove a product
  if (lower === 'remove_item' || lower.includes('حذف') || lower.includes('شيل') || lower.includes('أزل')) {
    conv.data._shopifyState = 'cart_remove';
    await showCartForRemoval(client, conv, config, accessToken);
    return;
  }

  // Checkout
  if (lower === 'checkout_now' || lower.includes('اطلب') || lower.includes('ادفع')
    || lower.includes('تمام') || lower.includes('ماشي') || lower.includes('اوك')) {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // Cancel / no thanks — still process checkout if cart has items
  if (lower === 'no_thanks' || lower.includes('لا شكر') || lower.includes('خلاص')
    || lower.includes('كفاية') || lower.includes('باي')) {
    const cart: CartItem[] = conv.data._cart || [];
    if (cart.length > 0) {
      await processCheckout(client, conv, config, accessToken);
    } else {
      await sendWhatsAppMessage(conv.phone, 'شكراً لزيارتك، نتشرف بخدمتك.', accessToken, client.phone_number_id);
      conv.data._shopifyState = 'done';
    }
    return;
  }

  // Didn't understand — re-show options
  await showCartAndAskMore(client, conv, config, accessToken);
}

// ============================================================
// STATE: CART_REMOVE — Remove an item from cart
// ============================================================

async function handleCartRemove(
  client: any,
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
    await sendWhatsAppMessage(conv.phone, `تم حذف *${removed.productTitle}* من السلة.`, accessToken, client.phone_number_id);

    if (cart.length === 0) {
      conv.data._shopifyState = 'catalog';
      await showProductCatalog(client, conv, config, accessToken, 'السلة فاضية. تفضل اختر منتج:');
      return;
    }

    // Back to cart_add with updated cart
    conv.data._shopifyState = 'cart_add';
    await showCartAndAskMore(client, conv, config, accessToken);
    return;
  }

  // Cancel removal
  if (lower.includes('لا') || lower.includes('رجوع') || lower.includes('كنسل')) {
    conv.data._shopifyState = 'cart_add';
    await showCartAndAskMore(client, conv, config, accessToken);
    return;
  }

  // Re-show removal options
  await showCartForRemoval(client, conv, config, accessToken);
}

// ============================================================
// STATE: AWAITING_PAYMENT — Customer confirms payment
// FIX: No verification loop — immediately transitions to order_complete
// ============================================================

async function handlePaymentConfirmation(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Need help
  if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
    const helpMsg = 'فريقنا بيتواصل معك خلال دقائق.';
    await sendWhatsAppMessage(conv.phone, helpMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: helpMsg });
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // Confirm payment (self-reported)
  const isPaid = lower === 'paid_yes' || lower.includes('تم') || lower.includes('دفعت')
    || lower.includes('تأكيد') || lower.includes('done') || lower.includes('paid');

  if (!isPaid) {
    // Re-show payment link
    const checkoutUrl = conv.data._checkout?.url;
    if (checkoutUrl) {
      await sendWhatsAppButtons(
        conv.phone,
        `رابط الدفع:\n${checkoutUrl}\n\nهل دفعت؟`,
        [
          { id: 'paid_yes', title: 'تم الدفع' },
          { id: 'paid_help', title: 'أحتاج مساعدة' }
        ],
        accessToken,
        client.phone_number_id
      );
    }
    return;
  }

  // ===== PAYMENT CONFIRMED — immediate transition, no verification loop =====
  conv.data._paymentSelfReported = true;
  conv.data._paymentReportedAt = new Date().toISOString();

  // Notify agent
  await notifyOwner(client, conv, config, 'paid', accessToken);

  // Save lead
  const cart: CartItem[] = conv.data._cart || [];
  const checkout = conv.data._checkout;
  try {
    await createLead({
      clientId: client.id,
      phone: conv.phone,
      name: conv.data.name || conv.phone,
      email: '',
      data: {
        cart: cart.map(i => ({ product: i.productTitle, variant: i.variantTitle, price: i.price })),
        totalPrice: checkout?.totalPrice,
        currency: checkout?.currency || config.currency,
        checkoutUrl: checkout?.url || '',
        paymentConfirmed: true,
        orderDate: new Date().toISOString(),
        orderHistory: conv.data._orderHistory || []
      },
      score: 'hot'
    });
  } catch (err) {
    console.error('❌ Lead save error:', err);
  }

  // Show completion message with full cart summary
  let confirmMsg = 'شكراً لك، طلبك قيد التجهيز.\n\n';
  if (cart.length > 0) {
    confirmMsg += '*طلبك:*\n';
    for (const item of cart) {
      confirmMsg += `- ${item.productTitle}`;
      if (item.variantTitle && item.variantTitle !== 'Default Title') {
        confirmMsg += ` (${item.variantTitle})`;
      }
      confirmMsg += ` — ${formatPrice(item.price, checkout?.currency || config.currency)}\n`;
    }
    const total = cart.reduce((sum: number, i: CartItem) => sum + parseFloat(i.price), 0);
    confirmMsg += `\nالمجموع: ${formatPrice(total.toFixed(2), checkout?.currency || config.currency)}\n`;
  }
  confirmMsg += '\nتبي شي ثاني؟';

  await sendWhatsAppButtons(
    conv.phone,
    confirmMsg,
    [
      { id: 'new_order', title: 'طلب جديد' },
      { id: 'no_thanks', title: 'لا شكراً' }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'order_complete';
  console.log(`✅ Shopify payment confirmed: ${conv.phone} → ${cart.length} items`);
}

// ============================================================
// STATE: ORDER_COMPLETE — Order done, ask what next
// ============================================================

async function handleOrderComplete(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // New order
  if (lower === 'new_order' || lower.includes('طلب جديد') || lower.includes('ابي اطلب')
    || lower.includes('أبي أطلب') || lower.includes('تصفح') || lower.includes('من جديد')) {
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'catalog';
    await showProductCatalog(client, conv, config, accessToken, 'تفضل، اختر منتجك:');
    return;
  }

  // No thanks — goodbye
  if (lower === 'no_thanks' || lower.includes('لا شكر') || lower.includes('باي')
    || lower.includes('مع السلامة') || lower.includes('خلاص')) {
    await sendWhatsAppMessage(conv.phone, 'شكراً لتسوقك، نتشرف بخدمتك.', accessToken, client.phone_number_id);
    conv.data._shopifyState = 'done';
    return;
  }

  // Help / agent requests → show help categories
  const helpKeywords = ['مساعدة', 'موظف', 'بشر', 'تكلم', 'أكلم', 'اكلم', 'help'];
  if (lower === 'talk_agent' || lower === 'help_menu' || helpKeywords.some(k => lower.includes(k))) {
    await showHelpMenu(client, conv, accessToken);
    return;
  }

  // Urgent — cancel, complaint, order status
  const urgentKeywords = ['الغ', 'الغاء', 'ألغي', 'مشكلة', 'شكوى', 'وين طلبي'];
  if (urgentKeywords.some(k => lower.includes(k))) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك قريب.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // Default: re-show options
  await sendWhatsAppButtons(
    conv.phone,
    'تبي شي ثاني؟',
    [
      { id: 'new_order', title: 'طلب جديد' },
      { id: 'no_thanks', title: 'لا شكراً' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// STATE: DONE — Conversation finished, handle any follow-ups
// ============================================================

async function handleDone(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Track done-state interactions to prevent infinite loops
  if (!conv.data._doneInteractions) conv.data._doneInteractions = 0;
  conv.data._doneInteractions++;

  // Start a new order
  if (lower === 'new_order' || lower.includes('طلب جديد') || lower.includes('ابي اطلب')
    || lower.includes('أبي أطلب') || lower.includes('تصفح') || lower.includes('اطلب')
    || lower.includes('أطلب') || lower.includes('منتج') || lower.includes('شراء')) {
    conv.data._doneInteractions = 0;
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'catalog';
    await showProductCatalog(client, conv, config, accessToken, 'تفضل، اختر منتجك:');
    return;
  }

  // Goodbye — don't repeat the same message
  const goodbyeKeywords = ['لا شكر', 'لا اب', 'لا أب', 'باي', 'مع السلامة', 'خلاص',
    'تسلم', 'سلام', 'حياك', 'الله يسلمك', 'شكراً', 'شكرا', 'مشكور', 'يعطيك العافية',
    'no', 'bye', 'thanks'];
  if (lower === 'no_thanks' || goodbyeKeywords.some(k => lower.includes(k))) {
    await sendWhatsAppMessage(conv.phone, 'شكراً لتسوقك، نتشرف بخدمتك.', accessToken, client.phone_number_id);
    return;
  }

  // Help / agent → show help categories
  const helpKeywords = ['مساعدة', 'موظف', 'بشر', 'تكلم', 'أكلم', 'اكلم', 'help'];
  if (lower === 'talk_agent' || lower === 'help_menu' || helpKeywords.some(k => lower.includes(k))) {
    await showHelpMenu(client, conv, accessToken);
    return;
  }

  // Help category buttons from showHelpMenu
  if (lower === 'help_order_status') {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بتحديث قريب.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_returns') {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بخصوص الاسترجاع.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_agent') {
    await sendWhatsAppMessage(conv.phone, 'فريقنا بيتواصل معك خلال دقائق.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // Urgent keywords — forward to agent
  const urgentKeywords = ['الغ', 'الغاء', 'مشكلة', 'شكوى', 'وين طلبي'];
  if (urgentKeywords.some(k => lower.includes(k))) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك قريب.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // After 3 interactions in done state, stop responding with options
  if (conv.data._doneInteractions > 3) {
    await sendWhatsAppMessage(conv.phone, 'إذا تحتاج شي، تقدر تراسلنا وقت ما تبي.', accessToken, client.phone_number_id);
    return;
  }

  // Default: show options (not a repeating "how can I help" message)
  await sendWhatsAppButtons(
    conv.phone,
    'كيف نقدر نساعدك؟',
    [
      { id: 'new_order', title: 'طلب جديد' },
      { id: 'help_menu', title: 'مساعدة' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// SMART AI ANSWERING — answer product questions using knowledge base
// ============================================================

async function handleProductQuestion(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<boolean> {
  if (!isAIAvailable()) return false;

  // Build knowledge base from client data + product catalog
  const clientKB = client.knowledge_base || [];
  const products: ShopifyProduct[] = conv.data._products || [];
  const productKB = products.map(p => ({
    category: 'منتجات',
    question: p.title,
    answer: `${p.title} — السعر: ${formatPrice(p.priceMin, config.currency)}`
  }));
  const augmentedKB = [...clientKB, ...productKB];

  if (augmentedKB.length === 0) return false;

  try {
    const response = await generateKnowledgeResponse(
      config.storeName,
      augmentedKB,
      conv.data,
      conv.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      message
    );

    await sendWhatsAppMessage(conv.phone, response.answer, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: response.answer });
    return true;
  } catch (error) {
    console.error('❌ Product question AI error:', error);
    return false;
  }
}

// ============================================================
// HELPERS
// ============================================================

function getShopifyAgentConfig(client: any): ShopifyAgentConfig | null {
  const domain = client.settings?.shopify_domain || client.settings?.shopify?.domain;
  if (!domain) return null;

  return {
    domain,
    storefrontToken: client.settings?.shopify_token || client.settings?.shopify?.storefrontToken,
    storeName: client.name || 'المتجر',
    ownerPhone: client.agent_phones?.[0],
    currency: client.settings?.currency || 'KWD'
  };
}

function matchProduct(message: string, products: ShopifyProduct[]): ShopifyProduct | null {
  const lower = message.toLowerCase().trim();

  // Match by pick_N button ID
  const pickMatch = lower.match(/^pick_(\d+)$/);
  if (pickMatch) {
    const idx = parseInt(pickMatch[1]!);
    return products[idx] || null;
  }

  // Match by number
  const normalized = lower.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  );
  const num = parseInt(normalized);
  if (num >= 1 && num <= products.length) {
    return products[num - 1] || null;
  }

  // Match by title (partial)
  const byTitle = products.find(p =>
    p.title.toLowerCase().includes(lower) || lower.includes(p.title.toLowerCase())
  );
  if (byTitle) return byTitle;

  // Match by keywords in title
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  for (const product of products) {
    const titleLower = product.title.toLowerCase();
    if (words.some(w => titleLower.includes(w))) return product;
  }

  return null;
}

function matchVariant(message: string, variants: { id: string; title: string; price: string; available: boolean }[]): typeof variants[0] | null {
  const lower = message.toLowerCase().trim();

  // Match var_N button ID
  const varMatch = lower.match(/^var_(\d+)$/);
  if (varMatch) {
    const idx = parseInt(varMatch[1]!);
    return variants[idx] || null;
  }

  // Match by title
  return variants.find(v => v.title.toLowerCase().includes(lower)) || null;
}

// ============================================================
// CART & ORDER HISTORY MANAGEMENT
// ============================================================

function addToCart(
  conv: ConversationState,
  product: ShopifyProduct,
  variantId: string | undefined,
  variantTitle: string | undefined,
  price: string
): void {
  conv.data._cart.push({
    productTitle: product.title,
    productId: product.id,
    variantId: variantId || '',
    variantTitle: variantTitle || 'Default Title',
    price
  });
}

function pushCurrentOrderToHistory(conv: ConversationState): void {
  const cart: CartItem[] = conv.data._cart || [];

  // If no cart items but there's a selected product (backwards compat)
  if (cart.length === 0 && conv.data._selectedProduct) {
    cart.push({
      productTitle: conv.data._selectedProduct.title,
      productId: conv.data._selectedProduct.id,
      variantId: conv.data._selectedVariantId || '',
      variantTitle: conv.data._selectedVariantTitle || '',
      price: conv.data._checkout?.totalPrice || conv.data._selectedProduct.priceMin
    });
  }

  if (cart.length > 0) {
    if (!conv.data._orderHistory) conv.data._orderHistory = [];
    conv.data._orderHistory.push({
      items: [...cart],
      totalPrice: conv.data._checkout?.totalPrice || '',
      paymentLink: conv.data._checkout?.url || '',
      timestamp: new Date().toISOString()
    });
  }
}

function resetCurrentOrder(conv: ConversationState): void {
  conv.data._cart = [];
  delete conv.data._selectedProduct;
  delete conv.data._selectedVariantId;
  delete conv.data._selectedVariantTitle;
  delete conv.data._checkout;
  delete conv.data._paymentSelfReported;
  delete conv.data._paymentReportedAt;
  delete conv.data._paymentVerified;
  delete conv.data._selfReportedAt;
  // Preserve: _products, _orderHistory, name
}

async function showCartAndAskMore(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  let msg = '*سلة التسوق:*\n━━━━━━━━━━━━━━━\n';
  let total = 0;
  for (let i = 0; i < cart.length; i++) {
    const item = cart[i]!;
    const itemPrice = parseFloat(item.price);
    total += itemPrice;
    msg += `${i + 1}. ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') {
      msg += ` (${item.variantTitle})`;
    }
    msg += ` — ${formatPrice(item.price, config.currency)}\n`;
  }
  msg += `━━━━━━━━━━━━━━━\n*المجموع: ${formatPrice(total.toFixed(2), config.currency)}*\n\nتبي تضيف منتج ثاني أو تكمل الطلب؟`;

  await sendWhatsAppButtons(
    conv.phone,
    msg,
    [
      { id: 'add_more', title: 'أضف منتج' },
      { id: 'checkout_now', title: 'اطلب الآن' },
      { id: 'remove_item', title: 'حذف منتج' }
    ],
    accessToken,
    client.phone_number_id
  );
}

async function showCartForRemoval(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  if (cart.length === 0) {
    conv.data._shopifyState = 'catalog';
    await showProductCatalog(client, conv, config, accessToken, 'السلة فاضية. تفضل اختر منتج:');
    return;
  }

  if (cart.length <= 3) {
    await sendWhatsAppButtons(
      conv.phone,
      'أي منتج تبي تحذفه؟',
      cart.map((item, i) => ({
        id: `remove_${i}`,
        title: truncate(item.productTitle, 20)
      })),
      accessToken,
      client.phone_number_id
    );
  } else {
    await sendWhatsAppList(
      conv.phone,
      'أي منتج تبي تحذفه؟',
      'اختر',
      cart.map((item, i) => ({
        id: `remove_${i}`,
        title: truncate(item.productTitle, 24)
      })),
      accessToken,
      client.phone_number_id
    );
  }
}

// ============================================================
// CHECKOUT PROCESSING
// ============================================================

async function processCheckout(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];
  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'السلة فاضية، اختر منتج أول.', accessToken, client.phone_number_id);
    conv.data._shopifyState = 'catalog';
    await showProductCatalog(client, conv, config, accessToken, 'اختر منتج:');
    return;
  }

  await sendWhatsAppMessage(conv.phone, 'جاري تجهيز طلبك...', accessToken, client.phone_number_id);

  // Create multi-item checkout
  const lines = cart.map(item => ({ variantId: item.variantId, quantity: 1 }));
  let checkout = await createMultiItemCheckout(config.domain, config.storefrontToken, lines);

  // Fallback: try single-item checkout if only 1 item and multi failed
  if (!checkout && cart.length === 1) {
    checkout = await createCheckout(config.domain, config.storefrontToken, cart[0]!.variantId, 1);
  }

  if (!checkout) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، صار خطأ في إنشاء الطلب. جرب مرة ثانية.', accessToken, client.phone_number_id);
    return;
  }

  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: checkout.totalPrice,
    currency: checkout.currency
  };

  // Build cart summary for payment message
  let cartSummary = '';
  for (const item of cart) {
    cartSummary += `- ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') {
      cartSummary += ` (${item.variantTitle})`;
    }
    cartSummary += '\n';
  }

  const price = formatPrice(checkout.totalPrice, checkout.currency);
  const paymentMsg = `*تفاصيل طلبك:*\n\n${cartSummary}\nالمجموع: ${price}\n\n*ادفع من هنا:*\n${checkout.checkoutUrl}\n\nبعد ما تدفع، اضغط "تم الدفع"`;
  await sendWhatsAppMessage(conv.phone, paymentMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: paymentMsg });

  await sleep(500);

  await sendWhatsAppButtons(
    conv.phone,
    'هل دفعت؟',
    [
      { id: 'paid_yes', title: 'تم الدفع' },
      { id: 'paid_help', title: 'أحتاج مساعدة' }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'awaiting_payment';
}

// ============================================================
// OWNER NOTIFICATION — includes full cart and order history
// ============================================================

async function notifyOwner(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  type: 'paid' | 'help' | 'urgent' | 'unverified',
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];
  const checkout = conv.data._checkout;
  const totalPrice = checkout?.totalPrice || (cart.length > 0 ? cart.reduce((s: number, i: CartItem) => s + parseFloat(i.price), 0).toFixed(2) : '0');
  const price = formatPrice(totalPrice, checkout?.currency || config.currency);
  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  const displayName = conv.data.name || conv.phone;

  // Build cart text
  let cartText = '';
  if (cart.length > 0) {
    cartText = cart.map(i => {
      let line = `📦 ${i.productTitle}`;
      if (i.variantTitle && i.variantTitle !== 'Default Title') line += ` (${i.variantTitle})`;
      line += ` — ${formatPrice(i.price, checkout?.currency || config.currency)}`;
      return line;
    }).join('\n');
  } else if (conv.data._selectedProduct) {
    cartText = `📦 ${conv.data._selectedProduct.title}`;
    if (conv.data._selectedVariantTitle && conv.data._selectedVariantTitle !== 'Default Title') {
      cartText += `\n📏 النوع: ${conv.data._selectedVariantTitle}`;
    }
  }

  // Order history summary
  const history = conv.data._orderHistory || [];
  const historyText = history.length > 0 ? `\n📜 طلبات سابقة: ${history.length}` : '';

  let notification = '';

  if (type === 'paid') {
    notification = `✅ *طلب مدفوع — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 المجموع: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⏰ ${time}`;
  } else if (type === 'unverified') {
    notification = `⏳ *طلب بانتظار التحقق — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 -'}
💰 المجموع: ${price}
🔗 ${checkout?.url || '-'}${historyText}

⚠️ لم يتم التحقق من الدفع بعد
⏰ ${time}`;
  } else if (type === 'help') {
    notification = `⚠️ *عميل يحتاج مساعدة — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '-'}
💰 ${price}${historyText}

⏰ ${time}`;
  } else {
    notification = `🚨 *طلب عاجل — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 آخر طلب: -'}
💰 ${price}${historyText}

آخر رسالة: ${conv.messages[conv.messages.length - 1]?.content || '-'}

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

// ============================================================
// HELP MENU — categorized help options instead of blind handover
// ============================================================

async function showHelpMenu(
  client: any,
  conv: ConversationState,
  accessToken: string
): Promise<void> {
  await sendWhatsAppButtons(
    conv.phone,
    'كيف نقدر نساعدك؟',
    [
      { id: 'help_order_status', title: 'حالة الطلب' },
      { id: 'help_returns', title: 'استرجاع أو تبديل' },
      { id: 'help_agent', title: 'تكلم مع موظف' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// SMART VARIANT TITLE — fits variant + price in WhatsApp button limit
// ============================================================

function smartVariantTitle(variantTitle: string, price: string, currency: string | undefined, max: number): string {
  if (variantTitle === 'Default Title') {
    return truncate(formatPrice(price, currency), max);
  }

  const smartName = smartTitle(variantTitle, max);
  const priceStr = formatPrice(price, currency);
  const full = `${smartName} ${priceStr}`;

  if (full.length <= max) return full;

  // Prioritize price — truncate name to fit
  const availableForName = max - priceStr.length - 1;
  if (availableForName >= 3) {
    return `${truncate(smartName, availableForName)} ${priceStr}`;
  }

  return truncate(full, max);
}

// ============================================================
// SHOW PRODUCT CATALOG — reusable helper, no images
// ============================================================

async function showProductCatalog(
  client: any,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  accessToken: string,
  prompt: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'ما فيه منتجات محفوظة. تواصل مع الدعم.', accessToken, client.phone_number_id);
    return;
  }

  const cart: CartItem[] = conv.data._cart || [];

  // Always use a list so we can fit products + cart actions
  // For ≤3 products with no cart, buttons are fine
  if (products.length <= 3 && cart.length === 0) {
    await sendWhatsAppButtons(
      conv.phone,
      prompt,
      products.map((p, i) => ({ id: `pick_${i}`, title: smartTitle(p.title, 20) })),
      accessToken,
      client.phone_number_id
    );
  } else {
    // Use list — include products and (if cart has items) cart actions
    const listItems = products.map((p, i) => ({ id: `pick_${i}`, title: smartTitle(p.title, 24) }));
    await sendWhatsAppList(
      conv.phone,
      prompt,
      'المنتجات',
      listItems,
      accessToken,
      client.phone_number_id
    );
  }

  // If cart has items, show cart action buttons as a follow-up
  if (cart.length > 0) {
    await sleep(300);
    const cartCount = cart.length;
    const label = cartCount === 1 ? 'منتج واحد' : `${cartCount} منتجات`;
    await sendWhatsAppButtons(
      conv.phone,
      `في السلة: ${label}.`,
      [
        { id: 'view_cart', title: 'عرض السلة' },
        { id: 'checkout_now', title: 'اطلب الآن' }
      ],
      accessToken,
      client.phone_number_id
    );
  }

  conv.data._shopifyState = 'catalog';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
