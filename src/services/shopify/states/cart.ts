// ============================================================
// SHOPIFY STATES — cart + cart_remove
// Add-more / remove / checkout buttons, AI-answered questions
// mid-cart (then re-show cart so the checkout button stays in
// reach), and remove-by-index for cart_remove.
// ============================================================

import { sendWhatsAppMessage } from '../../whatsapp.js';
import { normalizeArabicNumbers } from '../../../utils/buttons.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem } from '../types.js';
import {
  isQuestionMessage,
  shouldSilence,
  shouldSendHint,
  markReprompted,
  markHinted,
} from '../helpers.js';
import {
  showProductList,
  showCart,
  showCartForRemoval,
  sendHomeHint,
} from '../display.js';
import { tryAIAnswer } from '../ai.js';
import { notifyOwner } from '../notify.js';
import { processCheckout } from '../checkout.js';

export async function handleCart(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // Add more products — respect the mode they originally picked. On
  // session resume `_browseMode` can be missing (older conversations
  // didn't set it), so silently defaulting to list regresses image-browse
  // users. When unknown, re-show the browse-choice picker instead.
  if (lower === 'add_more' || lower === 'تسوق' || lower === 'تسوق أكثر'
    || lower.includes('أضف منتج') || lower.includes('ضيف منتج') || lower.includes('زيد منتج')
    || lower.includes('أضف أكثر') || lower.includes('تسوق أكثر')) {
    // Always use the compact product list for add-more — re-dumping the
    // full image gallery is spammy when the customer already picked once.
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
    || lower.includes('اتمام الطلب') || lower.includes('اتمام')
    || lower.includes('ادفع') || lower.includes('أطلب الآن') || lower.includes('أطلب الان')) {
    await processCheckout(client, conv, config, accessToken);
    return;
  }

  // View cart (re-show)
  if (lower === 'view_cart') {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Try AI answer (product questions mid-cart) before reprompt.
  // After an AI answer in cart state, re-show the cart menu so the
  // checkout button stays within reach (AI-8).
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) {
    await showCart(client, conv, config, accessToken);
    return;
  }

  // Didn't understand — reprompt → hint → silence
  if (shouldSilence(conv)) return;
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  await showCart(client, conv, config, accessToken);
  markReprompted(conv);
}

export async function handleCartRemove(
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
    conv.data._cartUpdatedAt = new Date().toISOString();
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

  // Question during remove-item prompt — answer, then re-show removal
  // menu so they can still pick an item (fgf.md #40).
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) {
      await showCartForRemoval(client, conv, config, accessToken);
      return;
    }
  }

  // Re-show removal options
  await showCartForRemoval(client, conv, config, accessToken);
}
