// ============================================================
// SHOPIFY AGENT — Utility functions (no WhatsApp messaging)
// ============================================================

import {
  fetchProducts,
  fetchProductsOrThrow,
  formatPrice,
  type ShopifyProduct
} from '../shopify.js';
import { smartTitle, truncate } from '../../utils/buttons.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem, type ShopifyAdminOrder } from './types.js';

// ============================================================
// PRODUCT CACHE — fetch once per store, reuse for 15 min
// ============================================================

const _productCache = new Map<string, { products: ShopifyProduct[]; fetchedAt: number }>();
const PRODUCT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function fetchProductsCached(domain: string, storefrontToken?: string, lang = 'ar'): Promise<ShopifyProduct[]> {
  const cacheKey = `${domain}_${lang}`;
  const cached = _productCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return cached.products;
  }
  const products = await fetchProducts(domain, storefrontToken, 10, lang);
  _productCache.set(cacheKey, { products, fetchedAt: Date.now() });
  return products;
}

// Variant that distinguishes "Shopify unreachable" from "store genuinely
// empty". `fetchProducts` catches errors and returns []; for the welcome
// greeting we want to show a retry message on API failure but the normal
// "no products" greeting when the catalog is truly empty (fgf.md #46).
export async function fetchProductsWithStatus(
  domain: string,
  storefrontToken?: string,
  lang = 'ar'
): Promise<{ products: ShopifyProduct[]; apiError: boolean }> {
  const cacheKey = `${domain}_${lang}`;
  const cached = _productCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return { products: cached.products, apiError: false };
  }
  try {
    const products = await fetchProductsOrThrow(domain, storefrontToken, 10, lang);
    _productCache.set(cacheKey, { products, fetchedAt: Date.now() });
    return { products, apiError: false };
  } catch (err) {
    console.error('❌ fetchProductsWithStatus error:', err);
    return { products: [], apiError: true };
  }
}

// ============================================================
// CONFIGURATION
// ============================================================

export function getShopifyAgentConfig(client: ClientConfig): ShopifyAgentConfig | null {
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

// ============================================================
// PHONE → SHOPIFY COUNTRY CODE
// Maps E.164 phone prefix to ISO 3166-1 alpha-2 country code
// for Shopify Markets auto-currency on checkout.
// ============================================================

export function phoneToCountryCode(phone: string): string | undefined {
  const prefixes: [string, string][] = [
    ['+965', 'KW'], ['+966', 'SA'], ['+971', 'AE'],
    ['+973', 'BH'], ['+974', 'QA'], ['+968', 'OM'],
    ['+962', 'JO'], ['+961', 'LB'], ['+20',  'EG'],
    ['+1',   'US'], ['+44',  'GB'],
  ];
  for (const [prefix, code] of prefixes) {
    if (phone.startsWith(prefix)) return code;
  }
  return undefined;
}

// ============================================================
// QUESTION DETECTION
// ============================================================

export function isQuestionMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (lower.includes('؟') || lower.includes('?')) return true;
  const starters = ['وش', 'شو', 'ايش', 'إيش', 'كيف', 'متى', 'وين', 'ليش', 'لش', 'هل',
    'ممكن', 'فيه', 'عندكم', 'عندك', 'تقدر', 'اقدر', 'كم', 'بكم',
    'مبيعا', 'مبيعاً', 'افضل', 'أفضل', 'الافضل', 'ارخص', 'أرخص', 'استفسار',
    'what', 'which', 'how', 'where', 'when', 'why', 'who', 'is', 'are', 'do', 'does', 'can', 'difference', 'best', 'most', 'cheapest'];
  return starters.some(w => lower.startsWith(w) || lower.includes(' ' + w));
}

// ============================================================
// WEIGHT / UNIT REGEXES — single source of truth
//
// Covers English (g, kg, ml, l, gr, gm, oz, lb) and Arabic (غرام,
// كيلو, جرام, رطل, أونصة/اونصة/اونسه, مل, لتر). Extend here only.
// ============================================================

const WEIGHT_UNITS = 'g|kg|ml|l|غرام|جرام|كيلو|رطل|أونصة|اونصة|اونسه|مل|لتر|gr|gm|oz|lb';

// Strip a trailing weight phrase from a product title ("تمر خلاص 500g" → "تمر خلاص")
export const WEIGHT_STRIP_REGEX = new RegExp(`\\s*\\d+\\s*(${WEIGHT_UNITS})\\s*`, 'i');

// Capture a weight phrase from a product title ("خلاص 1kg" → "1kg")
export const WEIGHT_MATCH_REGEX = new RegExp(`(\\d+\\s*(${WEIGHT_UNITS}))`, 'i');

// ============================================================
// PRODUCT & VARIANT MATCHING
// ============================================================

export function matchProduct(message: string, products: ShopifyProduct[]): ShopifyProduct | null {
  const lower = message.toLowerCase().trim();

  // Match by pick_N button ID
  const pickMatch = lower.match(/^pick_(\d+)$/);
  if (pickMatch) {
    const idx = parseInt(pickMatch[1]!);
    return products[idx] || null;
  }

  // Match by number — only when the message is PURELY digits. Products
  // aren't displayed with numbers in the UI (we use pick_N tap IDs), so a
  // bare "5" from a customer is an ambiguous guess at list position, and
  // "5 kg of خلاص" should never be interpreted as "product #5" (critique
  // #13). Requiring the whole trimmed message to be digits prevents that.
  const normalized = lower.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  ).trim();
  if (/^\d+$/.test(normalized)) {
    const num = parseInt(normalized);
    if (num >= 1 && num <= products.length) {
      return products[num - 1] || null;
    }
  }

  // Match by title substring — prefer the most specific match. If multiple
  // products share the same short keyword (e.g. two "خلاص" products),
  // return null so the caller can disambiguate rather than silently
  // picking the first one (fgf.md #16).
  const titleMatches = products.filter(p =>
    p.title.toLowerCase().includes(lower) || lower.includes(p.title.toLowerCase())
  );
  if (titleMatches.length === 1) return titleMatches[0]!;
  if (titleMatches.length > 1) {
    // If the customer's message is itself a full product title (exact or
    // "message contains title"), the longest matching title wins — that
    // identifies the more specific product ("خلاص فاخر" beats "خلاص").
    const byLongest = [...titleMatches].sort((a, b) => b.title.length - a.title.length);
    const top = byLongest[0]!;
    const second = byLongest[1]!;
    if (top.title.length > second.title.length && lower.includes(top.title.toLowerCase())) {
      return top;
    }
    return null;
  }

  // Match by keywords in title — same disambiguation rule
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  const keywordMatches = products.filter(p => {
    const titleLower = p.title.toLowerCase();
    return words.some(w => titleLower.includes(w));
  });
  if (keywordMatches.length === 1) return keywordMatches[0]!;
  // 2+ keyword matches → ambiguous, let caller reprompt or offer AI answer
  return null;
}

export function matchVariant(message: string, variants: { id: string; title: string; price: string; available: boolean }[]): typeof variants[0] | null {
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
// PATTERN-BASED PRODUCT QUESTIONS — no AI, real data only
// ============================================================

export function tryAnswerProductQuestion(
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

export function getTopProductsByQuery(
  message: string,
  products: ShopifyProduct[],
  limit = 3
): ShopifyProduct[] {
  if (products.length === 0) return [];
  const lower = message.toLowerCase().trim();

  // Best seller — products are pre-sorted BEST_SELLING by Shopify
  if (['أكثر مبيعاً', 'اكثر مبيعا', 'أفضل', 'افضل', 'الأفضل', 'الافضل', 'best'].some(k => lower.includes(k))) {
    return products.slice(0, limit);
  }

  // Cheapest
  if (['أرخص', 'ارخص', 'الأرخص', 'رخيص', 'أقل سعر', 'cheap'].some(k => lower.includes(k))) {
    return [...products].sort((a, b) => parseFloat(a.priceMin) - parseFloat(b.priceMin)).slice(0, limit);
  }

  // Gift — tag-first, fallback to most expensive (premium)
  if (['هدية', 'هديه', 'هدايا', 'gift'].some(k => lower.includes(k))) {
    const tagged = products.filter(p => p.tags?.some(t => ['gift', 'هدية', 'premium'].includes(t.toLowerCase())));
    if (tagged.length > 0) return tagged.slice(0, limit);
    return [...products].sort((a, b) => parseFloat(b.priceMin) - parseFloat(a.priceMin)).slice(0, limit);
  }

  // On sale
  if (['عرض', 'تخفيض', 'خصم', 'sale', 'أوفر', 'اوفر'].some(k => lower.includes(k))) {
    return products.filter(p => p.compareAtPriceMin !== null).slice(0, limit);
  }

  // New arrivals
  if (['جديد', 'جديده', 'وصل', 'new'].some(k => lower.includes(k))) {
    return products
      .filter(p => p.tags?.some(t => ['new', 'new-arrival', 'جديد'].includes(t.toLowerCase())))
      .slice(0, limit);
  }

  return [];
}

// ============================================================
// CART & ORDER HISTORY MANAGEMENT
// ============================================================

export function addToCart(
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
  // Timestamp the cart so stale carts (e.g. from a months-old session) can
  // be dropped on resume with a fresh-start prompt (fgf.md #32).
  conv.data._cartUpdatedAt = new Date().toISOString();
}

// ============================================================
// CART EXPIRY — drop carts older than 14 days on resume.
// Prices drift, stock changes; an uninformed checkout frustrates
// the customer. Called from the main shopify router before any
// cart-sensitive branching.
// ============================================================

const CART_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function expireStaleCart(conv: ConversationState): { expired: boolean; priorItems: CartItem[] } {
  const cart: CartItem[] = conv.data._cart || [];
  if (cart.length === 0) return { expired: false, priorItems: [] };
  const updatedAt = conv.data._cartUpdatedAt as string | undefined;
  if (!updatedAt) return { expired: false, priorItems: [] };
  const age = Date.now() - new Date(updatedAt).getTime();
  if (age < CART_MAX_AGE_MS) return { expired: false, priorItems: [] };
  // Return the prior items so the caller can show the customer what was in
  // the cart before clearing — saves them from having to remember. We still
  // clear the cart (prices/stock may have drifted); the customer re-adds
  // via the product list at current prices.
  conv.data._cart = [];
  delete conv.data._cartUpdatedAt;
  return { expired: true, priorItems: cart };
}

export function pushCurrentOrderToHistory(conv: ConversationState): void {
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

export function resetCurrentOrder(conv: ConversationState): void {
  conv.data._cart = [];
  delete conv.data._selectedProduct;
  delete conv.data._selectedVariant;
  delete conv.data._selectedVariantId;
  delete conv.data._selectedVariantTitle;
  delete conv.data._checkout;
  delete conv.data._checkoutSentAt;
  delete conv.data._paymentVerified;
  delete conv.data._paymentHelpNotified;
  delete conv.data._paymentNudgeSent;
  delete conv.data._cartRecoverySent;
  delete conv.data._checkoutInProgress;
  delete conv.data._checkoutInProgressAt;
  delete conv.data._paymentHelpLastNotifiedAt;
  // Legacy flags (pre-refactor) — clean up old sessions
  delete conv.data._paymentSelfReported;
  delete conv.data._paymentReportedAt;
  delete conv.data._selfReportedAt;
  delete conv.data._paymentLinkReshown;
  delete conv.data._awaitingHelpMessage;
  delete conv.data._postReportReminderSent;
  delete conv.data._postReportOwnerNotified;
  delete conv.data._timeoutRecoveryOffered;
  delete conv.data._aiAnswerCount;
  delete conv.data._aiExhaustedNotified;
  delete conv.data._aiBudgetRefunded;
  delete conv.data._gratitudeAcked;
  conv.data._reprompted = null;
  // Clear intent so returning customers see the menu again
  delete conv.data._intent;
  delete conv.data._intentAsked;
  // Clear order status fields
  delete conv.data._osOrderNum;
  delete conv.data._osOrderNumAsked;
  delete conv.data._osContextForwarded;
  delete conv.data._osLastForwardedAt;
  delete conv.data._osEmail;
  delete conv.data._osEmailAsked;
  delete conv.data._orderStatusUrl;
  // Clear customer service fields
  delete conv.data._csAcknowledged;
  delete conv.data._csStartedAt;
  // Preserve: _lang, _products, _orderHistory, name, _nameAsked
}

// ============================================================
// SMART VARIANT TITLE — fits variant + price in WhatsApp button limit
// ============================================================

export function smartVariantTitle(variantTitle: string, price: string, currency: string | undefined, max: number): string {
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
// CLEAN DESCRIPTION — unified helper used by all product views
// Strips HTML, collapses whitespace, truncates to max chars.
// ============================================================

export function cleanDescription(raw: string | undefined | null, max: number): string {
  if (!raw) return '';
  const stripped = raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (stripped.length <= max) return stripped;
  return stripped.substring(0, max - 1).trimEnd() + '…';
}

// ============================================================
// REPROMPT HELPERS — three-step pattern per state:
//   1st unrecognized → reprompt  (markReprompted)
//   2nd unrecognized → hint      (markHinted)
//   3rd+ unrecognized → silence
// ============================================================

export function shouldSilence(conv: ConversationState): boolean {
  return conv.data._reprompted === conv.data._shopifyState + '_hinted';
}

export function shouldSendHint(conv: ConversationState): boolean {
  return conv.data._reprompted === conv.data._shopifyState;
}

export function markReprompted(conv: ConversationState): void {
  conv.data._reprompted = conv.data._shopifyState;
}

export function markHinted(conv: ConversationState): void {
  conv.data._reprompted = conv.data._shopifyState + '_hinted';
}

// ============================================================
// ORDER STATUS — Shopify Admin API
// ============================================================

export async function getOrderByNumber(
  domain: string,
  adminToken: string,
  orderNum: string
): Promise<ShopifyAdminOrder | null> {
  try {
    const url = `https://${domain}/admin/api/2026-04/orders.json?name=%23${orderNum}&status=any`;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    const json = await res.json() as { orders: ShopifyAdminOrder[] };
    return json.orders?.[0] || null;
  } catch {
    return null;
  }
}

export function formatOrderStatus(order: ShopifyAdminOrder, lang: string): string {
  const financialMap: Record<string, [string, string]> = {
    paid:            ['مدفوع ✅',         'Paid ✅'],
    pending:         ['بانتظار الدفع ⏳', 'Pending payment ⏳'],
    partially_paid:  ['مدفوع جزئياً 🔶',  'Partially paid 🔶'],
    refunded:        ['مسترجع ↩️',        'Refunded ↩️'],
    voided:          ['ملغي ❌',           'Voided ❌']
  };
  const fulfillmentMap: Record<string, [string, string]> = {
    fulfilled:   ['تم الشحن 🚚',      'Shipped 🚚'],
    partial:     ['شُحن جزئياً 📦',   'Partially shipped 📦'],
    null:        ['قيد التجهيز 🏭',   'Being prepared 🏭']
  };

  const finKey = order.financial_status || 'pending';
  const fulKey = order.fulfillment_status ?? 'null';
  const fin = (financialMap[finKey] ?? financialMap['pending'])![lang === 'en' ? 1 : 0];
  const ful = (fulfillmentMap[fulKey] ?? fulfillmentMap['null'])![lang === 'en' ? 1 : 0];

  const tracking = order.fulfillments?.[0]?.tracking_url;
  const trackingLine = tracking
    ? `\n🔗 ${msg('رابط التتبع', 'Tracking link', lang)}: ${tracking}`
    : '';

  const items = order.line_items?.slice(0, 3).map(i => `• ${i.title} x${i.quantity}`).join('\n') || '';

  return msg(
    `📦 *طلب #${order.order_number}*\n━━━━━━━━━━━━━━━\n${items}\n\n💳 الدفع: ${fin}\n🚚 الشحن: ${ful}${trackingLine}`,
    `📦 *Order #${order.order_number}*\n━━━━━━━━━━━━━━━\n${items}\n\n💳 Payment: ${fin}\n🚚 Shipping: ${ful}${trackingLine}`,
    lang
  );
}
