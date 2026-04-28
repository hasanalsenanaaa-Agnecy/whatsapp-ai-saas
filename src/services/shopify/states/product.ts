// ============================================================
// SHOPIFY STATES — product_view + variant_select + quantity_select
// Variant pick → quantity pick → add-to-cart. Each step routes
// product questions to AI before re-rendering the picker so
// customers can ask mid-flow without losing the buttons.
// ============================================================

import { sendWhatsAppMessage } from '../../whatsapp.js';
import { type ShopifyProduct } from '../../shopify.js';
import { normalizeArabicNumbers } from '../../../utils/buttons.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState } from '../types.js';
import {
  matchVariant,
  isQuestionMessage,
  shouldSilence,
  shouldSendHint,
  markReprompted,
  markHinted,
  addToCart,
} from '../helpers.js';
import {
  showProductView,
  showProductList,
  showProductNames,
  showVariantOrProductView,
  showProductWithQty,
  showCart,
  sendHomeHint,
} from '../display.js';
import { tryAIAnswer } from '../ai.js';
import { notifyOwner } from '../notify.js';

export async function handleProductView(
  client: ClientConfig,
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
    // Variant already selected upstream — go straight to qty (with image)
    const variant = conv.data._selectedVariant || product.variants[0];
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;
    await showProductWithQty(client, conv, config, accessToken, product);
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

  // Try AI for product questions, then re-show the action buttons
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) {
      await showProductView(client, conv, config, accessToken, product);
      return;
    }
  }

  // Unrecognized — reprompt → hint → silence
  if (shouldSilence(conv)) return;
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  await showProductView(client, conv, config, accessToken, product);
  markReprompted(conv);
}

export async function handleVariantSelect(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const product: ShopifyProduct = conv.data._selectedProduct;
  const availableVariants = product.variants.filter((v: any) => v.available);

  const variant = matchVariant(message, availableVariants);
  if (!variant) {
    // Customer typed a question instead of picking a size/variant — e.g.
    // "what's the difference between small and large?". Answer it, then
    // re-show the variant card so they can still pick (fgf.md #40).
    if (isQuestionMessage(message)) {
      const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
      if (aiHandled) {
        await showVariantOrProductView(client, conv, config, accessToken, product);
        return;
      }
    }
    const vsl: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('اختر من الخيارات المتاحة 👇', 'Please choose from the available options 👇', vsl), accessToken, client.phone_number_id);
    // Re-render the variant card so the buttons are within reach instead of
    // forcing the customer to scroll back up the chat.
    await showVariantOrProductView(client, conv, config, accessToken, product);
    return;
  }

  conv.data._selectedVariant = variant;
  conv.data._selectedVariantId = variant.id;
  conv.data._selectedVariantTitle = variant.title;
  // Variant chosen — show product card again with qty buttons (image stays visible)
  await showProductWithQty(client, conv, config, accessToken, product);
}

export async function handleQuantitySelect(
  client: ClientConfig,
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
  const qtyl: string = conv.data._lang || 'ar';
  if (isNaN(qty) || qty < 1) {
    // Question during quantity pick ("كم السعر للكيلو؟") — answer and
    // re-show the quantity card instead of silencing (fgf.md #40).
    if (isQuestionMessage(message)) {
      const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
      if (aiHandled) {
        const prod: ShopifyProduct = conv.data._selectedProduct;
        if (prod) await showProductWithQty(client, conv, config, accessToken, prod);
        return;
      }
    }
    await sendWhatsAppMessage(conv.phone, msg('اكتب رقم الكمية (مثال: 1، 2، 3) 👇', 'Enter a quantity (e.g. 1, 2, 3) 👇', qtyl), accessToken, client.phone_number_id);
    // Re-render the qty buttons so the customer can tap instead of typing.
    const prodRetry: ShopifyProduct = conv.data._selectedProduct;
    if (prodRetry) await showProductWithQty(client, conv, config, accessToken, prodRetry);
    return;
  }
  if (qty > MAX_QTY) {
    await sendWhatsAppMessage(conv.phone, msg(`الحد الأقصى ${MAX_QTY} قطعة. اكتب كمية أقل.`, `Maximum quantity is ${MAX_QTY}. Please enter a smaller amount.`, qtyl), accessToken, client.phone_number_id);
    const prodMax: ShopifyProduct = conv.data._selectedProduct;
    if (prodMax) await showProductWithQty(client, conv, config, accessToken, prodMax);
    return;
  }

  const product: ShopifyProduct = conv.data._selectedProduct;
  if (!product) {
    await showProductList(client, conv, config, accessToken);
    return;
  }
  const variant = conv.data._selectedVariant || product.variants[0];

  // Add to cart with quantity
  const wasEmpty = (conv.data._cart || []).length === 0;
  addToCart(conv, product, variant?.id, variant?.title, variant?.price || product.priceMin, qty);

  // Refund the AI budget once per session when the customer first adds to
  // cart — they've shown purchase intent, and cart/payment-stage questions
  // ("when does it arrive?", "can I pay on delivery?") are higher-leverage
  // than browse chatter. Without this, a chatty browser could exhaust the
  // 6-question budget before ever reaching checkout (critique #15).
  if (wasEmpty && !conv.data._aiBudgetRefunded) {
    conv.data._aiAnswerCount = 0;
    conv.data._aiExhaustedNotified = false;
    conv.data._aiBudgetRefunded = true;
  }


  const itemLabel = variant?.title && variant.title !== 'Default Title'
    ? `${product.title} (${variant.title})`
    : product.title;
  const qtyLabel = qty > 1 ? ` x${qty}` : '';
  const cartl: string = conv.data._lang || 'ar';

  conv.messages.push({ role: 'assistant', content: `Added ${itemLabel} x${qty} to cart` });

  // Go to cart — prefix tells the customer what was just added
  const justAdded = `✅ ${msg('تمت الإضافة', 'Added', cartl)}: *${itemLabel}*${qtyLabel}`;
  await showCart(client, conv, config, accessToken, justAdded);
}
