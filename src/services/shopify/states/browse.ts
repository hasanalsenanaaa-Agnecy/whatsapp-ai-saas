// ============================================================
// SHOPIFY STATES — browse_choice + image_browse + catalog
// All three browse modes share: AI-first for question-form input,
// "best of" top-3 cards for navigation queries, pattern matcher
// fallback, and the reprompt → hint → silence cadence.
// ============================================================

import { sendWhatsAppButtons, sendWhatsAppButtonsWithImage, sendWhatsAppList } from '../../whatsapp.js';
import { formatPrice, type ShopifyProduct } from '../../shopify.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, wa, type ShopifyAgentConfig, type ConversationState } from '../types.js';
import {
  matchProduct,
  tryAnswerProductQuestion,
  getTopProductsByQuery,
  isQuestionMessage,
  shouldSilence,
  shouldSendHint,
  markReprompted,
  markHinted,
  WEIGHT_STRIP_REGEX,
  WEIGHT_MATCH_REGEX,
} from '../helpers.js';
import {
  showProductList,
  showProductNames,
  showVariantOrProductView,
  showTopProducts,
  showCart,
  sendHomeHint,
} from '../display.js';
import { tryAIAnswer } from '../ai.js';
import { notifyOwner } from '../notify.js';
import { processCheckout } from '../checkout.js';

export async function handleBrowseChoice(
  client: ClientConfig,
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

  // Question form → AI first (fgf.md #41). "وش أفضل منتج؟" is a question and
  // deserves a real answer, not 3 best-seller cards. Only fall through to the
  // pattern matcher when the message is a bare navigation keyword ("الأفضل").
  if (isQuestionMessage(message)) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
  }

  // "Best of" queries — navigation intent, show top 3 cards (not a text answer)
  const topProducts = getTopProductsByQuery(message, products);
  if (topProducts.length > 0) {
    conv.data._reprompted = null;
    await showTopProducts(client, conv, config, accessToken, topProducts);
    return;
  }

  // Pattern-based product navigation (non-question intent: "الأرخص", "الأفضل" as nav, not inquiry)
  const questionMatch = tryAnswerProductQuestion(message, products, config.currency);
  if (questionMatch) {
    conv.data._reprompted = null;
    conv.data._selectedProduct = questionMatch;
    conv.data._browseMode = 'list';
    await showVariantOrProductView(client, conv, config, accessToken, questionMatch);
    return;
  }

  // Non-question unmatched — try AI as fallback before reprompt/silence
  const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
  if (aiHandled) return;

  // Reprompt → hint → silence
  if (shouldSilence(conv)) return;
  const l2: string = conv.data._lang || 'ar';
  if (shouldSendHint(conv)) {
    await sendHomeHint(client, conv, accessToken);
    markHinted(conv);
    return;
  }
  const repromptName = conv.data.name ? (l2 === 'en' ? `, ${conv.data.name}` : ` يا ${conv.data.name}`) : '';
  await sendWhatsAppButtons(
    conv.phone,
    msg(`كيف تبي تتصفح *${wa(config.storeName)}*${repromptName}؟`, `How would you like to browse *${wa(config.storeName)}*${repromptName}?`, l2),
    [
      { id: 'show_images', title: msg('شوف الصور', 'View Images', l2) },
      { id: 'pick_direct', title: msg('قائمة المنتجات', 'Product List', l2) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l2) }
    ],
    accessToken,
    client.phone_number_id
  );
  markReprompted(conv);
}

export async function handleImageBrowse(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];

  let selected = matchProduct(message, products);

  // Question form → AI first, so they get a real answer instead of a
  // pattern-guessed product card (fgf.md #41, AI-2/9). Only fall through to
  // the "Best of" pattern matcher when it's a bare navigation keyword.
  if (!selected && isQuestionMessage(message)) {
    const aiFirst = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiFirst) return;
  }

  // "Best of" queries — show top 3 cards with images
  if (!selected) {
    const topProducts = getTopProductsByQuery(message, products);
    if (topProducts.length > 0) {
      conv.data._reprompted = null;
      await showTopProducts(client, conv, config, accessToken, topProducts);
      return;
    }
  }

  if (!selected) selected = tryAnswerProductQuestion(message, products, config.currency);

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    if (shouldSendHint(conv)) {
      await sendHomeHint(client, conv, accessToken);
      markHinted(conv);
      return;
    }
    await showProductNames(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
  conv.data._selectedProduct = selected;
  await showVariantOrProductView(client, conv, config, accessToken, selected);
}

export async function handleCatalogSelection(
  client: ClientConfig,
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

  // Grouped product selection — show weight options. WhatsApp buttons cap
  // at 3, so groups with 4+ weights previously dropped the rest silently.
  // Fall back to a list picker (up to 10 rows) when the group overflows.
  if (trimmed.startsWith('pick_group_')) {
    const groupIndices: number[] | undefined = conv.data._productGroups?.[trimmed];
    if (groupIndices && groupIndices.length > 0) {
      const groupProducts = groupIndices.map((i: number) => products[i]).filter(Boolean) as ShopifyProduct[];
      const gl: string = conv.data._lang || 'ar';
      const baseName = groupProducts[0]!.title.replace(WEIGHT_STRIP_REGEX, '').trim();
      const bodyText = `*${wa(baseName)}*\n${msg('اختر الوزن:', 'Choose weight:', gl)}`;
      const imageUrl = groupProducts[0]!.imageUrl;

      if (groupProducts.length <= 3) {
        const buttons = groupProducts.map((p, j) => {
          const wm = p.title.match(WEIGHT_MATCH_REGEX);
          const weight = wm ? wm[0].trim() : p.title;
          return { id: `pick_${groupIndices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
        });
        if (buttons.length < 3) buttons.push({ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', gl) });
        if (imageUrl) {
          await sendWhatsAppButtonsWithImage(conv.phone, imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
        } else {
          await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
        }
      } else {
        const rows = groupProducts.slice(0, 10).map((p, j) => {
          const wm = p.title.match(WEIGHT_MATCH_REGEX);
          const weight = wm ? wm[0].trim() : p.title;
          return { id: `pick_${groupIndices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
        });
        await sendWhatsAppList(
          conv.phone,
          bodyText,
          msg('الأوزان', 'Weights', gl),
          rows,
          accessToken,
          client.phone_number_id
        );
      }
      return;
    }
  }

  // Try direct product name match
  let selected = matchProduct(message, products);

  // Question form → AI first, ahead of pattern matcher (fgf.md #41).
  if (!selected && isQuestionMessage(message)) {
    const aiFirst = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiFirst) return;
  }

  // "Best of" queries — show top 3 product cards with image + price + CTA
  if (!selected) {
    const topProducts = getTopProductsByQuery(message, products);
    if (topProducts.length > 0) {
      conv.data._reprompted = null;
      await showTopProducts(client, conv, config, accessToken, topProducts);
      return;
    }
  }

  // Try pattern-based question if no direct match (single-product fallback)
  if (!selected) {
    selected = tryAnswerProductQuestion(message, products, config.currency);
  }

  if (!selected) {
    const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
    if (aiHandled) return;
    if (shouldSilence(conv)) return;
    if (shouldSendHint(conv)) {
      await sendHomeHint(client, conv, accessToken);
      markHinted(conv);
      return;
    }
    await showProductList(client, conv, config, accessToken);
    markReprompted(conv);
    return;
  }

  conv.data._reprompted = null;
  conv.data._selectedProduct = selected;
  await showVariantOrProductView(client, conv, config, accessToken, selected);
}
