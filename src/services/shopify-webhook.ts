// ============================================================
// SHOPIFY WEBHOOK HANDLER
// Handles Shopify orders/paid events to verify real payment
// and send order confirmation to the customer via WhatsApp.
// ============================================================

import crypto from 'crypto';
import { getClientByShopifyDomain, getConversation, saveConversation, createLead } from './database.js';
import { sendWhatsAppMessage, sendWhatsAppButtons } from './whatsapp.js';
import { formatPrice } from './shopify.js';

// ============================================================
// TYPES
// ============================================================

interface ShopifyOrderPayload {
  order_number?: number;
  financial_status?: string;
  total_price?: string;
  currency?: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
  };
  shipping_address?: {
    phone?: string;
    first_name?: string;
    last_name?: string;
  };
  line_items?: Array<{
    title?: string;
    variant_title?: string;
    price?: string;
    quantity?: number;
  }>;
}

// ============================================================
// HMAC VERIFICATION
// ============================================================

function verifyShopifyHmac(rawBody: string, hmacHeader: string, secret: string): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ============================================================
// PHONE NORMALISATION
// Strips non-digit characters (including leading '+') so the
// result can be compared with WhatsApp's E.164 phone values
// (e.g. "96512345678").
// NOTE: Shopify phones in international format (+96512345678)
// will normalise correctly. Local/short formats without a
// country code prefix will NOT match — phones must be stored
// in Shopify in international format for the lookup to succeed.
// ============================================================

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  // Remove all non-digit characters (e.g. '+', '-', spaces, parentheses)
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Strip a leading '00' dialling prefix (e.g. "009651…" → "9651…")
  if (digits.startsWith('00')) return digits.substring(2);
  // Strip a leading '0' only if this looks like a very short number
  // (≤9 digits after stripping), to avoid corrupting valid long codes
  if (digits.startsWith('0') && digits.length <= 10) return digits.substring(1);
  return digits;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleShopifyWebhook(
  payload: any,
  rawBody: string,
  hmacHeader: string | undefined,
  shopDomain: string | undefined,
  topic: string | undefined
): Promise<void> {
  // Only handle orders/paid events
  if (topic !== 'orders/paid') {
    console.log(`Shopify webhook ignored: topic=${topic}`);
    return;
  }

  if (!shopDomain) {
    console.error('Shopify webhook: missing X-Shopify-Shop-Domain header');
    return;
  }

  // Find the client that owns this Shopify store
  const clientRaw = await getClientByShopifyDomain(shopDomain);
  if (!clientRaw) {
    console.error(`Shopify webhook: no client found for domain ${shopDomain}`);
    return;
  }
  // Cast to any since DB returns dynamic shape (same pattern as shopify-agent.ts)
  const client = clientRaw as any;

  // Verify HMAC signature — required in production
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || client.settings?.shopify_webhook_secret || client.settings?.shopify?.webhook_secret;
  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Shopify webhook: no HMAC secret configured — request rejected');
      return;
    }
    console.warn('Shopify webhook: HMAC verification skipped (no secret — dev only)');
  } else if (!hmacHeader || !verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
    console.error('Shopify webhook: invalid or missing HMAC signature');
    return;
  }

  const order = payload as ShopifyOrderPayload;

  if (order.financial_status !== 'paid') {
    console.log(`Shopify webhook: order financial_status is "${order.financial_status}", skipping`);
    return;
  }

  // Extract customer phone
  const rawPhone = order.customer?.phone || order.shipping_address?.phone;
  const customerPhone = normalisePhone(rawPhone);
  if (!customerPhone) {
    console.error('Shopify webhook: could not extract customer phone from order', order.order_number);
    return;
  }

  // Extract customer name
  const firstName = order.customer?.first_name || order.shipping_address?.first_name || '';
  const lastName = order.customer?.last_name || order.shipping_address?.last_name || '';
  const customerName = [firstName, lastName].filter(Boolean).join(' ').trim();

  // Find conversation
  const conv = await getConversation(client.id, customerPhone);
  if (!conv) {
    console.log(`Shopify webhook: no conversation found for phone ${customerPhone}`);
    return;
  }

  // Accept awaiting_payment, order_complete, or done-but-unverified state
  const shopifyState = conv.data._shopifyState;
  const isPaymentPending = shopifyState === 'awaiting_payment'
    || shopifyState === 'order_complete'
    || (shopifyState === 'done' && conv.data._paymentVerified === false);

  if (!isPaymentPending) {
    console.log(`Shopify webhook: conversation for ${customerPhone} not in payment state (state=${shopifyState})`);
    return;
  }

  // Already verified? Skip duplicate webhooks
  if (conv.data._paymentVerified === true) {
    console.log(`Shopify webhook: payment already verified for ${customerPhone}`);
    return;
  }

  const accessToken = client.access_token;
  const storeName = client.name || 'المتجر';
  const currency = client.settings?.currency || order.currency || 'KWD';
  const ownerPhones: string[] = client.agent_phones || [];

  // Build product info from order line items or cart data
  const cart: { productTitle: string; variantTitle: string }[] = conv.data._cart || [];
  const lineItems = order.line_items || [];
  let productsText = '';
  if (lineItems.length > 0) {
    productsText = lineItems.map(li => {
      let line = `📦 ${li.title || '-'}`;
      if (li.variant_title && li.variant_title !== 'Default Title') line += ` (${li.variant_title})`;
      if (li.quantity && li.quantity > 1) line += ` x${li.quantity}`;
      return line;
    }).join('\n');
  } else if (cart.length > 0) {
    productsText = cart.map(i => {
      let line = `📦 ${i.productTitle}`;
      if (i.variantTitle && i.variantTitle !== 'Default Title') line += ` (${i.variantTitle})`;
      return line;
    }).join('\n');
  } else {
    const firstItem = lineItems[0];
    productsText = `📦 ${firstItem?.title || conv.data._selectedProduct?.title || '-'}`;
  }

  const totalPrice = order.total_price || conv.data._checkout?.totalPrice || '0';
  const orderNumber = order.order_number ? `#${order.order_number}` : '';

  // Update conversation
  conv.data._paymentVerified = true;
  if (customerName) conv.data.name = customerName;
  if (orderNumber) conv.data._orderNumber = orderNumber;

  // State transition depends on current state
  const wasAwaitingPayment = shopifyState === 'awaiting_payment';
  if (wasAwaitingPayment) {
    // Customer hasn't confirmed yet but payment went through — move to order_complete
    conv.data._shopifyState = 'order_complete';
  }
  // If already order_complete or done, keep the state
  await saveConversation(conv);

  const priceFormatted = formatPrice(totalPrice, currency);

  if (wasAwaitingPayment) {
    // Full receipt — customer hasn't seen the completion message yet
    const receipt = `✅ *تم تأكيد الدفع وطلبك قيد التجهيز!*

🧾 *إيصال الطلب:*
━━━━━━━━━━━━━━━
${productsText}
💰 المبلغ: ${priceFormatted}${orderNumber ? `\n🔖 رقم الطلب: ${orderNumber}` : ''}
📱 رقمك: ${conv.phone}
📅 التاريخ: ${new Date().toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh' })}
━━━━━━━━━━━━━━━

شكراً لتسوقك من *${storeName}*! 🙏❤️
راح نتواصل معك بخصوص التوصيل قريباً 📦`;

    await sendWhatsAppMessage(conv.phone, receipt, accessToken, client.phone_number_id);
    await new Promise(r => setTimeout(r, 400));

    await sendWhatsAppButtons(
      conv.phone,
      'تبي تطلب شيء ثاني؟ 😊',
      [
        { id: 'new_order', title: 'طلب جديد 🛍️' },
        { id: 'no_thanks', title: 'لا شكراً 👋' }
      ],
      accessToken,
      client.phone_number_id
    );
  } else {
    // Short confirmation — customer already got the completion message
    await sendWhatsAppMessage(conv.phone, 'تم تأكيد الدفع ✅ طلبك قيد التجهيز', accessToken, client.phone_number_id);
  }

  // Notify owner — verified payment
  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  const displayName = conv.data.name || conv.phone;
  const history = conv.data._orderHistory || [];
  const historyText = history.length > 0 ? `\n📜 طلبات سابقة: ${history.length}` : '';
  const ownerMsg = `✅ *طلب مدفوع (تم التحقق) — ${storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

${productsText}
💰 المبلغ: ${priceFormatted}${orderNumber ? `\n🔖 رقم الطلب: ${orderNumber}` : ''}
🔗 ${conv.data._checkout?.url || '-'}${historyText}

⏰ ${time}`;

  for (const phone of ownerPhones) {
    try {
      await sendWhatsAppMessage(phone, ownerMsg, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('Shopify webhook: owner notify error:', err);
    }
  }

  // Save / update lead with cart data
  try {
    await createLead({
      clientId: client.id,
      phone: conv.phone,
      name: conv.data.name || conv.phone,
      email: order.customer?.email || '',
      data: {
        cart: cart.length > 0 ? cart : lineItems.map((li: any) => ({ product: li.title, variant: li.variant_title, price: li.price })),
        totalPrice,
        currency,
        checkoutUrl: conv.data._checkout?.url || '',
        orderNumber,
        paymentConfirmed: true,
        paymentVerified: true,
        orderDate: new Date().toISOString(),
        orderHistory: conv.data._orderHistory || []
      },
      score: 'hot'
    });
  } catch (err) {
    console.error('Shopify webhook: lead save error:', err);
  }

  console.log(`✅ Shopify webhook: payment verified for ${conv.phone} → ${orderNumber || 'order'} (${totalPrice} ${currency})`);
}
