// ============================================================
// SHOPIFY AI AGENT
// Full e-commerce WhatsApp agent with multi-item cart:
//   Welcome → Browse → Catalog → Product → Cart → Payment → Completion
// Works with tokenless Shopify Storefront API.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
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
import { smartTitle, truncate, normalizeArabicNumbers } from '../utils/buttons.js';

// ============================================================
// MODULE-LEVEL: PRODUCT CACHE + ANTHROPIC CLIENT
// ============================================================

const _productCache = new Map<string, { products: ShopifyProduct[]; fetchedAt: number }>();
const PRODUCT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const _anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
  quantity: number;
}

// ============================================================
// PRODUCT CACHE — fetch once per store, reuse for 15 min
// ============================================================

async function fetchProductsCached(domain: string, storefrontToken?: string): Promise<ShopifyProduct[]> {
  const cached = _productCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return cached.products;
  }
  const products = await fetchProducts(domain, storefrontToken, 10);
  _productCache.set(domain, { products, fetchedAt: Date.now() });
  return products;
}

// ============================================================
// AI QUESTION ANSWERING — bounded, product-scoped
// Max AI_QUESTION_BUDGET answers per session. After budget:
// notify owner + nudge to product list.
// ============================================================

const AI_QUESTION_BUDGET = 2;

function isQuestionMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (lower.includes('؟') || lower.includes('?')) return true;
  const starters = ['وش', 'شو', 'ايش', 'إيش', 'كيف', 'متى', 'وين', 'ليش', 'لش', 'هل',
    'ممكن', 'فيه', 'عندكم', 'عندك', 'تقدر', 'اقدر', 'كم', 'بكم',
    'مبيعا', 'مبيعاً', 'افضل', 'أفضل', 'الافضل', 'ارخص', 'أرخص', 'استفسار'];
  return starters.some(w => lower.startsWith(w) || lower.includes(' ' + w));
}

async function answerWithAI(
  question: string,
  products: ShopifyProduct[],
  storeName: string,
  currency: string | undefined,
  history: { role: string; content: string }[]
): Promise<string | null> {
  if (!_anthropic) return null;

  const productList = products.map(p => {
    const price = formatPrice(p.priceMin, currency);
    const desc = p.description ? p.description.replace(/<[^>]*>/g, '').trim().substring(0, 80) : '';
    return `- ${p.title} (${price})${desc ? ': ' + desc : ''}`;
  }).join('\n');

  const system = `أنت مساعد متجر ${storeName} على واتساب.
أجب على سؤال العميل فقط من معلومات المنتجات المتاحة.
لهجة خليجية قصيرة — جملة أو جملتين كحد أقصى.
لا تقترح الشراء مباشرة ولا تذكر أسعار إلا إذا سأل عنها.
إذا السؤال خارج نطاق المنتجات، قل "ما عندي تفاصيل عن هذا، بس تقدر تتصفح منتجاتنا."

المنتجات:
${productList}`;

  try {
    const recent = history.slice(-6).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    recent.push({ role: 'user', content: question });

    const response = await Promise.race([
      _anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system,
        messages: recent
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000))
    ]);

    const block = (response as any).content?.find((b: any) => b.type === 'text');
    return block?.text?.trim() || null;
  } catch {
    return null;
  }
}

async function tryAIAnswer(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<boolean> {
  if (!isQuestionMessage(message)) return false;

  const count = conv.data._aiAnswerCount || 0;

  if (count >= AI_QUESTION_BUDGET) {
    // Budget exhausted — show CTA every time (not just once) so customer isn't left in silence
    await sendWhatsAppButtons(
      conv.phone,
      'للمزيد من الاستفسارات، فريقنا بخدمتك 👇',
      [
        { id: 'pick_direct', title: 'تصفح المنتجات' },
        { id: 'contact_us_global', title: 'تواصل مع فريقنا' }
      ],
      accessToken,
      client.phone_number_id
    );
    // Notify owner only once
    if (!conv.data._aiExhaustedNotified) {
      conv.data._aiExhaustedNotified = true;
      await notifyOwner(client, conv, config, 'help', accessToken);
    }
    return true;
  }

  const products: ShopifyProduct[] = conv.data._products || [];
  const answer = await answerWithAI(message, products, config.storeName, config.currency, conv.messages);
  if (!answer) return false;

  conv.data._aiAnswerCount = count + 1;
  await sendWhatsAppMessage(conv.phone, answer, accessToken, client.phone_number_id);

  // First answer only — soft CTA to browse
  if (count === 0) {
    await sendWhatsAppButtons(
      conv.phone,
      'تبي تتصفح المنتجات؟',
      [
        { id: 'pick_direct', title: 'قائمة المنتجات' },
        { id: 'show_images', title: 'شوف الصور' }
      ],
      accessToken,
      client.phone_number_id
    );
  }

  return true;
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
  const isButtonId = /^(pick_\d+|var_\d+|show_images|pick_direct|add_to_cart|back_to_list|qty_\d+|view_cart|checkout_now|add_more|remove_item|remove_\d+|no_thanks|paid_yes|paid_help|new_order|track_order|contact_us|continue_cart|clear_cart|go_home)$/.test(trimmed);

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
    // Global contact us — works from any state
    if (lower === 'contact_us_global' || lower === 'contact_us') {
      await sendWhatsAppMessage(conv.phone, 'سيتواصل معك فريقنا قريباً.', accessToken, client.phone_number_id);
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
    // Note: "هلا" removed — it's a valid Saudi female name
    const nameInput = message.trim();
    const nameLower = nameInput.toLowerCase();
    const greetings = ['hi', 'hello', 'مرحبا', 'مرحبه', 'اهلا', 'أهلا', 'سلام', 'هلو', 'السلام', 'هاي', 'مرحبا'];
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
      await sendWhatsAppMessage(conv.phone, 'تم مسح السلة ✓', accessToken, client.phone_number_id);
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

  // STEP 3: Fetch products (cached per store, 15 min TTL)
  const products = await fetchProductsCached(config.domain, config.storefrontToken);

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
    variants: p.variants,
    tags: p.tags,
    compareAtPriceMin: p.compareAtPriceMin
  }));

  // Returning customer greeting (name already known, new order started)
  const isReturning = conv.data._orderHistory?.length > 0;
  const nameGreet = isReturning
    ? `أهلاً مجدداً يا *${conv.data.name}*! 👋\n\n`
    : '';

  // ENTRY — two browse modes
  await sendWhatsAppButtons(
    conv.phone,
    `${nameGreet}كيف تبي تتصفح *${config.storeName}* يا ${conv.data.name}؟`,
    [
      { id: 'show_images', title: 'شوف الصور' },
      { id: 'pick_direct', title: 'قائمة المنتجات' }
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

  // If it looks like a question, try AI first so they get a text answer, not a product card
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken);
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
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken);
  if (aiHandled) return;

  // Reprompt once then silence
  if (shouldSilence(conv)) return;
  const repromptName = conv.data.name ? ` يا ${conv.data.name}` : '';
  await sendWhatsAppButtons(
    conv.phone,
    `كيف تبي تتصفح *${config.storeName}*${repromptName}؟`,
    [
      { id: 'show_images', title: 'شوف الصور' },
      { id: 'pick_direct', title: 'قائمة المنتجات' }
    ],
    accessToken,
    client.phone_number_id
  );
  markReprompted(conv);
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

  let selected = matchProduct(message, products);
  if (!selected) selected = tryAnswerProductQuestion(message, products, config.currency);

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    await showProductNames(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
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

  // Try direct product name match
  let selected = matchProduct(message, products);

  // Try pattern-based question if no direct match
  if (!selected) {
    selected = tryAnswerProductQuestion(message, products, config.currency);
  }

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    await showProductList(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
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

  if (!product) {
    // Stale state (e.g. server restart) — recover by showing product list
    await showProductList(client, conv, config, accessToken);
    return;
  }

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
      conv.data._selectedVariantId = variant?.id;
      conv.data._selectedVariantTitle = variant?.title;
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

  // Unrecognized — reprompt once then silence
  if (shouldSilence(conv)) return;
  await showProductView(client, conv, config, accessToken, product);
  markReprompted(conv);
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
  conv.data._selectedVariantId = variant.id;
  conv.data._selectedVariantTitle = variant.title;
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

  const MAX_QTY = 20;
  if (isNaN(qty) || qty < 1) {
    await sendWhatsAppMessage(conv.phone, 'اكتب رقم الكمية (مثال: 1، 2، 3)', accessToken, client.phone_number_id);
    return;
  }
  if (qty > MAX_QTY) {
    await sendWhatsAppMessage(conv.phone, `الحد الأقصى ${MAX_QTY} قطعة. اكتب كمية أقل.`, accessToken, client.phone_number_id);
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
  if (lower === 'add_more' || lower === 'تسوق' || lower === 'تسوق أكثر'
    || lower.includes('أضف منتج') || lower.includes('ضيف منتج') || lower.includes('زيد منتج')
    || lower.includes('أضف أكثر') || lower.includes('تسوق أكثر')) {
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
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken);
  if (aiHandled) return;

  // Didn't understand — reprompt once then silence
  if (shouldSilence(conv)) return;
  await showCart(client, conv, config, accessToken);
  markReprompted(conv);
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
// STATE: AWAITING_PAYMENT
// Webhook (orders/paid) handles real verification.
// After self-report: escape via cancel, help still works, 2h timeout recovery.
// ============================================================

async function handlePaymentConfirmation(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();
  const checkoutUrl = conv.data._checkout?.url;
  const name = conv.data.name ? ` يا ${conv.data.name}` : '';

  // GLOBAL ESCAPE — cancel/waqf at any point resets the order
  const isCancelIntent = ['وقف', 'cancel', 'الغ', 'إلغاء', 'الغاء', 'مو عارف', 'بكره'].some(w => lower.includes(w));
  if (isCancelIntent) {
    resetCurrentOrder(conv);
    conv.data._shopifyState = 'welcome';
    await sendWhatsAppMessage(conv.phone, `تم إلغاء الطلب${name}. تقدر تبدأ من جديد في أي وقت.`, accessToken, client.phone_number_id);
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
      await sendWhatsAppButtons(
        conv.phone,
        `يبدو إن التحقق تأخر${name}. تبي تطلب من جديد؟`,
        [
          { id: 'new_order', title: 'طلب جديد' },
          { id: 'contact_us_global', title: 'تواصل مع فريقنا' }
        ],
        accessToken,
        client.phone_number_id
      );
      await notifyOwner(client, conv, config, 'urgent', accessToken);
      return;
    }

    // Process help message if they described their problem (must check before help button)
    if (conv.data._awaitingHelpMessage) {
      conv.data._awaitingHelpMessage = false;
      await sendWhatsAppMessage(conv.phone, `سيتواصل معك فريقنا قريباً${name}.`, accessToken, client.phone_number_id);
      await notifyOwner(client, conv, config, 'help', accessToken);
      return;
    }

    // Help still works after self-report
    if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
      await sendWhatsAppMessage(conv.phone, 'وش المشكلة؟', accessToken, client.phone_number_id);
      conv.data._awaitingHelpMessage = true;
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

    // Everything else after self-report — soft reminder once, then silence
    if (!conv.data._postReportReminderSent) {
      conv.data._postReportReminderSent = true;
      await sendWhatsAppMessage(conv.phone, `جاري التحقق من دفعتك${name}، بنرسل لك تأكيد قريباً ✅`, accessToken, client.phone_number_id);
    }
    return;
  }

  // Customer wrote what they need help with → scripted response + notify owner + silence
  if (conv.data._awaitingHelpMessage) {
    conv.data._awaitingHelpMessage = false;
    await sendWhatsAppMessage(conv.phone, `سيتواصل معك فريقنا قريباً${name}.`, accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'help', accessToken);
    markReprompted(conv);
    return;
  }

  // Help button → ask what they need once
  if (lower === 'paid_help' || lower.includes('مساعدة') || lower.includes('موظف')) {
    await sendWhatsAppMessage(conv.phone, 'وش المشكلة؟', accessToken, client.phone_number_id);
    conv.data._awaitingHelpMessage = true;
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
      `شكراً${name}! 🔄 جاري التحقق من دفعتك، بنرسل لك تأكيد خلال لحظات.`,
      accessToken,
      client.phone_number_id
    );
    await notifyOwner(client, conv, config, 'unverified', accessToken);
    return;
  }

  // Unrecognized — re-show payment link once, second time notify owner + silence
  if (conv.data._paymentLinkReshown) {
    await sendWhatsAppMessage(conv.phone, `سيتواصل معك فريقنا قريباً${name}.`, accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'help', accessToken);
    markReprompted(conv);
    return;
  }
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
    conv.data._paymentLinkReshown = true;
  }
}

// ============================================================
// STATE: ORDER_COMPLETE
// Options shown once by webhook. New order resets. Track/contact
// → scripted once + notify owner + silence. Everything else → silence.
// ============================================================

async function handleOrderComplete(
  client: any,
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
    await sendWhatsAppMessage(conv.phone, 'سيتواصل معك فريقنا قريباً.', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    markReprompted(conv);
    return;
  }

  // Gratitude — acknowledge warmly, once
  if ((lower.includes('شكر') || lower.includes('شكراً') || lower.includes('مشكور') || lower.includes('thanks') || lower === '🙏') && !conv.data._gratitudeAcked) {
    conv.data._gratitudeAcked = true;
    const name = conv.data.name ? ` يا ${conv.data.name}` : '';
    await sendWhatsAppMessage(conv.phone, `العفو${name}! 😊 يسعدنا خدمتك دايماً.`, accessToken, client.phone_number_id);
    return;
  }

  // Everything else — silence
}

// ============================================================
// STATE: DONE — Pure silence. New order is the only escape.
// ============================================================

async function handleDone(
  client: any,
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
// SMART AI ANSWERING — answer product questions using knowledge base
// ============================================================

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
  delete conv.data._selectedVariant;
  delete conv.data._selectedVariantId;
  delete conv.data._selectedVariantTitle;
  delete conv.data._checkout;
  delete conv.data._paymentSelfReported;
  delete conv.data._paymentReportedAt;
  delete conv.data._paymentVerified;
  delete conv.data._selfReportedAt;
  delete conv.data._paymentLinkReshown;
  delete conv.data._awaitingHelpMessage;
  delete conv.data._postReportReminderSent;
  delete conv.data._timeoutRecoveryOffered;
  delete conv.data._checkoutInProgress;
  delete conv.data._aiAnswerCount;
  delete conv.data._aiExhaustedNotified;
  delete conv.data._gratitudeAcked;
  conv.data._reprompted = null;
  // Preserve: _products, _orderHistory, name, _nameAsked
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

  // Guard against double-tap: if checkout already in progress, ignore
  if (conv.data._checkoutInProgress) return;
  conv.data._checkoutInProgress = true;

  await sendWhatsAppMessage(conv.phone, 'جاري تجهيز طلبك...', accessToken, client.phone_number_id);

  // Create multi-item checkout with quantities
  const lines = cart.map(item => ({ variantId: item.variantId, quantity: item.quantity || 1 }));
  let checkout = await createMultiItemCheckout(config.domain, config.storefrontToken, lines);

  // Fallback: try single-item checkout if only 1 item and multi failed
  if (!checkout && cart.length === 1) {
    checkout = await createCheckout(config.domain, config.storefrontToken, cart[0]!.variantId, cart[0]!.quantity || 1);
  }

  if (!checkout) {
    conv.data._checkoutInProgress = false; // allow retry
    await sendWhatsAppMessage(conv.phone, 'عذراً، صار خطأ في إنشاء الطلب. جرب مرة ثانية.', accessToken, client.phone_number_id);
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

  // Low stock warning — show if any available variant has quantityAvailable <= 5
  const allVariants = product.variants || [];
  const lowStockVariant = allVariants.find((v: any) => v.available && typeof (v as any).quantityAvailable === 'number' && (v as any).quantityAvailable <= 5 && (v as any).quantityAvailable > 0);
  const lowStockNote = lowStockVariant ? `\n⚠️ متبقي ${(lowStockVariant as any).quantityAvailable} فقط!` : '';

  const bodyText = `*${product.title}*\n${priceRange}${lowStockNote}${cleanDesc ? '\n\n' + cleanDesc : ''}`;

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

// ============================================================
// REPROMPT HELPERS — show once then silence
// ============================================================

function shouldSilence(conv: ConversationState): boolean {
  return conv.data._reprompted === conv.data._shopifyState;
}

function markReprompted(conv: ConversationState): void {
  conv.data._reprompted = conv.data._shopifyState;
}

// ============================================================
// PATTERN-BASED PRODUCT QUESTIONS — no AI, real data only
// Matches intent keywords → returns the best matching product.
// Returns null if we can't answer from data (caller shows list).
// ============================================================

function tryAnswerProductQuestion(
  message: string,
  products: ShopifyProduct[],
  _currency?: string
): ShopifyProduct | null {
  if (products.length === 0) return null;
  const lower = message.toLowerCase().trim();

  // Best seller / best quality — products are pre-sorted BEST_SELLING by Shopify
  if (['أكثر مبيعاً', 'اكثر مبيعا', 'أفضل', 'افضل', 'الأفضل', 'الافضل', 'best'].some(k => lower.includes(k))) {
    return products[0] || null;
  }

  // Cheapest
  if (['أرخص', 'ارخص', 'الأرخص', 'رخيص', 'أقل سعر', 'cheap'].some(k => lower.includes(k))) {
    return [...products].sort((a, b) => parseFloat(a.priceMin) - parseFloat(b.priceMin))[0] || null;
  }

  // Gift — tag-first, fallback to most expensive (premium)
  if (['هدية', 'هديه', 'هدايا', 'gift'].some(k => lower.includes(k))) {
    const tagged = products.filter(p => p.tags?.some(t => ['gift', 'هدية', 'premium'].includes(t.toLowerCase())));
    if (tagged.length > 0) return tagged[0] || null;
    return [...products].sort((a, b) => parseFloat(b.priceMin) - parseFloat(a.priceMin))[0] || null;
  }

  // On sale
  if (['عرض', 'تخفيض', 'خصم', 'sale', 'أوفر', 'اوفر'].some(k => lower.includes(k))) {
    const onSale = products.filter(p => p.compareAtPriceMin !== null);
    return onSale[0] || null;
  }

  // New arrivals
  if (['جديد', 'جديده', 'وصل', 'new'].some(k => lower.includes(k))) {
    const newArrivals = products.filter(p =>
      p.tags?.some(t => ['new', 'new-arrival', 'جديد'].includes(t.toLowerCase()))
    );
    return newArrivals[0] || null;
  }

  return null;
}
