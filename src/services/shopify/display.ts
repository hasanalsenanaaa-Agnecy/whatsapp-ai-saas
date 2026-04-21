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
  sendWhatsAppImage,
  sendWhatsAppList
} from '../whatsapp.js';
import { smartTitle, truncate } from '../../utils/buttons.js';
import type { ClientConfig } from '../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState, type CartItem } from './types.js';
import { smartVariantTitle, cleanDescription, WEIGHT_STRIP_REGEX, WEIGHT_MATCH_REGEX } from './helpers.js';

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
  conv.data._selectedProduct = product;
  const l: string = conv.data._lang || 'ar';
  const availableVariants = product.variants.filter((v: any) => v.available);
  const isMultiVariant = availableVariants.length > 1 && availableVariants.some((v: any) => v.title !== 'Default Title');

  if (isMultiVariant) {
    // Multi-variant: show product view (image + desc + price range) with weight picker
    const displayTitle = product.title.replace(/[،,]\s*$/, '').trim();
    const price = formatPrice(product.priceMin, config.currency);
    const priceRange = product.priceMax && product.priceMax !== product.priceMin
      ? `${price} — ${formatPrice(product.priceMax, config.currency)}`
      : price;
    const desc = cleanDescription(product.description, 100);
    const pickPrompt = msg('اختر الوزن:', 'Choose weight:', l);
    const bodyText = `*${displayTitle}*\n${priceRange}${desc ? '\n\n' + desc : ''}\n\n${pickPrompt}`;

    if (availableVariants.length <= 3) {
      const buttons = availableVariants.map((v: any, i: number) => ({
        id: `var_${i}`,
        title: smartVariantTitle(v.title, v.price, config.currency, 20)
      }));
      if (product.imageUrl) {
        await sendWhatsAppButtonsWithImage(conv.phone, product.imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
      } else {
        await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
      }
    } else {
      // 4+ variants: image + caption first (WhatsApp lists don't support image headers), then the list
      if (product.imageUrl) {
        await sendWhatsAppImage(conv.phone, product.imageUrl, `*${displayTitle}*\n${priceRange}${desc ? '\n\n' + desc : ''}`, accessToken, client.phone_number_id);
      }
      await sendWhatsAppList(
        conv.phone,
        pickPrompt,
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
    // Single variant — go straight to qty screen (keeps product image + desc visible)
    const variant = availableVariants[0] || product.variants[0];
    conv.data._selectedVariant = variant;
    conv.data._selectedVariantId = variant?.id;
    conv.data._selectedVariantTitle = variant?.title;
    await showProductWithQty(client, conv, config, accessToken, product);
  }
}

// ============================================================
// PRODUCT WITH QTY — full product card (image + desc + price)
// with [qty_1, qty_2, qty_3] buttons. Used after variant pick
// or for single-variant products, so image stays visible through
// the add-to-cart decision.
// ============================================================

export async function showProductWithQty(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  accessToken: string,
  product: ShopifyProduct
): Promise<void> {
  conv.data._selectedProduct = product;
  const l: string = conv.data._lang || 'ar';

  const displayTitle = product.title.replace(/[،,]\s*$/, '').trim();
  const selectedVariantTitle = conv.data._selectedVariantTitle;
  const variantLabel = selectedVariantTitle && selectedVariantTitle !== 'Default Title'
    ? ` — ${selectedVariantTitle}` : '';

  // Use selected variant's actual price when available
  const variant = conv.data._selectedVariant;
  const unitPrice = variant?.price || product.priceMin;
  const price = formatPrice(unitPrice, config.currency);

  // Low-stock warning scoped to the selected variant only
  const stockQty = variant && typeof (variant as any).quantityAvailable === 'number'
    ? (variant as any).quantityAvailable
    : null;
  const lowStockNote = (stockQty !== null && stockQty > 0 && stockQty <= 5)
    ? `\n⚠️ ${msg(`متبقي ${stockQty} فقط!`, `Only ${stockQty} left!`, l)}`
    : '';

  const desc = cleanDescription(product.description, 100);
  const qtyPrompt = msg('كم الكمية؟\n_(أو اكتب أي رقم)_', 'How many?\n_(or type any number)_', l);

  const bodyText = `*${displayTitle}${variantLabel}*\n${price}${lowStockNote}${desc ? '\n\n' + desc : ''}\n\n${qtyPrompt}`;

  const buttons = [
    { id: 'qty_1', title: '1' },
    { id: 'qty_2', title: '2' },
    { id: 'qty_3', title: '3' }
  ];

  if (product.imageUrl) {
    await sendWhatsAppButtonsWithImage(conv.phone, product.imageUrl, bodyText, buttons, accessToken, client.phone_number_id);
  } else {
    await sendWhatsAppButtons(conv.phone, bodyText, buttons, accessToken, client.phone_number_id);
  }

  conv.data._shopifyState = 'quantity_select';
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

  const cleanDesc = cleanDescription(product.description, 100);

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
  config: ShopifyAgentConfig,
  accessToken: string
): Promise<void> {
  const products: ShopifyProduct[] = conv.data._products || [];
  if (products.length === 0) {
    const l: string = conv.data._lang || 'ar';
    await sendWhatsAppMessage(conv.phone, msg('ما فيه منتجات متوفرة.', 'No products are currently available.', l), accessToken, client.phone_number_id);
    return;
  }

  conv.data._browseMode = 'list';

  const pll: string = conv.data._lang || 'ar';

  // Group by base name — "تمر خلاص 500g" + "تمر خلاص 1kg" → one list row showing all weights
  const groups = new Map<string, { products: ShopifyProduct[]; indices: number[] }>();
  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    const baseName = p.title.replace(WEIGHT_STRIP_REGEX, '').replace(/[،,]\s*$/, '').trim();
    if (!groups.has(baseName)) groups.set(baseName, { products: [], indices: [] });
    groups.get(baseName)!.products.push(p);
    groups.get(baseName)!.indices.push(i);
  }

  const listItems: { id: string; title: string; description?: string }[] = [];
  for (const [baseName, group] of groups) {
    // Strip trailing Arabic/Western commas from product name
    const cleanName = smartTitle(baseName.replace(/[،,]\s*$/, '').trim(), 24);
    if (group.products.length === 1) {
      const p = group.products[0]!;
      const minPrice = formatPrice(p.priceMin, config.currency);
      const priceStr = p.priceMax && p.priceMax !== p.priceMin
        ? `${minPrice} — ${formatPrice(p.priceMax, config.currency)}`
        : minPrice;
      listItems.push({
        id: `pick_${group.indices[0]}`,
        title: cleanName,
        description: priceStr
      });
    } else {
      // Multiple weights — show count + price range so customer sees value before tap
      const nums = group.products.map(p => parseFloat(p.priceMin));
      const minStr = formatPrice(Math.min(...nums).toFixed(2), config.currency);
      const maxStr = formatPrice(Math.max(...nums).toFixed(2), config.currency);
      const priceRange = minStr === maxStr ? minStr : `${minStr} — ${maxStr}`;
      const weightsWord = msg('أوزان', 'weights', pll);
      const description = `${group.products.length} ${weightsWord} · ${priceRange}`;

      const groupId = `pick_group_${group.indices[0]}_${group.indices.slice(1).join('_')}`;
      listItems.push({ id: groupId, title: cleanName, description });
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

  // Group products by base name — strip weight suffix so "تمر خلاص 500g" and "تمر خلاص 1kg" become one card.
  // Group ALL products (not just first 10), then cap the rendered group count — otherwise stores with >10
  // products have some invisible in image mode (fgf.md #13).
  const groups = new Map<string, { products: ShopifyProduct[]; indices: number[] }>();
  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    const baseName = p.title.replace(WEIGHT_STRIP_REGEX, '').replace(/[،,]\s*$/, '').trim();
    if (!groups.has(baseName)) groups.set(baseName, { products: [], indices: [] });
    groups.get(baseName)!.products.push(p);
    groups.get(baseName)!.indices.push(i);
  }

  // Hard cap: WhatsApp tolerates ~12 cards in a row without feeling like spam.
  // If more groups exist, nudge the customer to the text-based list instead.
  const MAX_IMAGE_GROUPS = 12;
  const allGroupEntries = Array.from(groups.entries());
  const hasMoreGroups = allGroupEntries.length > MAX_IMAGE_GROUPS;
  const groupEntries = allGroupEntries.slice(0, MAX_IMAGE_GROUPS);
  for (let g = 0; g < groupEntries.length; g++) {
    const [baseName, group] = groupEntries[g]!;
    const cleanBaseName = baseName.replace(/[،,]\s*$/, '').trim();
    const firstProduct = group.products[0]!;
    const imageUrl = firstProduct.imageUrl;

    const rawDesc = cleanDescription(firstProduct.description, 80);
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
        const weightMatch = p.title.match(WEIGHT_MATCH_REGEX);
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
        const weightMatch = p.title.match(WEIGHT_MATCH_REGEX);
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

  // Nudge to text list if some groups weren't rendered
  if (hasMoreGroups) {
    const remaining = allGroupEntries.length - MAX_IMAGE_GROUPS;
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `+${remaining} منتجات إضافية. للاطلاع على القائمة الكاملة:`,
        `+${remaining} more products. For the full list:`,
        ibl
      ),
      [
        { id: 'pick_direct', title: msg('القائمة الكاملة', 'Full List', ibl) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ibl) }
      ],
      accessToken,
      client.phone_number_id
    );
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
  accessToken: string,
  prefix?: string
): Promise<void> {
  const cart: CartItem[] = conv.data._cart || [];
  const scl: string = conv.data._lang || 'ar';

  if (cart.length === 0) {
    await sendWhatsAppMessage(conv.phone, msg('السلة فاضية.', 'Your cart is empty.', scl), accessToken, client.phone_number_id);
    conv.data._shopifyState = 'browse_choice';
    return;
  }

  let cartMsg = prefix ? `${prefix}\n\n` : '';
  cartMsg += `*${msg('سلة التسوق', 'Shopping Cart', scl)}:*\n━━━━━━━━━━━━━━━\n`;
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
  cartMsg += `\n\n💡 ${msg('اكتب *حذف* لإزالة منتج', 'Type *remove* to remove an item', scl)}`;

  await sendWhatsAppButtons(
    conv.phone,
    cartMsg,
    [
      { id: 'checkout_now', title: msg('اتمام الطلب ✅', 'Order Now ✅', scl) },
      { id: 'add_more', title: msg('أضف منتج', 'Add Product', scl) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', scl) }
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

    const desc = cleanDescription(p.description, 100);
    const bodyText = `*${p.title}*\n${priceRange}${desc ? '\n\n' + desc : ''}`;
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

// ============================================================
// SEND BACK-TO-HOME HINT
// Middle step of the reprompt → hint → silence pattern. Sends a
// one-button "Home 🏠" card so the customer taps instead of having
// to type *رئيسية* / *home* themselves.
// ============================================================

export async function sendHomeHint(
  client: ClientConfig,
  conv: ConversationState,
  accessToken: string
): Promise<void> {
  const l: string = conv.data._lang || 'ar';
  await sendWhatsAppButtons(
    conv.phone,
    msg(
      '💡 تبي ترجع للقائمة الرئيسية؟',
      '💡 Want to go back to the main menu?',
      l
    ),
    [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
    accessToken,
    client.phone_number_id
  );
}
