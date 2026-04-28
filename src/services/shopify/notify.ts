// ============================================================
// SHOPIFY OWNER NOTIFICATION
// Sends a localized message to all configured agent + owner phones
// summarizing the customer's session (cart, totals, last message).
// Used by every state that needs human escalation.
// ============================================================

import { sendWhatsAppMessage } from '../whatsapp.js';
import { formatPrice } from '../shopify.js';
import { emitEvent } from '../events.js';
import type { ClientConfig } from '../../types/client.js';
import type { ShopifyAgentConfig, ConversationState, CartItem } from './types.js';
import { formatCartLine } from './helpers.js';

export async function notifyOwner(
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
    const cartCurrency = checkout?.currency || config.currency;
    cartText = cart
      .map(i => formatCartLine(i, cartCurrency, { prefix: '📦' }))
      .join('\n');
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
