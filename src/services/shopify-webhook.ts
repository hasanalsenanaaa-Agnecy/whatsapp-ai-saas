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

  // Verify HMAC signature
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || client.settings?.shopify_webhook_secret || client.settings?.shopify?.webhook_secret;
  if (webhookSecret && hmacHeader) {
    if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
      console.error('Shopify webhook: invalid HMAC signature');
      return;
    }
  } else {
    console.warn('Shopify webhook: HMAC verification skipped (no secret configured)');
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

  // Accept awaiting_payment state OR done-but-unverified state
  const isAwaitingPayment = conv.data._shopifyState === 'awaiting_payment';
  const isDoneUnverified = conv.data._shopifyState === 'done' && conv.data._paymentVerified === false;

  if (!isAwaitingPayment && !isDoneUnverified) {
    console.log(`Shopify webhook: conversation for ${customerPhone} not in payment state (state=${conv.data._shopifyState})`);
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

  const firstItem = order.line_items?.[0];
  const productTitle = firstItem?.title || conv.data._selectedProduct?.title || '-';
  const variantTitle = firstItem?.variant_title && firstItem.variant_title !== 'Default Title'
    ? firstItem.variant_title : (conv.data._selectedVariantTitle || '');
  const totalPrice = order.total_price || conv.data._checkout?.totalPrice || '0';
  const orderNumber = order.order_number ? `#${order.order_number}` : '';

  // Update conversation
  conv.data._paymentVerified = true;
  conv.data._shopifyState = 'done';
  if (customerName) conv.data.name = customerName;
  if (orderNumber) conv.data._orderNumber = orderNumber;
  await saveConversation(conv);

  // Send receipt to customer
  const priceFormatted = formatPrice(totalPrice, currency);
  const receipt = `✅ *تم تأكيد طلبك بنجاح!*

🧾 *إيصال الطلب:*
━━━━━━━━━━━━━━━
📦 المنتج: ${productTitle}${variantTitle ? `\n📏 النوع: ${variantTitle}` : ''}
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
      { id: 'talk_agent', title: 'تكلم مع موظف' }
    ],
    accessToken,
    client.phone_number_id
  );

  // Notify owner — verified payment
  const time = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  const displayName = conv.data.name || conv.phone;
  const ownerMsg = `✅ *طلب مدفوع (تم التحقق) — ${storeName}*

👤 العميل: ${displayName}
📱 ${conv.phone}
💬 wa.me/${conv.phone.replace('+', '')}

📦 المنتج: ${productTitle}${variantTitle ? `\n📏 النوع: ${variantTitle}` : ''}
💰 المبلغ: ${priceFormatted}${orderNumber ? `\n🔖 رقم الطلب: ${orderNumber}` : ''}
🔗 ${conv.data._checkout?.url || '-'}

⏰ ${time}`;

  for (const phone of ownerPhones) {
    try {
      await sendWhatsAppMessage(phone, ownerMsg, accessToken, client.phone_number_id);
    } catch (err) {
      console.error('Shopify webhook: owner notify error:', err);
    }
  }

  // Save / update lead
  try {
    await createLead({
      clientId: client.id,
      phone: conv.phone,
      name: conv.data.name || conv.phone,
      email: order.customer?.email || '',
      data: {
        product: productTitle,
        variant: variantTitle,
        price: totalPrice,
        currency,
        checkoutUrl: conv.data._checkout?.url || '',
        orderNumber,
        paymentConfirmed: true,
        paymentVerified: true,
        orderDate: new Date().toISOString()
      },
      score: 'hot'
    });
  } catch (err) {
    console.error('Shopify webhook: lead save error:', err);
  }

  console.log(`✅ Shopify webhook: payment verified for ${conv.phone} → ${productTitle} (${priceFormatted})`);
}
