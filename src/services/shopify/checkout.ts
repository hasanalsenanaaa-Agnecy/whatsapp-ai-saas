// ============================================================
// SHOPIFY CHECKOUT
// Cart revalidation (drop unavailable items, accept new prices),
// create checkout via Storefront API, send the payment link, and
// transition to awaiting_payment. Pings the owner on failure or
// price mismatch.
// ============================================================

import {
  createCheckout,
  createMultiItemCheckout,
  formatPrice,
} from '../shopify.js';
import { sendWhatsAppMessage } from '../whatsapp.js';
import { emitEvent } from '../events.js';
import { trackClientError } from '../alerts.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem } from './types.js';
import { fetchProductsCached, phoneToCountryCode, formatCartLine } from './helpers.js';
import { showProductList, showCart } from './display.js';
import { notifyOwner } from './notify.js';

export async function processCheckout(
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

  // Guard against double-tap: if a checkout is already in progress,
  // ignore this tap — but treat the flag as stale after 30 seconds so a
  // hung/crashed prior attempt doesn't lock the customer out forever
  // (fgf.md #20). 30s is well above the worst-case Shopify checkout call.
  const CHECKOUT_LOCK_TIMEOUT_MS = 30_000;
  const lockStartedAt = conv.data._checkoutInProgressAt as number | undefined;
  if (conv.data._checkoutInProgress && lockStartedAt && Date.now() - lockStartedAt < CHECKOUT_LOCK_TIMEOUT_MS) {
    return;
  }
  conv.data._checkoutInProgress = true;
  conv.data._checkoutInProgressAt = Date.now();

  const pcl: string = conv.data._lang || 'ar';
  await sendWhatsAppMessage(conv.phone, msg('جاري تجهيز طلبك...', 'Preparing your order...', pcl), accessToken, client.phone_number_id);

  // ─── Cart revalidation (#20) — refuse to checkout stale carts
  // Re-fetch products and check each cart item is still available at the same price.
  const freshProducts = await fetchProductsCached(config.domain, config.storefrontToken, conv.data._lang || 'ar');
  const removedTitles: string[] = [];
  const changedLines: string[] = [];
  const validCart: CartItem[] = [];
  for (const item of cart) {
    const prod = freshProducts.find(p => p.id === item.productId);
    const variant = prod?.variants.find(v => v.id === item.variantId);
    if (!prod || !variant || !variant.available) {
      removedTitles.push(item.productTitle + (item.variantTitle && item.variantTitle !== 'Default Title' ? ` (${item.variantTitle})` : ''));
      continue;
    }
    if (variant.price !== item.price) {
      changedLines.push(`• ${item.productTitle}${item.variantTitle && item.variantTitle !== 'Default Title' ? ` (${item.variantTitle})` : ''}: ${formatPrice(item.price, config.currency)} → ${formatPrice(variant.price, config.currency)}`);
      item.price = variant.price;
    }
    validCart.push(item);
  }
  if (removedTitles.length > 0 || changedLines.length > 0) {
    conv.data._cart = validCart;
    let notice = msg('⚠️ تحديث على سلتك قبل الدفع:', '⚠️ Cart updated before checkout:', pcl);
    if (removedTitles.length > 0) {
      notice += '\n\n' + msg('تم حذف المنتجات التالية (غير متوفرة):', 'Removed (no longer available):', pcl);
      notice += '\n' + removedTitles.map(t => `• ${t}`).join('\n');
    }
    if (changedLines.length > 0) {
      notice += '\n\n' + msg('تغيرت الأسعار:', 'Prices changed:', pcl);
      notice += '\n' + changedLines.join('\n');
    }
    await sendWhatsAppMessage(conv.phone, notice, accessToken, client.phone_number_id);
    conv.data._checkoutInProgress = false;
    if (validCart.length === 0) {
      await sendWhatsAppMessage(conv.phone, msg('السلة فاضية الآن. اختر منتج جديد.', 'Your cart is now empty. Please pick a new product.', pcl), accessToken, client.phone_number_id);
      await showProductList(client, conv, config, accessToken);
      return;
    }
    // Re-show cart so the customer confirms the new totals before checkout
    conv.data._shopifyState = 'cart';
    await showCart(client, conv, config, accessToken);
    return;
  }

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
    await trackClientError(client, 'Shopify Checkout', new Error('Checkout creation failed'));
    return;
  }

  delete conv.data._checkoutInProgress; // checkout created — no longer needed

  // Calculate cart total from our local cart (source of truth) — with quantities
  const cartTotal = cart.reduce((sum: number, i: CartItem) => sum + parseFloat(i.price) * (i.quantity || 1), 0);
  const cartTotalStr = cartTotal.toFixed(2);

  // Alert owner + warn customer if Shopify price differs significantly (>1%)
  // — discount/bundle/tax; customer shouldn't be surprised at the checkout page.
  let mismatchNote = '';
  if (checkout.totalPrice) {
    const shopifyTotal = parseFloat(checkout.totalPrice);
    const diffPct = Math.abs(shopifyTotal - cartTotal) / cartTotal;
    if (diffPct > 0.01) {
      console.warn(`⚠️ Price mismatch: Shopify=${checkout.totalPrice}, Cart=${cartTotalStr} (${(diffPct * 100).toFixed(1)}%)`);
      await notifyOwner(client, conv, config, 'urgent', accessToken);
      const shopifyPriceStr = formatPrice(checkout.totalPrice, checkout.currency);
      mismatchNote = msg(
        `\n\n⚠️ ملاحظة: المبلغ الفعلي على صفحة الدفع هو ${shopifyPriceStr} (قد يشمل ضريبة/شحن/خصم).`,
        `\n\n⚠️ Note: the actual amount on the checkout page is ${shopifyPriceStr} (may include tax/shipping/discount).`,
        pcl
      );
    }
  }

  conv.data._checkout = {
    url: checkout.checkoutUrl,
    totalPrice: cartTotalStr,  // Use cart-calculated total, not Shopify API
    currency: checkout.currency
  };
  emitEvent(client.id, 'checkout_created', conv.phone, {
    items: cart.length,
    total: cartTotalStr,
    currency: checkout.currency,
    products: cart.map((i: any) => ({ title: i.productTitle, variant: i.variantTitle, qty: i.quantity || 1, price: i.price }))
  });

  // Build cart summary for payment message
  const cartSummary = cart
    .map(item => formatCartLine(item, checkout.currency))
    .join('\n') + '\n';

  const price = formatPrice(cartTotalStr, checkout.currency);

  // Single message: order summary + payment link — no buttons, webhook confirms payment
  const nameGreet = conv.data.name ? (pcl === 'en' ? ` ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  const paymentMsg = msg(
    `تمام${nameGreet}! هذي تفاصيل طلبك:\n\n${cartSummary}\n*المجموع: ${price}*${mismatchNote}\n\n💳 رابط الدفع:\n${checkout.checkoutUrl}\n\nبعد إتمام الدفع، بنأكدلك تلقائياً ✅`,
    `Great${nameGreet}! Here are your order details:\n\n${cartSummary}\n*Total: ${price}*${mismatchNote}\n\n💳 Payment link:\n${checkout.checkoutUrl}\n\nWe'll confirm your payment automatically ✅`,
    pcl
  );
  await sendWhatsAppMessage(conv.phone, paymentMsg, accessToken, client.phone_number_id);
  conv.messages.push({ role: 'assistant', content: paymentMsg });

  conv.data._checkoutSentAt = new Date().toISOString();
  conv.data._shopifyState = 'awaiting_payment';
}
