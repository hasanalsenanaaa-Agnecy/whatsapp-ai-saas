// ============================================================
// SHOPIFY AI AGENT
// Full e-commerce WhatsApp agent:
//   Welcome → Browse choice → (Images?) → Catalog → Selection → Payment link → Receipt
// Works with tokenless Shopify Storefront API.
// ============================================================

import {
  fetchProducts,
  createCheckout,
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

  const shopifyState = conv.data._shopifyState || 'welcome';

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
    case 'confirm_order':
      await handleOrderConfirmation(client, conv, config, message, accessToken);
      break;
    case 'awaiting_payment':
      await handlePaymentConfirmation(client, conv, config, message, accessToken);
      break;
    case 'done':
      await handlePostOrder(client, conv, config, message, accessToken);
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
  const welcome = `أهلاً وسهلاً في *${config.storeName}*! 🛍️✨\n\nيسعدنا نخدمك. خلني أعرض لك منتجاتنا 👇`;
  await sendWhatsAppMessage(conv.phone, welcome, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: welcome });

  // Fetch products
  const products = await fetchProducts(config.domain, config.storefrontToken, 10);

  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، ما فيه منتجات متوفرة حالياً. تبي نبلغك لما ترجع؟', accessToken, client.phone_number_id);
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
      { id: 'show_images', title: 'عرض الصور 📸' },
      { id: 'pick_direct', title: 'اختر مباشرة 📋' }
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
      const caption = `📦 *${product.title}*\n💰 ${priceText}`;
      if (product.imageUrl) {
        await sendWhatsAppImage(conv.phone, product.imageUrl, caption, accessToken, client.phone_number_id);
      } else {
        await sendWhatsAppMessage(conv.phone, caption, accessToken, client.phone_number_id);
      }
      await sleep(500);
    }
    // Then show selection list
    await showProductCatalog(client, conv, config, accessToken, 'وش يعجبك؟ اختر المنتج اللي تبيه 👇');
    conv.data._shopifyState = 'catalog';
    return;
  }

  if (wantsDirect) {
    // Skip images, show list directly
    await showProductCatalog(client, conv, config, accessToken, 'وش يعجبك؟ اختر المنتج اللي تبيه 👇');
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
      { id: 'show_images', title: 'عرض الصور 📸' },
      { id: 'pick_direct', title: 'اختر مباشرة 📋' }
    ],
    accessToken,
    client.phone_number_id
  );
}

// ============================================================
// STATE: CATALOG — Customer picks a product
// ============================================================

async function handleCatalogSelection(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  const selected = matchProduct(message, products);

  if (!selected) {
    await sendWhatsAppMessage(conv.phone, 'ما فهمت اختيارك 🤔 اختر من القائمة اللي فوق أو اكتب اسم المنتج.', accessToken, client.phone_number_id);
    return;
  }

  // Save selection
  conv.data._selectedProduct = selected;
  conv.data._selectedIndex = products.findIndex(p => p.id === selected.id);

  // Show product detail with order button
  const price = formatPrice(selected.priceMin, config.currency);
  const desc = selected.description ? `\n\n${selected.description.substring(0, 300)}` : '';
  const detail = `📦 *${selected.title}*\n💰 السعر: ${price}${desc}`;

  if (selected.imageUrl) {
    await sendWhatsAppImage(conv.phone, selected.imageUrl, detail, accessToken, client.phone_number_id);
    await sleep(300);
  }

  // Check if product has multiple variants
  const availableVariants = selected.variants.filter(v => v.available);
  if (availableVariants.length > 1 && availableVariants.some(v => v.title !== 'Default Title')) {
    // Show variant selection
    const variantList = availableVariants.slice(0, 3).map((v, i) => ({
      id: `var_${i}`,
      title: truncate(`${v.title} - ${formatPrice(v.price, config.currency)}`, 20)
    }));
    await sendWhatsAppButtons(
      conv.phone,
      'اختر النوع اللي تبيه:',
      variantList,
      accessToken,
      client.phone_number_id
    );
    conv.data._shopifyState = 'product_detail';
  } else {
    // Single variant — go straight to order confirmation
    const variant = availableVariants[0] || selected.variants[0];
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;

    await sendWhatsAppButtons(
      conv.phone,
      `تبي تطلب *${selected.title}*؟ 🛒`,
      [
        { id: 'order_yes', title: 'نعم، اطلب 🛒' },
        { id: 'order_back', title: 'ارجع للمنتجات' }
      ],
      accessToken,
      client.phone_number_id
    );
    conv.data._shopifyState = 'confirm_order';
  }

  conv.messages.push({ role: 'assistant', content: detail });
}

// ============================================================
// STATE: PRODUCT_DETAIL — Variant selection
// ============================================================

async function handleProductAction(
  client: any,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const product: ShopifyProduct = conv.data._selectedProduct;
  const availableVariants = product.variants.filter(v => v.available);

  // Match variant
  let variant = matchVariant(message, availableVariants);
  if (!variant) {
    await sendWhatsAppMessage(conv.phone, 'اختر من الخيارات المتاحة 👆', accessToken, client.phone_number_id);
    return;
  }

  conv.data._selectedVariantId = variant.id;
  conv.data._selectedVariantTitle = variant.title;

  await sendWhatsAppButtons(
    conv.phone,
    `تبي تطلب *${product.title}* (${variant.title})؟ 🛒`,
    [
      { id: 'order_yes', title: 'نعم، اطلب 🛒' },
      { id: 'order_back', title: 'ارجع للمنتجات' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'confirm_order';
}

// ============================================================
// STATE: CONFIRM_ORDER — Customer confirms, we create cart + send payment link
// ============================================================

async function handleOrderConfirmation(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Go back to catalog
  if (lower === 'order_back' || lower.includes('ارجع') || lower.includes('رجوع')) {
    conv.data._shopifyState = 'catalog';
    // Re-show product list
    await showProductCatalog(client, conv, config, accessToken, 'تفضل اختر منتج ثاني 👇');
    return;
  }

  // Confirm order
  const isYes = lower === 'order_yes' || lower.includes('نعم') || lower.includes('اطلب')
    || lower.includes('أطلب') || lower.includes('تمام') || lower.includes('زين')
    || lower.includes('اوك') || lower.includes('أوك') || lower.includes('ماشي');

  if (!isYes) {
    await sendWhatsAppButtons(
      conv.phone,
      'تبي تطلب ولا ترجع للمنتجات؟',
      [
        { id: 'order_yes', title: 'نعم، اطلب 🛒' },
        { id: 'order_back', title: 'ارجع للمنتجات' }
      ],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Create Shopify cart → get payment link
  const variantId = conv.data._selectedVariantId;
  if (!variantId) {
    await sendWhatsAppMessage(conv.phone, 'صار خطأ، خلني أعرض لك المنتجات من جديد.', accessToken, client.phone_number_id);
    conv.data._shopifyState = 'welcome';
    return;
  }

  await sendWhatsAppMessage(conv.phone, 'جاري تجهيز طلبك... ⏳', accessToken, client.phone_number_id);

  const checkout = await createCheckout(config.domain, config.storefrontToken, variantId, 1);

  if (!checkout) {
    await sendWhatsAppMessage(conv.phone, 'عذراً، صار خطأ في إنشاء الطلب. جرب مرة ثانية.', accessToken, client.phone_number_id);
    return;
  }

  // Save checkout info
  const product: ShopifyProduct = conv.data._selectedProduct;
  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: checkout.totalPrice,
    currency: checkout.currency
  };

  // Send payment link to customer
  const price = formatPrice(checkout.totalPrice, checkout.currency);
  const paymentMsg = `🛒 *تفاصيل طلبك:*\n\n📦 ${product.title}\n💰 ${price}\n\n💳 *ادفع من هنا:*\n${checkout.checkoutUrl}\n\nبعد ما تدفع، اضغط "تم الدفع" 👇`;
  await sendWhatsAppMessage(conv.phone, paymentMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: paymentMsg });

  await sleep(500);

  await sendWhatsAppButtons(
    conv.phone,
    'هل دفعت؟ 💳',
    [
      { id: 'paid_yes', title: 'تم الدفع ✅' },
      { id: 'paid_help', title: 'أحتاج مساعدة' }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'awaiting_payment';
}

// ============================================================
// STATE: AWAITING_PAYMENT — Customer confirms payment
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
    const helpMsg = 'لا تشيل هم! فريقنا بيتواصل معك خلال دقائق. 🙏';
    await sendWhatsAppMessage(conv.phone, helpMsg, accessToken, client.phone_number_id);
    conv.messages.push({ role: 'assistant', content: helpMsg });
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // Already self-reported — waiting for webhook confirmation
  if (conv.data._selfReportedAt && conv.data._paymentVerified === false) {
    await sendWhatsAppMessage(conv.phone, 'ما زلنا نتحقق من الدفع. بنأكد طلبك قريباً ✅', accessToken, client.phone_number_id);
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
        `💳 رابط الدفع:\n${checkoutUrl}\n\nهل دفعت؟`,
        [
          { id: 'paid_yes', title: 'دفعت ✅' },
          { id: 'paid_help', title: 'أحتاج مساعدة' }
        ],
        accessToken,
        client.phone_number_id
      );
    }
    return;
  }

  // ====== PAYMENT SELF-REPORTED — pending webhook verification ======
  // Don't send receipt yet; let the Shopify orders/paid webhook confirm it.
  conv.data._paymentVerified = false;
  // Timestamp is used by the guard above to detect repeat messages from the
  // same customer while we're waiting for the webhook confirmation.
  conv.data._selfReportedAt = new Date().toISOString();

  const verifyingMsg = 'شكراً! نتحقق من الدفع وبنأكد طلبك تلقائي ✅';
  await sendWhatsAppMessage(conv.phone, verifyingMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: verifyingMsg });

  // Notify owner with unverified warning
  await notifyOwner(client, conv, config, 'unverified', accessToken);

  // Save lead with unverified flag so owner knows
  const product: ShopifyProduct = conv.data._selectedProduct;
  const checkout = conv.data._checkout;
  const price = formatPrice(checkout?.totalPrice || product.priceMin, checkout?.currency || config.currency);
  try {
    await createLead({
      clientId: client.id,
      phone: conv.phone,
      name: conv.data.name || conv.phone,
      email: '',
      data: {
        product: product.title,
        variant: conv.data._selectedVariantTitle || '',
        price: checkout?.totalPrice || product.priceMin,
        currency: checkout?.currency || config.currency,
        checkoutUrl: checkout?.url || '',
        paymentConfirmed: true,
        paymentVerified: false,
        orderDate: new Date().toISOString()
      },
      score: 'warm'
    });
  } catch (err) {
    console.error('❌ Lead save error:', err);
  }

  console.log(`⏳ Shopify payment self-reported (unverified): ${conv.phone} → ${product.title} (${price})`);
}

// ============================================================
// STATE: DONE — Post-order follow-ups
// ============================================================

async function handlePostOrder(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // New order?
  if (lower === 'new_order' || lower.includes('طلب جديد') || lower.includes('ابي اطلب') || lower.includes('أبي أطلب')
    || lower.includes('تصفح') || lower.includes('من جديد')) {
    conv.data._shopifyState = 'catalog';
    // Reuse cached products — no re-fetching, no image flood
    await showProductCatalog(client, conv, config, accessToken, 'تفضل اختر منتجك 👇');
    return;
  }

  // Cancel / problem → notify owner
  const urgentKeywords = ['الغ', 'الغاء', 'ألغي', 'مشكلة', 'شكوى', 'وين طلبي', 'موظف', 'بشر'];
  if (lower === 'talk_agent' || urgentKeywords.some(k => lower.includes(k))) {
    await sendWhatsAppMessage(conv.phone, 'تم! فريقنا بيتواصل معك خلال دقائق. 🙏', accessToken, client.phone_number_id);
    await notifyOwner(client, conv, config, 'urgent', accessToken);
    return;
  }

  // Default: friendly response
  const product = conv.data._selectedProduct;
  await sendWhatsAppButtons(
    conv.phone,
    `شكراً لك! 😊\nطلبك (${product?.title || 'المنتج'}) على طريقه.\n\nتبي شي ثاني؟`,
    [
      { id: 'new_order', title: 'طلب جديد 🛍️' },
      { id: 'talk_agent', title: 'تكلم مع موظف' }
    ],
    accessToken,
    client.phone_number_id
  );
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

async function notifyOwner(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  type: 'paid' | 'help' | 'urgent' | 'unverified',
  accessToken: string
): Promise<void> {
  const product = conv.data._selectedProduct as ShopifyProduct | undefined;
  const checkout = conv.data._checkout;
  const price = formatPrice(
    checkout?.totalPrice || product?.priceMin || '0',
    checkout?.currency || config.currency
  );
  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  const displayName = conv.data.name || conv.phone;

  let notification = '';

  if (type === 'paid') {
    notification = `✅ *طلب مدفوع — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

📦 المنتج: ${product?.title || '-'}${conv.data._selectedVariantTitle && conv.data._selectedVariantTitle !== 'Default Title' ? `\n📏 النوع: ${conv.data._selectedVariantTitle}` : ''}
💰 المبلغ: ${price}
🔗 ${checkout?.url || '-'}

⏰ ${time}`;
  } else if (type === 'unverified') {
    notification = `⏳ *طلب بانتظار التحقق — ${config.storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

📦 المنتج: ${product?.title || '-'}${conv.data._selectedVariantTitle && conv.data._selectedVariantTitle !== 'Default Title' ? `\n📏 النوع: ${conv.data._selectedVariantTitle}` : ''}
💰 المبلغ: ${price}
🔗 ${checkout?.url || '-'}

⚠️ لم يتم التحقق من الدفع بعد
⏰ ${time}`;
  } else if (type === 'help') {
    notification = `⚠️ *عميل يحتاج مساعدة — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

📦 المنتج: ${product?.title || '-'}
💰 ${price}

⏰ ${time}`;
  } else {
    notification = `🚨 *طلب عاجل — ${config.storeName}*

👤 ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

📦 آخر طلب: ${product?.title || '-'}
💰 ${price}

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

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 1) + '…' : text;
}

// ============================================================
// SMART TITLE — puts weight + key differentiator first
// so they survive WhatsApp's 24-char list title limit
// e.g. "Jumbo Premium Royal Khalas Dates, 2kg" → "2kg Jumbo Khalas"
// ============================================================

function smartTitle(title: string, max: number): string {
  // Extract weight (e.g. 2kg, 1kg, 900g, 2 kg)
  const weightMatch = title.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  const weight = weightMatch ? weightMatch[0].replace(/\s+/g, '').toLowerCase() : null;

  // Key qualifiers (ordered by importance)
  const qualifiers = ['Jumbo', 'Premium'];
  const foundQualifier = qualifiers.find(q => title.toLowerCase().includes(q.toLowerCase()));

  // Date variety names
  const varieties = ['Khalas', 'Sagai', 'Sukkari', 'Ajwa', 'Medjool', 'Mabroom', 'Safawi'];
  const foundVariety = varieties.find(v => title.toLowerCase().includes(v.toLowerCase()));

  // Special extra descriptor after variety (e.g. "Ajwa Al-Madinah")
  let extra = '';
  if (foundVariety) {
    const afterVariety = title.substring(title.toLowerCase().indexOf(foundVariety.toLowerCase()) + foundVariety.length);
    const extraMatch = afterVariety.match(/^[\s-]+(Al-\w+|\w+)/i);
    if (extraMatch && extraMatch[1] && !['Dates', 'Date'].includes(extraMatch[1])) {
      extra = ' ' + extraMatch[1];
    }
  }

  if (!weight && !foundQualifier && !foundVariety) {
    return truncate(title, max);
  }

  // Build compact title: weight first, then qualifier, then variety
  const parts: string[] = [];
  if (weight) parts.push(weight);
  if (foundQualifier) parts.push(foundQualifier);
  if (foundVariety) parts.push(foundVariety + extra);
  const compact = parts.join(' ');
  return truncate(compact, max);
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
  if (products.length <= 3) {
    await sendWhatsAppButtons(
      conv.phone,
      prompt,
      products.map((p, i) => ({ id: `pick_${i}`, title: smartTitle(p.title, 20) })),
      accessToken,
      client.phone_number_id
    );
  } else {
    await sendWhatsAppList(
      conv.phone,
      prompt,
      'المنتجات',
      products.map((p, i) => ({ id: `pick_${i}`, title: smartTitle(p.title, 24) })),
      accessToken,
      client.phone_number_id
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
