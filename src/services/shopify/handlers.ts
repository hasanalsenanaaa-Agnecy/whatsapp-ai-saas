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
  sendWhatsAppButtons
} from '../whatsapp.js';
import { normalizeArabicNumbers } from '../../utils/buttons.js';
import { emitEvent } from '../events.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem } from './types.js';
import {
  fetchProductsCached,
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
  markReprompted,
  getOrderByNumber,
  formatOrderStatus
} from './helpers.js';
import {
  showProductView,
  showProductList,
  showProductNames,
  showVariantOrProductView,
  showTopProducts,
  showCart,
  showCartForRemoval,
  askQuantity
} from './display.js';
import { tryAIAnswer } from './ai.js';

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
    await sendWhatsAppMessage(conv.phone, 'عذراً، المتجر غير متاح حالياً.', accessToken, client.phone_number_id);
    return;
  }

  // Initialize cart and order history for new/existing conversations
  if (!conv.data._cart) conv.data._cart = [];
  if (!conv.data._orderHistory) conv.data._orderHistory = [];

  const shopifyState = conv.data._shopifyState || 'welcome';
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // GLOBAL CANCEL — "خلاص", "وقف", "cancel", "restart"
  const cancelWords = ['وقف', 'cancel', 'restart'];
  if (cancelWords.some(w => lower === w)) {
    conv.data._cart = [];
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // GLOBAL HOME — full reset to language selection
  if (trimmed === 'go_home' || lower === 'رئيسية' || lower === 'الرئيسية' || lower === 'home'
    || lower.includes('رجوع للرئيسية') || lower.includes('الرئيسية') || lower.includes('رئيسيه')) {
    delete conv.data._lang;
    delete conv.data._langAsked;
    delete conv.data._intent;
    delete conv.data._intentAsked;
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // BUTTON ID check — buttons always get priority
  const isButtonId = /^(pick_\d+|pick_group_[\d_]+|var_\d+|show_images|pick_direct|add_to_cart|back_to_list|qty_\d+|view_cart|checkout_now|add_more|remove_item|remove_\d+|no_thanks|paid_yes|paid_help|new_order|track_order|contact_us|continue_cart|clear_cart|go_home|lang_ar|lang_en|intent_order|intent_status|intent_cs)$/.test(trimmed);

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
    // Global contact us — works from any state
    if (lower === 'contact_us_global' || lower === 'contact_us') {
      const gcl: string = conv.data._lang || 'ar';
      await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', gcl), accessToken, client.phone_number_id);
      await notifyOwner(client, conv, config, 'help', accessToken);
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
        `أهلاً بك في *${nameAr}*! 🛍️\nWelcome to *${nameEn}*! 🛍️\n\n🌐 اختر لغتك / Choose your language`,
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
        `أهلاً بك في *${nameAr2}*! 🛍️\nWelcome to *${nameEn2}*! 🛍️\n\n🌐 اختر لغتك / Choose your language`,
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

  // STEP 2: Intent menu
  if (!conv.data._intent) {
    if (!conv.data._intentAsked) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'كيف نقدر نساعدك؟ 😊\n\n💡 اكتب *رئيسية* في أي وقت للرجوع لهذه القائمة',
          'How can we help you? 😊\n\n💡 Type *home* anytime to return to this menu',
          l
        ),
        [
          { id: 'intent_order', title: msg('طلب جديد 🛍️', 'New Order 🛍️', l) },
          { id: 'intent_status', title: msg('حالة الطلب 📦', 'Order Status 📦', l) },
          { id: 'intent_cs', title: msg('خدمة العملاء 💬', 'Customer Service 💬', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._intentAsked = true;
      return;
    }
    if (lower === 'intent_order') {
      conv.data._intent = 'new_order';
    } else if (lower === 'intent_status') {
      conv.data._intent = 'order_status';
      conv.data._shopifyState = 'order_status';
      await handleOrderStatus(client, conv, config, message, accessToken);
      return;
    } else if (lower === 'intent_cs') {
      conv.data._intent = 'customer_service';
      conv.data._shopifyState = 'customer_service';
      await handleCustomerService(client, conv, config, message, accessToken);
      return;
    } else {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'كيف نقدر نساعدك؟ 😊\n\n💡 اكتب *رئيسية* في أي وقت للرجوع لهذه القائمة',
          'How can we help you? 😊\n\n💡 Type *home* anytime to return to this menu',
          l
        ),
        [
          { id: 'intent_order', title: msg('طلب جديد 🛍️', 'New Order 🛍️', l) },
          { id: 'intent_status', title: msg('حالة الطلب 📦', 'Order Status 📦', l) },
          { id: 'intent_cs', title: msg('خدمة العملاء 💬', 'Customer Service 💬', l) }
        ],
        accessToken,
        client.phone_number_id
      );
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

  // STEP 5: Fetch products (cached per store+language, 15 min TTL)
  const products = await fetchProductsCached(config.domain, config.storefrontToken, conv.data._lang || 'ar');

  if (products.length === 0) {
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        `أهلاً ${conv.data.name}! عذراً، ما فيه منتجات متوفرة في *${config.storeName}* حالياً.`,
        `Hello ${conv.data.name}! Sorry, no products are available in *${config.storeName}* right now.`,
        l
      ),
      accessToken,
      client.phone_number_id
    );
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
    `${nameGreet}${msg(`كيف تبي تتصفح *${config.storeName}*؟`, `How would you like to browse *${config.storeName}*?`, l)}`,
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

  // "Best of" queries — navigation intent, show top 3 cards (not a text answer)
  const topProducts = getTopProductsByQuery(message, products);
  if (topProducts.length > 0) {
    conv.data._reprompted = null;
    await showTopProducts(client, conv, config, accessToken, topProducts);
    return;
  }

  // If it looks like a question, try AI first so they get a text answer, not a product card
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
  }

  // Pattern-based product navigation (non-question intent: "الأرخص", "الأفضل" as nav, not inquiry)
  const questionMatch = tryAnswerProductQuestion(message, products, config.currency);
  if (questionMatch) {
    conv.data._reprompted = null;
    conv.data._selectedProduct = questionMatch;
    conv.data._browseMode = 'list';
    await showProductView(client, conv, config, accessToken, questionMatch);
    return;
  }

  // Non-question unmatched — try AI as fallback before reprompt/silence
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) return;

  // Reprompt once then silence
  if (shouldSilence(conv)) return;
  const l2: string = conv.data._lang || 'ar';
  const repromptName = conv.data.name ? (l2 === 'en' ? `, ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  await sendWhatsAppButtons(
    conv.phone,
    msg(`كيف تبي تتصفح *${config.storeName}*${repromptName}؟`, `How would you like to browse *${config.storeName}*${repromptName}?`, l2),
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

  // Grouped product selection — show weight buttons
  if (trimmed.startsWith('pick_group_')) {
    const groupIndices: number[] | undefined = conv.data._productGroups?.[trimmed];
    if (groupIndices && groupIndices.length > 0) {
      const groupProducts = groupIndices.map((i: number) => products[i]).filter(Boolean) as ShopifyProduct[];
      const gl: string = conv.data._lang || 'ar';
      const weightExtractG = /(\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb))/i;
      const baseName = groupProducts[0]!.title.replace(/\s*\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb)\s*/i, '').trim();
      const buttons = groupProducts.slice(0, 3).map((p, j) => {
        const wm = p.title.match(weightExtractG);
        const weight = wm ? wm[0].trim() : p.title;
        return { id: `pick_${groupIndices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
      });
      if (buttons.length < 3) buttons.push({ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', gl) });
      await sendWhatsAppButtons(conv.phone, `*${baseName}*\n${msg('اختر الوزن:', 'Choose weight:', gl)}`, buttons, accessToken, client.phone_number_id);
      return;
    }
  }

  // Try direct product name match
  let selected = matchProduct(message, products);

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
    // Variant already selected upstream — go straight to quantity
    const variant = conv.data._selectedVariant || product.variants[0];
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;
    const label = variant?.title && variant.title !== 'Default Title'
      ? `${product.title} — ${variant.title}`
      : product.title;
    await askQuantity(client, conv, config, accessToken, label);
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

  // Unrecognized — reprompt once then silence
  if (shouldSilence(conv)) return;
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
    const vsl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('اختر من الخيارات المتاحة.', 'Please choose from the available options.', vsl), accessToken, client.phone_number_id);
    return;
  }

  conv.data._selectedVariant = variant;
  conv.data._selectedVariantId = variant.id;
  conv.data._selectedVariantTitle = variant.title;
  // Show product view with action buttons now that variant is known
  await showProductView(client, conv, config, accessToken, product);
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
    await sendWhatsAppMessage(conv.phone, msg('اكتب رقم الكمية (مثال: 1، 2، 3)', 'Enter a quantity (e.g. 1, 2, 3)', qtyl), accessToken, client.phone_number_id);
    return;
  }
  if (qty > MAX_QTY) {
    await sendWhatsAppMessage(conv.phone, msg(`الحد الأقصى ${MAX_QTY} قطعة. اكتب كمية أقل.`, `Maximum quantity is ${MAX_QTY}. Please enter a smaller amount.`, qtyl), accessToken, client.phone_number_id);
    return;
  }

  const product: ShopifyProduct = conv.data._selectedProduct;
  if (!product) {
    await showProductList(client, conv, config, accessToken);
    return;
  }
  const variant = conv.data._selectedVariant || product.variants[0];

  // Add to cart with quantity
  addToCart(conv, product, variant?.id, variant?.title, variant?.price || product.priceMin, qty);


  const itemLabel = variant?.title && variant.title !== 'Default Title'
    ? `${product.title} (${variant.title})`
    : product.title;
  const qtyLabel = qty > 1 ? ` x${qty}` : '';

  conv.messages.push({ role: 'assistant', content: `Added ${itemLabel} x${qty} to cart` });

  // Build cart summary to show alongside confirmation
  const cartl: string = conv.data._lang || 'ar';
  const updatedCart: CartItem[] = conv.data._cart || [];
  const cartLines = updatedCart.map(item => {
    const q = item.quantity || 1;
    const linePrice = formatPrice((parseFloat(item.price) * q).toFixed(2), config.currency);
    let line = `• ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') line += ` (${item.variantTitle})`;
    if (q > 1) line += ` x${q}`;
    line += ` — ${linePrice}`;
    return line;
  }).join('\n');
  const cartTotal = formatPrice(updatedCart.reduce((sum, i) => sum + parseFloat(i.price) * (i.quantity || 1), 0).toFixed(2), config.currency);

  const confirmMsg = `✅ ${msg('تمت الإضافة', 'Added', cartl)}: *${itemLabel}*${qtyLabel}\n\n🛒 ${msg('سلتك:', 'Your cart:', cartl)}\n${cartLines}\n\n💰 ${msg('الإجمالي', 'Total', cartl)}: *${cartTotal}*`;

  await sendWhatsAppButtons(
    conv.phone,
    confirmMsg,
    [
      { id: 'add_more', title: msg('تسوق أكثر', 'Shop More', cartl) },
      { id: 'view_cart', title: msg('السلة', 'Cart', cartl) },
      { id: 'checkout_now', title: msg('اطلب الآن', 'Order Now', cartl) }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'cart';
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

  // Add more products — always show list (not image cards again)
  if (lower === 'add_more' || lower === 'تسوق' || lower === 'تسوق أكثر'
    || lower.includes('أضف منتج') || lower.includes('ضيف منتج') || lower.includes('زيد منتج')
    || lower.includes('أضف أكثر') || lower.includes('تسوق أكثر')) {
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
    || lower.includes('ادفع') || lower.includes('أطلب الآن') || lower.includes('أطلب الان')) {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // View cart (re-show)
  if (lower === 'view_cart') {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Try AI answer (product questions mid-cart) before reprompt
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) return;

  // Didn't understand — reprompt once then silence
  if (shouldSilence(conv)) return;
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
  const checkoutUrl = conv.data._checkout?.url;

  // GLOBAL ESCAPE — cancel/waqf at any point resets the order
  const isCancelIntent = ['وقف', 'cancel', 'الغ', 'إلغاء', 'الغاء', 'مو عارف', 'بكره'].some(w => lower.includes(w));
  if (isCancelIntent) {
    const pcl: string = conv.data._lang || 'ar';
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await sendWhatsAppMessage(conv.phone, msg('تم إلغاء الطلب. تقدر تبدأ من جديد في أي وقت.', 'Order cancelled. You can start over anytime.', pcl), accessToken, client.phone_number_id);
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // After self-report: 2h timeout check + limited handling
  if (conv.data._paymentSelfReported) {
    const reportedAt = conv.data._paymentReportedAt ? new Date(conv.data._paymentReportedAt).getTime() : 0;
    const hoursSinceReport = (Date.now() - reportedAt) / (1000 * 60 * 60);

    // 2h passed with no webhook — offer recovery
    if (hoursSinceReport >= 2 && !conv.data._timeoutRecoveryOffered) {
      conv.data._timeoutRecoveryOffered = true;
      const trl: string = conv.data._lang || 'ar';
      await sendWhatsAppButtons(
        conv.phone,
        msg('يبدو إن التحقق تأخر. تبي تطلب من جديد؟', 'Verification seems delayed. Would you like to place a new order?', trl),
        [
          { id: 'new_order', title: msg('طلب جديد', 'New Order', trl) },
          { id: 'contact_us_global', title: msg('تواصل مع فريقنا', 'Contact Us', trl) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', trl) }
        ],
        accessToken,
        client.phone_number_id
      );
      await notifyOwner(client, conv, config, 'urgent', accessToken);
      return;
    }

    // Help button after self-report → same as any other message: notify once then silence
    if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
      conv.data._awaitingHelpMessage = true; // keep for reset cleanup only
      return;
    }

    // New order button from timeout recovery
    if (lower === 'new_order' || lower.includes('طلب جديد')) {
      pushCurrentOrderToHistory(conv);
      resetCurrentOrder(conv);
      conv.data._shopifyState = 'welcome';
      await handleWelcome(client, conv, config, message, accessToken);
      return;
    }

    // Everything else after self-report:
    // First extra message → notify owner once, then complete silence
    if (!conv.data._postReportOwnerNotified) {
      conv.data._postReportOwnerNotified = true;
      await notifyOwner(client, conv, config, 'help', accessToken);
    }
    // Always silence — owner contacts customer directly
    return;
  }

  // Help button → notify owner once + silence
  if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
    if (!conv.data._postReportOwnerNotified) {
      conv.data._postReportOwnerNotified = true;
      await notifyOwner(client, conv, config, 'help', accessToken);
    }
    return;
  }

  // Customer pressed "تم الدفع" → acknowledge, wait for webhook
  const isPaid = lower === 'paid_yes' || lower.includes('تم') || lower.includes('دفعت')
    || lower.includes('done') || lower.includes('paid');

  if (isPaid) {
    conv.data._paymentSelfReported = true;
    conv.data._paymentReportedAt = new Date().toISOString();
    await sendWhatsAppMessage(
      conv.phone,
      msg('شكراً! 🔄 جاري التحقق من دفعتك، بنرسل لك تأكيد خلال لحظات.', 'Thank you! 🔄 Verifying your payment, we\'ll send confirmation shortly.', conv.data._lang || 'ar'),
      accessToken,
      client.phone_number_id
    );
    await notifyOwner(client, conv, config, 'unverified', accessToken);
    return;
  }

  // Unrecognized — re-show payment link once, second time notify owner + silence
  if (conv.data._paymentLinkReshown) {
    await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', conv.data._lang || 'ar'), accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'help', accessToken);
    markReprompted(conv);
    return;
  }
  if (checkoutUrl) {
    const pll: string = conv.data._lang || 'ar';
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `💳 رابط الدفع:\n${checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅\nأو اضغط "تم الدفع" إذا أكملت الشراء`,
        `💳 Payment link:\n${checkoutUrl}\n\nWe'll confirm automatically after payment ✅\nOr press "Payment Done" if you've completed the purchase`,
        pll
      ),
      [
        { id: 'paid_yes', title: msg('تم الدفع ✅', 'Payment Done ✅', pll) },
        { id: 'paid_help', title: msg('أحتاج مساعدة', 'Need Help', pll) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', pll) }
      ],
      accessToken,
      client.phone_number_id
    );
    conv.data._paymentLinkReshown = true;
  }
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

  // Track order → scripted once + notify owner + silence
  if (lower === 'track_order' || lower.includes('تتبع') || lower.includes('وين طلبي') || lower.includes('حالة الطلب')) {
    await sendWhatsAppMessage(conv.phone, 'سيتواصل معك فريقنا قريباً بتحديث طلبك.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    markReprompted(conv);
    return;
  }

  // Contact us / any complaint / cancel → scripted once + notify owner + silence
  if (lower === 'contact_us' || lower.includes('تواصل') || lower.includes('مساعدة') || lower.includes('موظف')
    || lower.includes('استرجاع') || lower.includes('الغ') || lower.includes('مشكلة')
    || lower.includes('تأخر') || lower.includes('ما وصل')) {
    await sendWhatsAppMessage(conv.phone, msg('سيتواصل معك فريقنا قريباً.', 'Our team will contact you shortly.', conv.data._lang || 'ar'), accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
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

  // STEP 1: Ask for order number
  if (!conv.data._osOrderNum) {
    if (!conv.data._osOrderNumAsked) {
      await sendWhatsAppMessage(
        conv.phone,
        msg(
          'أرسل لنا رقم طلبك 📦\n_(مثال: #1042)_',
          'Please send your order number 📦\n_(e.g. #1042)_',
          l
        ),
        accessToken,
        client.phone_number_id
      );
      conv.data._osOrderNumAsked = true;
      return;
    }
    const orderNumMatch = normalizeArabicNumbers(message).match(/#?(\d+)/);
    if (!orderNumMatch) {
      await sendWhatsAppMessage(
        conv.phone,
        msg(
          'ما قدرت أقرأ رقم الطلب. أرسله بهالشكل: #1042',
          'Could not read the order number. Send it like: #1042',
          l
        ),
        accessToken,
        client.phone_number_id
      );
      return;
    }
    conv.data._osOrderNum = orderNumMatch[1];
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
        [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
        accessToken,
        client.phone_number_id
      );
      markReprompted(conv);
      return;
    }
    // Order not found
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `ما قدرنا نجد طلب برقم #${conv.data._osOrderNum}. تأكد من الرقم أو تواصل مع فريقنا.`,
        `We couldn't find order #${conv.data._osOrderNum}. Please verify the number or contact our team.`,
        l
      ),
      [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
      accessToken,
      client.phone_number_id
    );
    markReprompted(conv);
    return;
  }

  // No Admin token — fallback: notify owner manually
  await sendWhatsAppButtons(
    conv.phone,
    msg(
      `شكراً! فريقنا راح يراجع طلبك #${conv.data._osOrderNum} ويتواصل معك قريباً.`,
      `Thank you! Our team will review order #${conv.data._osOrderNum} and contact you shortly.`,
      l
    ),
    [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
    accessToken,
    client.phone_number_id
  );
  await notifyOwner(client, conv, config, 'urgent', accessToken);
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

  // First contact — send acknowledgment once
  if (!conv.data._csAcknowledged) {
    conv.data._csAcknowledged = true;
    conv.data._csStartedAt = new Date().toISOString();
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        `وصل طلبك ✅ فريقنا راح يتواصل معك خلال 30 دقيقة.\n\nإذا عندك تفاصيل إضافية، اكتبها هنا وراح توصل للفريق.`,
        `Your request has been received ✅ Our team will contact you within 30 minutes.\n\nIf you have additional details, write them here and they will be forwarded to our team.`,
        l
      ),
      accessToken,
      client.phone_number_id
    );
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // All subsequent messages — forward silently to owner, no response to customer
  await notifyOwner(client, conv, config, 'help', accessToken);
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

  // Guard against double-tap: if checkout already in progress, ignore
  if (conv.data._checkoutInProgress) return;
  conv.data._checkoutInProgress = true;

  const pcl: string = conv.data._lang || 'ar';
  await sendWhatsAppMessage(conv.phone, msg('جاري تجهيز طلبك...', 'Preparing your order...', pcl), accessToken, client.phone_number_id);

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
    return;
  }

  delete conv.data._checkoutInProgress; // checkout created — no longer needed

  // Calculate cart total from our local cart (source of truth) — with quantities
  const cartTotal = cart.reduce((sum: number, i: CartItem) => sum + parseFloat(i.price) * (i.quantity || 1), 0);
  const cartTotalStr = cartTotal.toFixed(2);

  // Alert owner if Shopify price differs significantly (>1%) — discount, bundle, or currency issue
  if (checkout.totalPrice) {
    const shopifyTotal = parseFloat(checkout.totalPrice);
    const diffPct = Math.abs(shopifyTotal - cartTotal) / cartTotal;
    if (diffPct > 0.01) {
      console.warn(`⚠️ Price mismatch: Shopify=${checkout.totalPrice}, Cart=${cartTotalStr} (${(diffPct * 100).toFixed(1)}%)`);
      await notifyOwner(client, conv, config, 'urgent', accessToken);
    }
  }

  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: cartTotalStr,  // Use cart-calculated total, not Shopify API
    currency: checkout.currency
  };
  emitEvent(client.id, 'checkout_created', conv.phone, { items: cart.length, total: cartTotalStr, currency: checkout.currency });

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

  // Single message: order summary + payment link + confirm button — no split bubbles
  const nameGreet = conv.data.name ? (pcl === 'en' ? ` ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  const paymentMsg = msg(
    `تمام${nameGreet}! هذي تفاصيل طلبك:\n\n${cartSummary}\n*المجموع: ${price}*\n\n💳 رابط الدفع:\n${checkout.checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅\nأو اضغط "تم الدفع" إذا أكملت الشراء`,
    `Great${nameGreet}! Here are your order details:\n\n${cartSummary}\n*Total: ${price}*\n\n💳 Payment link:\n${checkout.checkoutUrl}\n\nAfter payment, we'll confirm automatically ✅\nOr press "Payment Done" if you've completed the purchase`,
    pcl
  );
  await sendWhatsAppButtons(
    conv.phone,
    paymentMsg,
    [
      { id: 'paid_yes', title: msg('تم الدفع ✅', 'Payment Done ✅', pcl) },
      { id: 'paid_help', title: msg('أحتاج مساعدة', 'Need Help', pcl) }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: paymentMsg });

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
  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
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
    const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user')?.content || '-';
    notification = `⚠️ *عميل يحتاج مساعدة — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '-'}
💰 ${price}
🔗 ${checkout?.url || '-'}${historyText}

💬 "${lastUserMsg}"

⏰ ${time}`;
  } else {
    notification = `🚨 *طلب عاجل — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${cartText || '📦 آخر طلب: -'}
💰 ${price}${historyText}

آخر رسالة: ${[...conv.messages].reverse().find(m => m.role === 'user')?.content || '-'}

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
