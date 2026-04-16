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
  sendWhatsAppButtonsWithImage,
  sendWhatsAppList
} from './whatsapp.js';
import { createLead as _createLead } from './database.js'; // kept for future use; lead creation on payment is handled by shopify-webhook.ts
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
  assistantLabels?: {          // "ساعدني أختار" button titles — customizable per client
    best: string;              // e.g. "هدية فاخرة" for dates, "الأحدث" for fashion
    cheap: string;             // e.g. "استخدام يومي" for dates, "الأرخص" for general
    type: string;              // e.g. "كل المنتجات"
  };
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
  quantity: number;
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

  // BUTTON ID check — buttons always get priority
  const isButtonId = /^(pick_\d+|var_\d+|show_images|pick_direct|asst_help|add_to_cart|back_to_list|qty_\d+|view_cart|checkout_now|add_more|remove_item|remove_\d+|no_thanks|paid_yes|paid_help|new_order|talk_agent|help_menu|help_order_status|help_returns|help_agent|continue_cart|clear_cart|asst_best|asst_cheap|asst_type|go_home)$/.test(trimmed);

  // GLOBAL NAV — "سلة"/"cart" → cart, "رجوع"/"home" → entry (only if not a button)
  if (!isButtonId && shopifyState !== 'welcome') {
    if (lower === 'go_home' || lower === 'رجوع للرئيسية') {
      conv.data._shopifyState = 'welcome';
      await handleWelcome(client, conv, config, message, accessToken);
      return;
    }
    if ((lower === 'view_cart' || lower === 'سلة' || lower === 'cart') && conv.data._cart.length > 0) {
      conv.data._shopifyState = 'cart';
      await showCart(client, conv, config, accessToken);
      return;
    }
  }

  // AI answering — intercept product questions at browsing/post-sale states
  // 'browse_choice' included so questions at the entry point aren't ignored
  // 'welcome' excluded — that state is used for name collection only
  const aiStates = ['browse_choice', 'catalog', 'image_browse', 'product_view', 'cart', 'cart_add', 'awaiting_payment', 'order_complete', 'done'];
  if (!isButtonId && aiStates.includes(shopifyState) && looksLikeQuestion(message)) {
    const answered = await handleProductQuestion(client, conv, config, message, accessToken);
    if (answered) return;
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
    case 'assistant':
      await handleAssistant(client, conv, config, message, accessToken);
      break;
    default:
      await handleWelcome(client, conv, config, message, accessToken);
  }
}

// ============================================================
// STATE: WELCOME — Name collection → session resume check → entry
// ============================================================

async function handleWelcome(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  // STEP 1: Collect name if not known yet
  if (!conv.data.name) {
    if (!conv.data._nameAsked) {
      await sendWhatsAppMessage(
        conv.phone,
        `أهلاً وسهلاً في *${config.storeName}*! 🛍️\n\nوش اسمك الكريم؟ 😊`,
        accessToken,
        client.phone_number_id
      );
      conv.data._nameAsked = true;
      return;
    }

    // Validate the name they just sent
    const nameInput = message.trim();
    const nameLower = nameInput.toLowerCase();
    const greetings = ['hi', 'hello', 'مرحبا', 'مرحبه', 'اهلا', 'أهلا', 'سلام', 'هلا', 'هلو', 'السلام', 'هاي'];
    if (
      nameInput.length < 2 ||
      /^\d+$/.test(normalizeArabicNumbers(nameLower)) ||
      greetings.includes(nameLower)
    ) {
      await sendWhatsAppMessage(conv.phone, 'وش اسمك الكريم؟ 😊', accessToken, client.phone_number_id);
      return;
    }

    conv.data.name = nameInput;
    // Fall through to cart check / browse entry
  }

  const existingCart: CartItem[] = conv.data._cart || [];
  const lower = message.toLowerCase().trim();

  // STEP 2: Session resume — if cart has items from a previous session, ask to continue
  if (existingCart.length > 0) {
    if (lower === 'continue_cart' || lower === 'اكمل' || lower === 'أكمل') {
      conv.data._shopifyState = 'cart';
      await showCart(client, conv, config, accessToken);
      return;
    }
    if (
      lower === 'clear_cart' || lower === 'لا' || lower.includes('من جديد') ||
      // Browse buttons also clear the cart and start fresh
      lower === 'show_images' || lower === 'pick_direct' || lower === 'asst_help'
    ) {
      conv.data._cart = [];
      resetCurrentOrder(conv);
      // Fall through to browse entry
    } else {
      // First time hitting welcome with existing cart — show what's in it, ask to continue
      let cartLines = existingCart.map(item => {
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
        `أهلاً ${conv.data.name}! 👋\n\nعندك في سلتك:\n${cartLines}\n\nتبي تكمل طلبك؟`,
        [
          { id: 'continue_cart', title: 'أكمل الطلب' },
          { id: 'clear_cart', title: 'لا، من جديد' }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  // STEP 3: Fetch products
  const products = await fetchProducts(config.domain, config.storefrontToken, 10);

  if (products.length === 0) {
    await sendWhatsAppMessage(
      conv.phone,
      `أهلاً ${conv.data.name}! عذراً، ما فيه منتجات متوفرة في *${config.storeName}* حالياً.`,
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
    variants: p.variants
  }));

  // ENTRY — three clear ways to browse
  await sendWhatsAppButtons(
    conv.phone,
    `كيف تبي تتصفح *${config.storeName}*؟`,
    [
      { id: 'show_images', title: 'شوف الصور' },
      { id: 'pick_direct', title: 'قائمة المنتجات' },
      { id: 'asst_help', title: 'ساعدني أختار' }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'browse_choice';
}

// ============================================================
// STATE: BROWSE_CHOICE — ENTRY: images or direct list
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

  if (lower === 'show_images' || lower.includes('صور') || lower.includes('شوف')) {
    await showProductNames(client, conv, config, accessToken);
    conv.data._shopifyState = 'image_browse';
    return;
  }

  if (lower === 'pick_direct' || lower.includes('مباشرة') || lower.includes('قائمة') || lower.includes('اختر')) {
    await showProductList(client, conv, config, accessToken);
    conv.data._shopifyState = 'catalog';
    return;
  }

  if (lower === 'asst_help' || lower.includes('ساعدني') || lower.includes('مساعد')) {
    conv.data._shopifyState = 'assistant';
    await handleAssistant(client, conv, config, message, accessToken);
    return;
  }

  // Maybe they typed a product name — try matching
  const matched = matchProduct(message, products);
  if (matched) {
    conv.data._selectedProduct = matched;
    await showProductView(client, conv, config, accessToken, matched);
    return;
  }

  // Re-show entry
  await sendWhatsAppButtons(
    conv.phone,
    `كيف تبي تتصفح *${config.storeName}*؟`,
    [
      { id: 'show_images', title: 'شوف الصور' },
      { id: 'pick_direct', title: 'قائمة المنتجات' },
      { id: 'asst_help', title: 'ساعدني أختار' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// STATE: IMAGE_BROWSE — Show product names, user picks → product view with image
// ============================================================

async function handleImageBrowse(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  const selected = matchProduct(message, products);

  if (!selected) {
    await sendWhatsAppMessage(conv.phone, 'ما عرفت هذا المنتج. اختر من القائمة:', accessToken, client.phone_number_id);
    await showProductNames(client, conv, config, accessToken);
    return;
  }

  conv.data._selectedProduct = selected;
  await showProductView(client, conv, config, accessToken, selected);
}

// ============================================================
// STATE: CATALOG (LIST MODE) — Customer picks product → product view
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

  const selected = matchProduct(message, products);

  if (!selected) {
    await sendWhatsAppMessage(conv.phone, 'ما فهمت اختيارك. اختر من القائمة أو اكتب اسم المنتج.', accessToken, client.phone_number_id);
    return;
  }

  // Go to PRODUCT VIEW — show product with image + action buttons
  conv.data._selectedProduct = selected;
  await showProductView(client, conv, config, accessToken, selected);
}

// ============================================================
// STATE: PRODUCT_VIEW — Show product image + action buttons
// ============================================================

async function handleProductView(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const trimmed = message.trim();
  const product: ShopifyProduct = conv.data._selectedProduct;

  if (trimmed === 'add_to_cart') {
    // Check if product has multiple variants
    const availableVariants = product.variants.filter((v: any) => v.available);
    if (availableVariants.length > 1 && availableVariants.some((v: any) => v.title !== 'Default Title')) {
      // Use buttons for ≤3 variants, list for 4+ (prevents silent truncation)
      if (availableVariants.length <= 3) {
        await sendWhatsAppButtons(
          conv.phone,
          `*${product.title}*\nاختر النوع:`,
          availableVariants.map((v: any, i: number) => ({
            id: `var_${i}`,
            title: smartVariantTitle(v.title, v.price, config.currency, 20)
          })),
          accessToken,
          client.phone_number_id
        );
      } else {
        await sendWhatsAppList(
          conv.phone,
          `*${product.title}*\nاختر النوع:`,
          'الأنواع',
          availableVariants.slice(0, 10).map((v: any, i: number) => ({
            id: `var_${i}`,
            title: smartVariantTitle(v.title, v.price, config.currency, 24)
          })),
          accessToken,
          client.phone_number_id
        );
      }
      conv.data._shopifyState = 'variant_select';
    } else {
      // Single variant — go to quantity selection
      const variant = availableVariants[0] || product.variants[0];
      conv.data._selectedVariant = variant;
      await askQuantity(client, conv, config, accessToken, product.title);
    }
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

  // Unrecognized — re-show product view
  await showProductView(client, conv, config, accessToken, product);
}

// ============================================================
// STATE: VARIANT_SELECT — Pick variant, then go to quantity
// ============================================================

async function handleVariantSelect(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const product: ShopifyProduct = conv.data._selectedProduct;
  const availableVariants = product.variants.filter((v: any) => v.available);

  const variant = matchVariant(message, availableVariants);
  if (!variant) {
    await sendWhatsAppMessage(conv.phone, 'اختر من الخيارات المتاحة.', accessToken, client.phone_number_id);
    return;
  }

  conv.data._selectedVariant = variant;
  const label = variant.title !== 'Default Title'
    ? `${product.title} — ${variant.title}`
    : product.title;
  await askQuantity(client, conv, config, accessToken, label);
}

// ============================================================
// STATE: QUANTITY_SELECT — How many?
// ============================================================

async function handleQuantitySelect(
  client: any,
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

  if (isNaN(qty) || qty < 1 || qty > 99) {
    await sendWhatsAppMessage(conv.phone, 'اكتب رقم الكمية (مثال: 1، 2، 3)', accessToken, client.phone_number_id);
    return;
  }

  const product: ShopifyProduct = conv.data._selectedProduct;
  const variant = conv.data._selectedVariant || product.variants[0];

  // Add to cart with quantity
  addToCart(conv, product, variant?.id, variant?.title, variant?.price || product.priceMin, qty);

  const unitPrice = parseFloat(variant?.price || product.priceMin);
  const lineTotal = formatPrice((unitPrice * qty).toFixed(2), config.currency);
  const itemLabel = variant?.title && variant.title !== 'Default Title'
    ? `${product.title} (${variant.title})`
    : product.title;
  const qtyLabel = qty > 1 ? ` x${qty}` : '';

  conv.messages.push({ role: 'assistant', content: `Added ${itemLabel} x${qty} to cart` });

  // Show line total (not unit price) so customer knows exactly what they're committing to
  await sendWhatsAppButtons(
    conv.phone,
    `تمت الإضافة: *${itemLabel}*${qtyLabel} — ${lineTotal}`,
    [
      { id: 'add_more', title: 'تسوق أكثر' },
      { id: 'view_cart', title: 'السلة' },
      { id: 'checkout_now', title: 'اطلب الآن' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'cart';
}

// ============================================================
// STATE: CART — View cart, add more, remove, checkout
// ============================================================

async function handleCart(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Add more products
  if (lower === 'add_more' || lower.includes('أضف') || lower.includes('ضيف') || lower.includes('زيد') || lower.includes('تسوق')) {
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

  // Remove a product
  if (lower === 'remove_item' || lower.includes('حذف') || lower.includes('شيل') || lower.includes('أزل')) {
    conv.data._shopifyState = 'cart_remove';
    await showCartForRemoval(client, conv, config, accessToken);
    return;
  }

  // Checkout — only explicit payment/order words, no ambiguous ones like "تمام" or "خلاص"
  if (lower === 'checkout_now' || lower.includes('اطلب الآن') || lower.includes('اطلب الان')
    || lower.includes('ادفع') || lower.includes('أطلب الآن') || lower.includes('أطلب الان')) {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // View cart (re-show)
  if (lower === 'view_cart') {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Didn't understand — re-show cart
  await showCart(client, conv, config, accessToken);
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
      await sendWhatsAppMessage(conv.phone, 'السلة فاضية.', accessToken, client.phone_number_id);
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
// STATE: AWAITING_PAYMENT — Customer in payment flow
// Verification is done by Shopify webhook (orders/paid).
// Self-report ("تم الدفع") only triggers an acknowledgement —
// the webhook fires the actual completion.
// ============================================================

async function handlePaymentConfirmation(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // STEP 1: Customer already wrote what they need help with — respond and notify owner
  if (conv.data._awaitingHelpMessage) {
    conv.data._awaitingHelpMessage = false;

    const checkoutUrl = conv.data._checkout?.url;
    const cart: CartItem[] = conv.data._cart || [];
    const name = conv.data.name || '';

    let helpResponse = `لا تشيل هم ${name}! 👋\nأحد فريقنا بيتواصل معك خلال دقائق.`;
    // Only show payment link if cart exists and checkout was already created
    if (cart.length > 0 && checkoutUrl) {
      helpResponse += `\n\nإذا تبي تكمل الدفع بنفسك:\n💳 ${checkoutUrl}`;
    }

    await sendWhatsAppMessage(conv.phone, helpResponse, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: helpResponse });
    // Notify owner — last message in conv.messages is their help description
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // STEP 2: Help button tapped — ask what they need before responding
  if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
    const askMsg = 'وش تحتاج مساعدة فيه؟ 😊';
    await sendWhatsAppMessage(conv.phone, askMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: askMsg });
    conv.data._awaitingHelpMessage = true;
    return;
  }

  // STEP 3: Already self-reported — hold state until webhook fires
  if (conv.data._paymentSelfReported) {
    await sendWhatsAppMessage(
      conv.phone,
      'جاري التحقق من دفعتك، بنرسل لك تأكيد قريباً. 🔄',
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // STEP 4: Customer pressed "تم الدفع" or typed a confirmation
  const isPaid = lower === 'paid_yes' || lower.includes('تم') || lower.includes('دفعت')
    || lower.includes('تأكيد') || lower.includes('done') || lower.includes('paid');

  if (isPaid) {
    // Acknowledge — do NOT complete the order yet. Webhook handles completion.
    conv.data._paymentSelfReported = true;
    conv.data._paymentReportedAt = new Date().toISOString();

    const name = conv.data.name ? ` يا ${conv.data.name}` : '';
    const ackMsg = `شكراً${name}! 🔄\nجاري التحقق من دفعتك، بنرسل لك تأكيد خلال لحظات.`;
    await sendWhatsAppMessage(conv.phone, ackMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: ackMsg });

    // Notify owner as unverified — webhook will send the verified notification
    await notifyOwner(client, conv, config, 'unverified', accessToken);

    // State stays as 'awaiting_payment' — webhook fires the completion
    console.log(`⏳ Shopify payment self-reported (awaiting webhook): ${conv.phone}`);
    return;
  }

  // STEP 5: Anything else — re-show payment link
  const checkoutUrl = conv.data._checkout?.url;
  if (checkoutUrl) {
    await sendWhatsAppButtons(
      conv.phone,
      `💳 رابط الدفع:\n${checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅\nأو اضغط "تم الدفع" إذا أكملت الشراء`,
      [
        { id: 'paid_yes', title: 'تم الدفع ✅' },
        { id: 'paid_help', title: 'أحتاج مساعدة' }
      ],
      accessToken,
      client.phone_number_id
    );
  }
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
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // NLP: if user mentions a product name, show that product
  const products: ShopifyProduct[] = conv.data._products || [];
  const matched = matchProduct(message, products);
  if (matched) {
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._selectedProduct = matched;
    await showProductView(client, conv, config, accessToken, matched);
    return;
  }

  // No thanks / goodbye
  const goodbyes = ['لا شكر', 'باي', 'مع السلامة', 'خلاص', 'عفوا', 'عفواً', 'العفو',
    'شكراً', 'شكرا', 'تسلم', 'سلام', 'مشكور', 'يعطيك العافية', 'bye', 'thanks'];
  if (lower === 'no_thanks' || goodbyes.some(k => lower.includes(k))) {
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

  // Help category text (typed or button)
  if (lower === 'help_order_status' || lower.includes('حالة الطلب') || lower.includes('وين طلبي') || lower.includes('تتبع')) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بتحديث قريب.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_returns' || lower.includes('استرجاع') || lower.includes('تبديل') || lower.includes('ارجاع')) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بخصوص الاسترجاع.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_agent' || lower.includes('تكلم مع موظف') || lower.includes('كلم موظف')) {
    await sendWhatsAppMessage(conv.phone, 'فريقنا بيتواصل معك خلال دقائق.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // Urgent — cancel, complaint, delay
  const urgentKeywords = ['الغ', 'الغاء', 'ألغي', 'مشكلة', 'شكوى', 'تاخر', 'تأخر', 'ما وصل', 'لم يصل'];
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
    || lower.includes('أبي أطلب') || lower.includes('تصفح')) {
    conv.data._doneInteractions = 0;
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await handleWelcome(client, conv, config, message, accessToken);
    return;
  }

  // NLP: if user mentions a product name, show that product
  const products: ShopifyProduct[] = conv.data._products || [];
  const matched = matchProduct(message, products);
  if (matched) {
    conv.data._doneInteractions = 0;
    pushCurrentOrderToHistory(conv);
    resetCurrentOrder(conv);
    conv.data._selectedProduct = matched;
    await showProductView(client, conv, config, accessToken, matched);
    return;
  }

  // Goodbye — recognize polite Arabic closings
  const goodbyeKeywords = ['لا شكر', 'لا اب', 'لا أب', 'باي', 'مع السلامة', 'خلاص',
    'تسلم', 'سلام', 'حياك', 'الله يسلمك', 'شكراً', 'شكرا', 'مشكور', 'يعطيك العافية',
    'عفوا', 'عفواً', 'العفو', 'تحياتي', 'الله يحفظك',
    'no', 'bye', 'thanks', 'thank you'];
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

  // Help category buttons (ID or typed text)
  if (lower === 'help_order_status' || lower.includes('حالة الطلب') || lower.includes('وين طلبي') || lower.includes('تتبع')) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بتحديث قريب.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_returns' || lower.includes('استرجاع') || lower.includes('تبديل') || lower.includes('ارجاع')) {
    await sendWhatsAppMessage(conv.phone, 'تم تسجيل طلبك. فريقنا بيتواصل معك بخصوص الاسترجاع.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }
  if (lower === 'help_agent' || lower.includes('تكلم مع موظف') || lower.includes('كلم موظف')) {
    await sendWhatsAppMessage(conv.phone, 'فريقنا بيتواصل معك خلال دقائق.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // Urgent keywords — forward to agent
  const urgentKeywords = ['الغ', 'الغاء', 'مشكلة', 'شكوى', 'تاخر', 'تأخر', 'ما وصل', 'لم يصل'];
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
  // Products come pre-sorted by BEST_SELLING from Shopify — index 0 is the actual best seller
  const productKB = products.map((p, index) => {
    let answer = `${p.title} — السعر: ${formatPrice(p.priceMin, config.currency)}`;
    if (p.priceMax && p.priceMax !== p.priceMin) {
      answer += ` إلى ${formatPrice(p.priceMax, config.currency)}`;
    }

    // Sale price — real data, not guessed
    if (p.compareAtPriceMin) {
      answer += ` (كان ${formatPrice(p.compareAtPriceMin, config.currency)})`;
    }

    // Best-seller rank — first product = actual best seller per Shopify order data
    if (index === 0) {
      answer += '\n★ الأكثر مبيعاً في المتجر (بيانات حقيقية من المبيعات)';
    } else if (index === 1) {
      answer += '\n★ ثاني أكثر المنتجات مبيعاً';
    }

    // Merchant-set tags — facts the merchant explicitly chose
    if (p.tags && p.tags.length > 0) {
      const tagMap: Record<string, string> = {
        'best-seller': 'الأكثر مبيعاً',
        'bestseller': 'الأكثر مبيعاً',
        'new': 'وصل حديثاً',
        'new-arrival': 'وصل حديثاً',
        'gift': 'مناسب كهدية',
        'هدية': 'مناسب كهدية',
        'daily': 'للاستخدام اليومي',
        'limited': 'كميات محدودة',
        'sale': 'عرض خاص',
        'premium': 'فاخر',
        'seasonal': 'موسمي'
      };
      const mappedTags = p.tags
        .map(t => tagMap[t.toLowerCase()] || tagMap[t] || null)
        .filter(Boolean);
      if (mappedTags.length > 0) {
        answer += `\nالخصائص: ${mappedTags.join('، ')}`;
      }
    }

    // Available variants with prices
    const availableVariants = p.variants?.filter((v: any) => v.available && v.title !== 'Default Title') || [];
    if (availableVariants.length > 0) {
      answer += `\nالأنواع المتوفرة: ${availableVariants.map((v: any) => {
        let vLabel = `${v.title} (${formatPrice(v.price, config.currency)}`;
        if (v.compareAtPrice) vLabel += ` — كان ${formatPrice(v.compareAtPrice, config.currency)}`;
        vLabel += ')';
        return vLabel;
      }).join('، ')}`;
    }

    // Description — strip HTML
    if (p.description) {
      const cleanDesc = p.description.replace(/<[^>]*>/g, '').trim();
      if (cleanDesc.length > 0) {
        answer += `\nالوصف: ${cleanDesc.substring(0, 200)}`;
      }
    }

    return { category: 'منتجات', question: p.title, answer };
  });
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

    // Always follow up with context-appropriate buttons so the user isn't left in silence
    await sleep(300);
    const state = conv.data._shopifyState;
    if (state === 'done' || state === 'order_complete') {
      await sendWhatsAppButtons(
        conv.phone,
        'تبي تطلب شي؟',
        [
          { id: 'new_order', title: 'طلب جديد' },
          { id: 'help_menu', title: 'مساعدة' }
        ],
        accessToken,
        client.phone_number_id
      );
    } else if (state === 'product_view' && conv.data._selectedProduct) {
      // Re-show the product so they can act on it
      await showProductView(client, conv, config, accessToken, conv.data._selectedProduct);
    } else if (state === 'cart' || state === 'cart_add') {
      await showCart(client, conv, config, accessToken);
    } else {
      // catalog, image_browse, browse_choice — re-show the product list
      const browseMode = conv.data._browseMode || 'list';
      if (browseMode === 'image') {
        await showProductNames(client, conv, config, accessToken);
      } else {
        await showProductList(client, conv, config, accessToken);
      }
    }

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
    currency: client.settings?.currency || 'KWD',
    assistantLabels: client.settings?.assistant_labels || {
      best: 'الأفضل',
      cheap: 'الأرخص',
      type: 'كل المنتجات'
    }
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
  price: string,
  quantity = 1
): void {
  conv.data._cart.push({
    productTitle: product.title,
    productId: product.id,
    variantId: variantId || '',
    variantTitle: variantTitle || 'Default Title',
    price,
    quantity
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
      price: conv.data._checkout?.totalPrice || conv.data._selectedProduct.priceMin,
      quantity: 1
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

async function showCart(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'السلة فاضية.', accessToken, client.phone_number_id);
    conv.data._shopifyState = 'browse_choice';
    return;
  }

  let msg = '*سلة التسوق:*\n━━━━━━━━━━━━━━━\n';
  let total = 0;
  for (let i = 0; i < cart.length; i++) {
    const item = cart[i]!;
    const qty = item.quantity || 1;
    const lineTotal = parseFloat(item.price) * qty;
    total += lineTotal;
    msg += `${i + 1}. ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') {
      msg += ` (${item.variantTitle})`;
    }
    if (qty > 1) msg += ` x${qty}`;
    msg += ` — ${formatPrice(lineTotal.toFixed(2), config.currency)}\n`;
  }
  msg += `━━━━━━━━━━━━━━━\n*المجموع: ${formatPrice(total.toFixed(2), config.currency)}*`;

  await sendWhatsAppButtons(
    conv.phone,
    msg,
    [
      { id: 'checkout_now', title: 'اطلب الآن ✅' },
      { id: 'add_more', title: 'أضف منتج' },
      { id: 'remove_item', title: 'حذف منتج' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'cart';
}

async function showCartForRemoval(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'السلة فاضية.', accessToken, client.phone_number_id);
    await showProductList(client, conv, config, accessToken);
    return;
  }

  if (cart.length <= 2) {
    // Buttons: up to 2 items + a back button
    await sendWhatsAppButtons(
      conv.phone,
      'أي منتج تبي تحذفه؟',
      [
        ...cart.map((item, i) => ({
          id: `remove_${i}`,
          title: truncate(item.productTitle, 20)
        })),
        { id: 'view_cart', title: 'رجوع للسلة' }
      ],
      accessToken,
      client.phone_number_id
    );
  } else {
    // List for 3+ items — add back option as a separate message after
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
    await sendWhatsAppMessage(
      conv.phone,
      'أو أرسل "رجوع" للإلغاء.',
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
    await showProductList(client, conv, config, accessToken);
    return;
  }

  await sendWhatsAppMessage(conv.phone, 'جاري تجهيز طلبك...', accessToken, client.phone_number_id);

  // Create multi-item checkout with quantities
  const lines = cart.map(item => ({ variantId: item.variantId, quantity: item.quantity || 1 }));
  let checkout = await createMultiItemCheckout(config.domain, config.storefrontToken, lines);

  // Fallback: try single-item checkout if only 1 item and multi failed
  if (!checkout && cart.length === 1) {
    checkout = await createCheckout(config.domain, config.storefrontToken, cart[0]!.variantId, cart[0]!.quantity || 1);
  }

  if (!checkout) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، صار خطأ في إنشاء الطلب. جرب مرة ثانية.', accessToken, client.phone_number_id);
    return;
  }

  // Calculate cart total from our local cart (source of truth) — with quantities
  const cartTotal = cart.reduce((sum: number, i: CartItem) => sum + parseFloat(i.price) * (i.quantity || 1), 0);
  const cartTotalStr = cartTotal.toFixed(2);

  // Log if Shopify API total differs from our cart total
  if (checkout.totalPrice && Math.abs(parseFloat(checkout.totalPrice) - cartTotal) > 0.01) {
    console.warn(`⚠️ Price mismatch: Shopify API=${checkout.totalPrice}, Cart calculated=${cartTotalStr} (using cart total)`);
  }

  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: cartTotalStr,  // Use cart-calculated total, not Shopify API
    currency: checkout.currency
  };

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
  const nameGreet = conv.data.name ? ` يا ${conv.data.name}` : '';
  const paymentMsg = `تمام${nameGreet}! هذي تفاصيل طلبك:\n\n${cartSummary}\n*المجموع: ${price}*\n\n💳 رابط الدفع:\n${checkout.checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅\nأو اضغط "تم الدفع" إذا أكملت الشراء`;
  await sendWhatsAppButtons(
    conv.phone,
    paymentMsg,
    [
      { id: 'paid_yes', title: 'تم الدفع ✅' },
      { id: 'paid_help', title: 'أحتاج مساعدة' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.messages.push({ role: 'assistant', content: paymentMsg });

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
// PRODUCT VIEW — show product with image + action buttons
// ============================================================

async function showProductView(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string,
  product: ShopifyProduct
): Promise<void> {
  conv.data._selectedProduct = product;

  const price = formatPrice(product.priceMin, config.currency);
  const priceRange = product.priceMax && product.priceMax !== product.priceMin
    ? `${price} — ${formatPrice(product.priceMax, config.currency)}`
    : price;

  // Show title, price, and a short description so the customer can make a decision
  const cleanDesc = product.description
    ? product.description.replace(/<[^>]*>/g, '').trim().substring(0, 200)
    : '';
  const bodyText = `*${product.title}*\n${priceRange}${cleanDesc ? '\n\n' + cleanDesc : ''}`;

  // Check if product is already in cart — show cart shortcut if so
  const cart: CartItem[] = conv.data._cart || [];
  const inCart = cart.some(i => i.productId === product.id);
  const buttons: { id: string; title: string }[] = [
    { id: 'add_to_cart', title: 'أضف للسلة' },
    { id: 'back_to_list', title: 'رجوع' }
  ];
  if (inCart) {
    buttons.push({ id: 'view_cart', title: 'السلة' });
  }

  if (product.imageUrl) {
    await sendWhatsAppButtonsWithImage(
      conv.phone,
      product.imageUrl,
      bodyText,
      buttons,
      accessToken,
      client.phone_number_id
    );
  } else {
    await sendWhatsAppButtons(
      conv.phone,
      bodyText,
      buttons,
      accessToken,
      client.phone_number_id
    );
  }

  conv.data._shopifyState = 'product_view';
}

// ============================================================
// PRODUCT LIST (LIST MODE) — name + price
// ============================================================

async function showProductList(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'ما فيه منتجات متوفرة.', accessToken, client.phone_number_id);
    return;
  }

  conv.data._browseMode = 'list';

  // Extract weight/size from product title (e.g. "تمر سكري 500g" → weight: "500g")
  // Show: short name as title, weight + price as description
  const weightRegex = /(\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb))/i;
  const listItems = products.map((p, i) => {
    const weightMatch = p.title.match(weightRegex);
    const weight = weightMatch ? weightMatch[0].trim() : null;
    const shortTitle = weight ? p.title.replace(weightMatch![0], '').trim() : p.title;
    const description = [weight, formatPrice(p.priceMin, config.currency)]
      .filter(Boolean).join(' — ');
    return {
      id: `pick_${i}`,
      title: smartTitle(shortTitle, 24),
      description
    };
  });

  // Use sendWhatsAppList — products fit in a single list
  await sendWhatsAppList(
    conv.phone,
    'اختر المنتج اللي تبيه:',
    'المنتجات',
    listItems,
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'catalog';
}

// ============================================================
// PRODUCT NAMES (IMAGE MODE) — names only, no prices
// ============================================================

async function showProductNames(
  client: any,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'ما فيه منتجات متوفرة.', accessToken, client.phone_number_id);
    return;
  }

  conv.data._browseMode = 'image';

  const listItems = products.map((p, i) => ({
    id: `pick_${i}`,
    title: smartTitle(p.title, 24)
  }));

  await sendWhatsAppList(
    conv.phone,
    'اختر منتج عشان تشوف صورته:',
    'المنتجات',
    listItems,
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'image_browse';
}

// ============================================================
// QUANTITY ASK — buttons 1, 2, 3
// ============================================================

async function askQuantity(
  client: any,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  accessToken: string,
  productLabel: string
): Promise<void> {
  await sendWhatsAppButtons(
    conv.phone,
    `*${productLabel}*\n\nكم الكمية؟\n_(أو اكتب أي رقم)_`,
    [
      { id: 'qty_1', title: '1' },
      { id: 'qty_2', title: '2' },
      { id: 'qty_3', title: '3' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'quantity_select';
}

// ============================================================
// ASSISTANT MODE — Best, Cheapest, By type
// ============================================================

async function handleAssistant(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const products: ShopifyProduct[] = conv.data._products || [];

  if (lower === 'asst_cheap' || lower.includes('أرخص') || lower.includes('رخيص') || lower.includes('cheap')) {
    // Find cheapest
    const sorted = [...products].sort((a, b) => parseFloat(a.priceMin) - parseFloat(b.priceMin));
    const cheapest = sorted[0];
    if (cheapest) {
      conv.data._selectedProduct = cheapest;
      await showProductView(client, conv, config, accessToken, cheapest);
      return;
    }
  }

  if (lower === 'asst_best' || lower.includes('أفضل') || lower.includes('افضل') || lower.includes('best')) {
    // Show most expensive as "premium" — or use AI
    const sorted = [...products].sort((a, b) => parseFloat(b.priceMin) - parseFloat(a.priceMin));
    const best = sorted[0];
    if (best) {
      conv.data._selectedProduct = best;
      await showProductView(client, conv, config, accessToken, best);
      return;
    }
  }

  if (lower === 'asst_type' || lower.includes('نوع') || lower.includes('type')) {
    // Show all products as list
    await showProductList(client, conv, config, accessToken);
    return;
  }

  // Default — show assistant menu using client-configured labels
  const labels = config.assistantLabels || { best: 'الأفضل', cheap: 'الأرخص', type: 'كل المنتجات' };
  await sendWhatsAppButtons(
    conv.phone,
    'كيف أساعدك تختار؟',
    [
      { id: 'asst_best', title: labels.best },
      { id: 'asst_cheap', title: labels.cheap },
      { id: 'asst_type', title: labels.type }
    ],
    accessToken,
    client.phone_number_id
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
