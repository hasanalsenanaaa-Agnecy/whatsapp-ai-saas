// ============================================================
// ABANDONED CART RECOVERY
// Finds conversations stuck in awaiting_payment and sends a
// follow-up message with the checkout link.
// Called via cron (e.g. every 30 min via QStash).
// ============================================================

import { sql, getClientById } from '../services/database.js';
import { sendWhatsAppMessage, sendWhatsAppButtons } from '../services/whatsapp.js';
import { formatPrice } from '../services/shopify.js';
import { maskPhone } from '../utils/buttons.js';
import { emitEvent } from '../services/events.js';

// Only nudge carts abandoned for at least this many minutes
const MIN_ABANDONED_MINUTES = 60;
// Don't nudge carts older than this many hours (stale)
const MAX_ABANDONED_HOURS = 24;

interface AbandonedCart {
  client_id: string;
  phone: string;
  data: Record<string, any>;
  updated_at: string;
}

/**
 * Find and nudge abandoned carts.
 */
export async function processAbandonedCarts(): Promise<{
  found: number;
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const result = { found: 0, sent: 0, skipped: 0, errors: [] as string[] };

  if (!sql) return result;

  try {
    const minAgo = new Date(Date.now() - MIN_ABANDONED_MINUTES * 60_000).toISOString();
    const maxAgo = new Date(Date.now() - MAX_ABANDONED_HOURS * 3600_000).toISOString();

    // Find conversations in awaiting_payment state, abandoned 1-24 hours ago,
    // where we haven't already sent a recovery message
    const rows = await sql`
      SELECT client_id, phone, data, updated_at
      FROM conversations
      WHERE state = 'shopify_agent'
        AND data->>'_shopifyState' = 'awaiting_payment'
        AND data->>'_paymentVerified' IS DISTINCT FROM 'true'
        AND data->>'_cartRecoverySent' IS DISTINCT FROM 'true'
        AND updated_at <= ${minAgo}
        AND updated_at >= ${maxAgo}
      ORDER BY updated_at ASC
      LIMIT 50
    `;

    result.found = rows.length;

    if (rows.length === 0) {
      console.log('🛒 No abandoned carts to recover');
      return result;
    }

    console.log(`🛒 Found ${rows.length} abandoned carts`);

    for (const row of rows) {
      try {
        const cart = row as unknown as AbandonedCart;
        const data = typeof cart.data === 'string' ? JSON.parse(cart.data) : cart.data;

        const checkoutUrl = data._checkout?.url;
        if (!checkoutUrl) {
          result.skipped++;
          continue;
        }

        const client = await getClientById(cart.client_id);
        if (!client) {
          result.skipped++;
          continue;
        }

        const lang: string = data._lang || 'ar';
        const storeName = client.name || 'المتجر';
        const currency = client.settings?.currency || 'KWD';

        // Build cart summary
        const cartItems: { productTitle: string; price: string; quantity: number }[] = data._cart || [];
        let cartText = '';
        if (cartItems.length > 0) {
          cartText = cartItems.map(i => {
            const line = `📦 ${i.productTitle}`;
            return i.quantity > 1 ? `${line} x${i.quantity}` : line;
          }).join('\n');
        }

        const totalStr = data._checkout?.totalPrice;
        const priceText = totalStr ? ` (${formatPrice(totalStr, currency)})` : '';

        // Send recovery message
        const messageAr = `مرحبا! 👋\n\nلاحظنا إن عندك طلب ما اكتمل من *${storeName}*${priceText}\n\n${cartText ? cartText + '\n\n' : ''}رابط الدفع لا يزال فعّال — تقدر تكمل الطلب من هنا:\n${checkoutUrl}`;
        const messageEn = `Hi! 👋\n\nWe noticed you have an incomplete order from *${storeName}*${priceText}\n\n${cartText ? cartText + '\n\n' : ''}Your payment link is still active — complete your order here:\n${checkoutUrl}`;
        const message = lang === 'en' ? messageEn : messageAr;

        await sendWhatsAppMessage(cart.phone, message, client.access_token, client.phone_number_id);

        // Follow up with buttons
        await sendWhatsAppButtons(
          cart.phone,
          lang === 'en' ? 'Need help?' : 'تحتاج مساعدة؟',
          [
            { id: 'continue_checkout', title: lang === 'en' ? 'Complete Order' : 'أكمل الطلب' },
            { id: 'contact_us_global', title: lang === 'en' ? 'Contact Us' : 'تواصل معنا' },
            { id: 'go_home', title: lang === 'en' ? 'Start Over' : 'من البداية' },
          ],
          client.access_token,
          client.phone_number_id
        );

        // Mark as sent so we don't re-send
        await sql`
          UPDATE conversations
          SET data = jsonb_set(data::jsonb, '{_cartRecoverySent}', 'true')
          WHERE client_id = ${cart.client_id} AND phone = ${cart.phone}
        `;

        emitEvent(client.id, 'message_out', cart.phone, { type: 'cart_recovery' });
        result.sent++;
        console.log(`🛒 Recovery sent to ${maskPhone(cart.phone)}`);

      } catch (error) {
        result.errors.push(`Error for ${maskPhone(row.phone)}: ${error}`);
        console.error('🛒 Cart recovery error:', error);
      }
    }

    return result;

  } catch (error) {
    console.error('❌ Abandoned cart cron error:', error);
    result.errors.push(`Process error: ${error}`);
    return result;
  }
}

/**
 * HTTP handler for cron endpoint.
 * Add route: fastify.post('/cron/abandoned-cart', handleAbandonedCartCron)
 */
export async function handleAbandonedCartCron(request: any, reply: any): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await processAbandonedCarts();
    reply.send({ success: true, ...result });
  } catch (error) {
    console.error('❌ Abandoned cart cron error:', error);
    reply.status(500).send({ success: false, error: String(error) });
  }
}
