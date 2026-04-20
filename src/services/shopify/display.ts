// ============================================================
// SHOPIFY AGENT — Product & cart display (WhatsApp UI rendering)
// ============================================================

import {
  formatPrice,
  type ShopifyProduct
} from '../shopify.js';
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppButtonsWithImage,
  sendWhatsAppList
} from '../whatsapp.js';
import { smartTitle, truncate } from '../../utils/buttons.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem } from './types.js';
import { smartVariantTitle } from './helpers.js';

// ============================================================
// SHOW VARIANT OR PRODUCT VIEW
// If product has multiple variants → ask weight first.
// If single variant → go straight to product view (action buttons).
// ============================================================

export async function showVariantOrProductView(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string,
  product: ShopifyProduct
): Promise<void> {
  const l: string = conv.data._lang || 'ar';
  const availableVariants = product.variants.filter((v: any) => v.available);
  const isMultiVariant = availableVariants.length > 1 && availableVariants.some((v: any) => v.title !== 'Default Title');

  if (isMultiVariant) {
    // Ask for weight/variant before showing action buttons
    const promptText = msg(`*${product.title}*\nاختر الوزن:`, `*${product.title}*\nChoose weight:`, l);
    if (availableVariants.length <= 3) {
      await sendWhatsAppButtons(
        conv.phone,
        promptText,
        availableVariants.map((v: any, i: number) => ({
          id: `var_${i}`,
          title: smartVariantTitle(v.title, v.price, config.currency, 20)
        })),
        accessToken,
        client.phone_number_id
      );
    } else {
      await sendWhatsAppList(
        conv.phone,
        promptText,
        msg('الأوزان', 'Weights', l),
        availableVariants.slice(0, 10).map((v: any, i: number) => ({
          id: `var_${i}`,
          title: smartVariantTitle(v.title, v.price, config.currency, 24)
        })),
        accessToken,
        client.phone_number_id
      );
    }
    conv.data._shopifyState = 'variant_select';
  } else {
    // Single variant — set it and go straight to quantity
    const variant = availableVariants[0] || product.variants[0];
    conv.data._selectedVariant = variant;
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;
    const label = variant?.title && variant.title !== 'Default Title'
      ? `${product.title} — ${variant.title}`
      : product.title;
    await askQuantity(client, conv, config, accessToken, label);
  }
}

// ============================================================
// PRODUCT VIEW — show product with image + action buttons
// ============================================================

export async function showProductView(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string,
  product: ShopifyProduct
): Promise<void> {
  conv.data._selectedProduct = product;

  // Strip trailing Arabic/Western commas from product title
  const displayTitle = product.title.replace(/[،,]\s*$/, '').trim();

  const selectedVariantTitle = conv.data._selectedVariantTitle;
  const variantLabel = selectedVariantTitle && selectedVariantTitle !== 'Default Title'
    ? ` — ${selectedVariantTitle}` : '';

  const price = formatPrice(product.priceMin, config.currency);
  const priceRange = product.priceMax && product.priceMax !== product.priceMin
    ? `${price} — ${formatPrice(product.priceMax, config.currency)}`
    : price;

  // Short real description from Shopify (strip HTML, max 100 chars)
  const cleanDesc = product.description
    ? product.description.replace(/<[^>]*>/g, '').trim().substring(0, 100)
    : '';

  // Low stock warning — show if any available variant has quantityAvailable <= 5
  const allVariants = product.variants || [];
  const lowStockVariant = allVariants.find((v: any) => v.available && typeof (v as any).quantityAvailable === 'number' && (v as any).quantityAvailable <= 5 && (v as any).quantityAvailable > 0);
  const lowStockNote = lowStockVariant ? `\n⚠️ متبقي ${(lowStockVariant as any).quantityAvailable} فقط!` : '';

  const bodyText = `*${displayTitle}${variantLabel}*\n${priceRange}${lowStockNote}${cleanDesc ? '\n\n' + cleanDesc : ''}`;

  // Check if product is already in cart — show cart shortcut if so
  const cart: CartItem[] = conv.data._cart || [];
  const inCart = cart.some(i => i.productId === product.id);
  const pvl: string = conv.data._lang || 'ar';
  const buttons: { id: string; title: string }[] = [
    { id: 'add_to_cart', title: msg('أضف للسلة', 'Add to Cart', pvl) },
    { id: 'back_to_list', title: msg('رجوع', 'Back', pvl) }
  ];
  if (inCart) {
    buttons.push({ id: 'view_cart', title: msg('السلة', 'Cart', pvl) });
  } else {
    buttons.push({ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', pvl) });
  }

  if (product.imageUrl) {
    await sendWhatsAppButtonsWithImage(
      conv.phone,
      product.imageUrl,
      bodyText,
      buttons,
      accessToken,
      client.phone_number_id
    );
  } else {
    await sendWhatsAppButtons(
      conv.phone,
      bodyText,
      buttons,
      accessToken,
      client.phone_number_id
    );
  }

  conv.data._shopifyState = 'product_view';
}

// ============================================================
// PRODUCT LIST (LIST MODE) — name + price
// ============================================================

export async function showProductList(
  client: ClientConfig,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'ما فيه منتجات متوفرة.', accessToken, client.phone_number_id);
    return;
  }

  conv.data._browseMode = 'list';

  const pll: string = conv.data._lang || 'ar';
  const weightRegex = /\s*\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb)\s*/i;

  // Group by base name — "تمر خلاص 500g" + "تمر خلاص 1kg" → one list row showing all weights
  const groups = new Map<string, { products: ShopifyProduct[]; indices: number[] }>();
  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    const baseName = p.title.replace(weightRegex, '').replace(/[،,]\s*$/, '').trim();
    if (!groups.has(baseName)) groups.set(baseName, { products: [], indices: [] });
    groups.get(baseName)!.products.push(p);
    groups.get(baseName)!.indices.push(i);
  }

  const listItems: { id: string; title: string }[] = [];
  for (const [baseName, group] of groups) {
    // Strip trailing Arabic/Western commas from product name
    const cleanName = smartTitle(baseName.replace(/[،,]\s*$/, '').trim(), 24);
    if (group.products.length === 1) {
      listItems.push({
        id: `pick_${group.indices[0]}`,
        title: cleanName
      });
    } else {
      // Multiple weights — just show name, weight selection happens after tap
      const groupId = `pick_group_${group.indices[0]}_${group.indices.slice(1).join('_')}`;
      listItems.push({ id: groupId, title: cleanName });
      if (!conv.data._productGroups) conv.data._productGroups = {};
      conv.data._productGroups[groupId] = group.indices;
    }
  }

  await sendWhatsAppList(
    conv.phone,
    msg('اختر المنتج اللي تبيه:', 'Choose a product:', pll),
    msg('المنتجات', 'Products', pll),
    listItems,
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'catalog';
}

// ============================================================
// PRODUCT NAMES (IMAGE MODE) — names only, no prices
// ============================================================

export async function showProductNames(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  conv.data._browseMode = 'image';
  const ibl: string = conv.data._lang || 'ar';

  if (products.length === 0) {
    await sendWhatsAppMessage(conv.phone, msg('ما فيه منتجات متوفرة.', 'No products available.', ibl), accessToken, client.phone_number_id);
    return;
  }

  // Group products by base name — strip weight suffix so "تمر خلاص 500g" and "تمر خلاص 1kg" become one card
  const weightRegex = /\s*\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb)\s*/i;
  const groups = new Map<string, { products: ShopifyProduct[]; indices: number[] }>();
  for (let i = 0; i < Math.min(products.length, 10); i++) {
    const p = products[i]!;
    const baseName = p.title.replace(weightRegex, '').replace(/[،,]\s*$/, '').trim();
    if (!groups.has(baseName)) groups.set(baseName, { products: [], indices: [] });
    groups.get(baseName)!.products.push(p);
    groups.get(baseName)!.indices.push(i);
  }

  const groupEntries = Array.from(groups.entries());
  for (let g = 0; g < groupEntries.length; g++) {
    const [baseName, group] = groupEntries[g]!;
    const cleanBaseName = baseName.replace(/[،,]\s*$/, '').trim();
    const firstProduct = group.products[0]!;
    const imageUrl = firstProduct.imageUrl;

    // Short description from Shopify (language-aware, strip HTML, max 80 chars)
    const rawDesc = firstProduct.description
      ? firstProduct.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().substring(0, 80)
      : '';
    const descLine = rawDesc ? `\n\n${rawDesc}` : '';

    let bodyText: string;
    let buttons: { id: string; title: string }[];

    if (group.products.length === 1) {
      // Single product — may still have Shopify variants
      const p = group.products[0]!;
      const availableVariants = p.variants.filter(v => v.available);
      const isMultiVariant = availableVariants.length > 1 && availableVariants.some(v => v.title !== 'Default Title');
      const variantLines = isMultiVariant
        ? availableVariants.map(v => `• ${v.title} — ${formatPrice(v.price, config.currency)}`).join('\n')
        : formatPrice(p.priceMin, config.currency);
      bodyText = `*${cleanBaseName}*\n${variantLines}${descLine}`;
      buttons = [
        { id: `pick_${group.indices[0]}`, title: msg('اختر ✅', 'Select ✅', ibl) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ibl) }
      ];
    } else if (group.products.length <= 3) {
      // Multiple separate weight products — weights as direct buttons on the card
      bodyText = `*${cleanBaseName}*${descLine}`;
      buttons = group.products.map((p, j) => {
        const weightMatch = p.title.match(/(\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb))/i);
        const weight = weightMatch ? weightMatch[0].trim() : p.title;
        return { id: `pick_${group.indices[j]}`, title: `${weight} — ${formatPrice(p.priceMin, config.currency)}` };
      });
      // Add home button only if room (< 3 weight buttons); otherwise add text hint
      if (group.products.length < 3) {
        buttons.push({ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ibl) });
      } else {
        bodyText += `\n\n💡 ${msg('اكتب *رئيسية* للرجوع', 'Type *home* to go back', ibl)}`;
      }
    } else {
      // 4+ weight variants — list in body, single select button
      const weightLines = group.products.map(p => {
        const weightMatch = p.title.match(/(\d+\s*(g|kg|ml|l|غرام|كيلو|gr|gm|oz|lb))/i);
        const weight = weightMatch ? weightMatch[0].trim() : p.title;
        return `• ${weight} — ${formatPrice(p.priceMin, config.currency)}`;
      }).join('\n');
      bodyText = `*${cleanBaseName}*\n${weightLines}${descLine}`;
      buttons = [
        { id: `pick_${group.indices[0]}`, title: msg('اختر ✅', 'Select ✅', ibl) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ibl) }
      ];
    }

    if (imageUrl) {
      await sendWhatsAppButtonsWithImage(conv.phone, imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
    } else {
      await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
    }
    if (g < groupEntries.length - 1) await new Promise(r => setTimeout(r, 350));
  }

  conv.data._shopifyState = 'image_browse';
}

// ============================================================
// CART DISPLAY
// ============================================================

export async function showCart(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, 'السلة فاضية.', accessToken, client.phone_number_id);
    conv.data._shopifyState = 'browse_choice';
    return;
  }

  const scl: string = conv.data._lang || 'ar';
  let cartMsg = `*${msg(scl === 'en' ? 'Shopping Cart' : 'سلة التسوق', 'Shopping Cart', scl)}:*\n━━━━━━━━━━━━━━━\n`;
  let total = 0;
  for (let i = 0; i < cart.length; i++) {
    const item = cart[i]!;
    const qty = item.quantity || 1;
    const lineTotal = parseFloat(item.price) * qty;
    total += lineTotal;
    cartMsg += `${i + 1}. ${item.productTitle}`;
    if (item.variantTitle && item.variantTitle !== 'Default Title') {
      cartMsg += ` (${item.variantTitle})`;
    }
    if (qty > 1) cartMsg += ` x${qty}`;
    cartMsg += ` — ${formatPrice(lineTotal.toFixed(2), config.currency)}\n`;
  }
  cartMsg += `━━━━━━━━━━━━━━━\n*${msg('المجموع', 'Total', scl)}: ${formatPrice(total.toFixed(2), config.currency)}*`;

  await sendWhatsAppButtons(
    conv.phone,
    cartMsg,
    [
      { id: 'checkout_now', title: msg('اتمام الطلب ✅', 'Order Now ✅', scl) },
      { id: 'add_more', title: msg('أضف منتج', 'Add Product', scl) },
      { id: 'remove_item', title: msg('حذف منتج', 'Remove Item', scl) }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'cart';
}

export async function showCartForRemoval(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];

  const cfrl: string = conv.data._lang || 'ar';

  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, msg('السلة فاضية.', 'Your cart is empty.', cfrl), accessToken, client.phone_number_id);
    await showProductList(client, conv, config, accessToken);
    return;
  }

  if (cart.length <= 2) {
    // Buttons: up to 2 items + a back button
    await sendWhatsAppButtons(
      conv.phone,
      msg('أي منتج تبي تحذفه؟', 'Which product would you like to remove?', cfrl),
      [
        ...cart.map((item, i) => ({
          id: `remove_${i}`,
          title: truncate(item.productTitle, 20)
        })),
        { id: 'view_cart', title: msg('رجوع للسلة', 'Back to Cart', cfrl) }
      ],
      accessToken,
      client.phone_number_id
    );
  } else {
    // List for 3+ items
    await sendWhatsAppList(
      conv.phone,
      msg('أي منتج تبي تحذفه؟', 'Which product would you like to remove?', cfrl),
      msg('اختر', 'Choose', cfrl),
      cart.map((item, i) => ({
        id: `remove_${i}`,
        title: truncate(item.productTitle, 24)
      })),
      accessToken,
      client.phone_number_id
    );
    await sendWhatsAppMessage(
      conv.phone,
      msg('أو أرسل "رجوع" للإلغاء.', 'Or send "back" to cancel.', cfrl),
      accessToken,
      client.phone_number_id
    );
  }
}

// ============================================================
// QUANTITY ASK — buttons 1, 2, 3
// ============================================================

export async function askQuantity(
  client: ClientConfig,
  conv: ConversationState,
  _config: ShopifyAgentConfig,
  accessToken: string,
  productLabel: string
): Promise<void> {
  const ql: string = conv.data._lang || 'ar';
  await sendWhatsAppButtons(
    conv.phone,
    `*${productLabel}*\n\n${msg('كم الكمية؟\n_(أو اكتب أي رقم)_', 'How many?\n_(or type any number)_', ql)}`,
    [
      { id: 'qty_1', title: '1' },
      { id: 'qty_2', title: '2' },
      { id: 'qty_3', title: '3' }
    ],
    accessToken,
    client.phone_number_id
  );
  conv.data._shopifyState = 'quantity_select';
}

// ============================================================
// SHOW TOP PRODUCTS — sends up to 3 product cards
// ============================================================

export async function showTopProducts(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string,
  topProducts: ShopifyProduct[]
): Promise<void> {
  const allProducts: ShopifyProduct[] = conv.data._products || [];
  const tpl: string = conv.data._lang || 'ar';

  for (let i = 0; i < topProducts.length; i++) {
    const p = topProducts[i]!;
    // Resolve the real index in the master list so pick_N routes correctly
    const masterIdx = allProducts.findIndex(pr => pr.id === p.id);
    const pickId = `pick_${masterIdx >= 0 ? masterIdx : i}`;

    const price = formatPrice(p.priceMin, config.currency);
    const priceRange = p.priceMax && p.priceMax !== p.priceMin
      ? `${price} — ${formatPrice(p.priceMax, config.currency)}`
      : price;

    const bodyText = `*${p.title}*\n${priceRange}`;
    const buttons = [
      { id: pickId, title: msg('اختر ✅', 'Select ✅', tpl) },
      { id: 'pick_direct', title: msg('كل المنتجات', 'All Products', tpl) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', tpl) }
    ];

    if (p.imageUrl) {
      await sendWhatsAppButtonsWithImage(conv.phone, p.imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
    } else {
      await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
    }

    // Small delay to preserve card order on WhatsApp
    if (i < topProducts.length - 1) {
      await new Promise(r => setTimeout(r, 350));
    }
  }

  conv.data._browseMode = 'list';
  conv.data._shopifyState = 'catalog';
}
