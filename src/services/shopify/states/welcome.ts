// ============================================================
// SHOPIFY STATE — welcome
// Language → consent → intent menu → cart resume → product fetch.
// Branches into order_status / customer_service for non-buy intents.
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons } from '../../whatsapp.js';
import { type ShopifyProduct } from '../../shopify.js';
import { trackClientError } from '../../alerts.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, wa, type ShopifyAgentConfig, type ConversationState, type CartItem } from '../types.js';
import {
  fetchProductsWithStatus,
  loadProductsIfNeeded,
  matchProduct,
  isQuestionMessage,
  resetCurrentOrder,
  formatCartLine,
} from '../helpers.js';
import { showCart, showVariantOrProductView } from '../display.js';
import { tryAIAnswer } from '../ai.js';
import { notifyOwner } from '../notify.js';
import { handleOrderStatus, handleCustomerService } from './order.js';

export async function handleWelcome(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const lower = message.toLowerCase().trim();

  // STEP 1: Language selection
  const lang: string | undefined = conv.data._lang;
  if (!lang) {
    if (!conv.data._langAsked) {
      const nameParts = config.storeName.split(' | ');
      const nameAr = nameParts.length > 1 ? nameParts[1] : config.storeName;
      const nameEn = nameParts[0];
      await sendWhatsAppButtons(
        conv.phone,
        `أهلاً بك في *${wa(nameAr)}*! 🌴\nWelcome to *${wa(nameEn)}*! 🌴\n\n🌐 اختر لغتك / Choose your language`,
        [
          { id: 'lang_ar', title: 'العربية' },
          { id: 'lang_en', title: 'English' }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._langAsked = true;
      return;
    }
    const isArabic = lower === 'lang_ar' || lower.includes('عرب') || lower.includes('arabic') || lower === 'ar';
    const isEnglish = lower === 'lang_en' || lower.includes('english') || lower.includes('انجليزي') || lower.includes('إنجليزي') || lower === 'en';
    if (isArabic) {
      conv.data._lang = 'ar';
    } else if (isEnglish) {
      conv.data._lang = 'en';
    } else {
      const nameParts2 = config.storeName.split(' | ');
      const nameAr2 = nameParts2.length > 1 ? nameParts2[1] : config.storeName;
      const nameEn2 = nameParts2[0];
      await sendWhatsAppButtons(
        conv.phone,
        `أهلاً بك في *${wa(nameAr2)}*! 🌴\nWelcome to *${wa(nameEn2)}*! 🌴\n\n🌐 اختر لغتك / Choose your language`,
        [
          { id: 'lang_ar', title: 'العربية' },
          { id: 'lang_en', title: 'English' }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  const l: string = conv.data._lang || 'ar';

  // STEP 2: PDPL consent (one-time)
  if (!conv.data._consentGiven) {
    if (!conv.data._consentAsked) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'نحفظ بيانات محادثتك لمعالجة طلبك. بالاستمرار أنت توافق على سياسة الخصوصية.',
          'We store your conversation data to process your order. By continuing, you agree to our privacy policy.',
          l
        ),
        [
          { id: 'consent_yes', title: msg('موافق ✅', 'I Agree ✅', l) },
          { id: 'consent_no', title: msg('لا أوافق ❌', 'Decline ❌', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._consentAsked = true;
      return;
    }
    if (lower === 'consent_yes' || lower.includes('موافق') || lower.includes('agree') || lower.includes('نعم') || lower === 'yes' || lower === 'ok') {
      conv.data._consentGiven = true;
      conv.data._consentAt = new Date().toISOString();
    } else if (lower === 'consent_no' || lower.includes('لا أوافق') || lower.includes('decline') || lower.includes('رفض') || lower === 'no') {
      await sendWhatsAppMessage(
        conv.phone,
        msg(
          'نحترم خصوصيتك. لا يمكننا متابعة الخدمة بدون موافقتك على حفظ البيانات.\n\nإذا غيّرت رأيك، أرسل أي رسالة للبدء من جديد.',
          'We respect your privacy. We cannot continue without your consent to store data.\n\nIf you change your mind, send any message to start over.',
          l
        ),
        accessToken,
        client.phone_number_id
      );
      conv.data._consentDeclined = true;
      conv.data._consentDeclinedAt = new Date().toISOString();
      return;
    } else {
      // Didn't understand — re-ask
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'الرجاء اختيار أحد الخيارات:',
          'Please choose one of the options:',
          l
        ),
        [
          { id: 'consent_yes', title: msg('موافق ✅', 'I Agree ✅', l) },
          { id: 'consent_no', title: msg('لا أوافق ❌', 'Decline ❌', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  // STEP 3: Intent menu
  if (!conv.data._intent) {
    const cartCount = (conv.data._cart || []).length;
    const cartHint = cartCount > 0
      ? msg(
          `\n\n🛒 عندك ${cartCount} منتج في السلة — اختر *القائمة* للعودة له.`,
          `\n\n🛒 You have ${cartCount} item(s) in cart — pick *Menu* to resume.`,
          l
        )
      : '';
    // Warm greeting on the very first intent-menu show, so a bare "hi" /
    // "🌴" / emoji opener doesn't feel like the bot jumped straight to a menu.
    // Subsequent re-prompts (customer typed something we didn't recognize)
    // skip the greeting — it would feel redundant.
    const greetName = conv.data.name ? (l === 'en' ? ` ${conv.data.name}` : ` ${conv.data.name}`) : '';
    const warmGreeting = !conv.data._intentAsked
      ? msg(`أهلاً${greetName} 🌴\n\n`, `Hello${greetName} 🌴\n\n`, l)
      : '';
    const intentPrompt = msg(
      `${warmGreeting}كيف نقدر نساعدك؟ 😊${cartHint}\n\n💡 اكتب *رئيسية* في أي وقت للرجوع لهذه القائمة`,
      `${warmGreeting}How can we help you? 😊${cartHint}\n\n💡 Type *home* anytime to return to this menu`,
      l
    );
    const intentButtons = [
      { id: 'intent_order', title: msg('القائمة 🌴', 'Menu 🌴', l) },
      { id: 'intent_status', title: msg('حالة الطلب 📦', 'Order Status 📦', l) },
      { id: 'intent_cs', title: msg('خدمة العملاء 💬', 'Customer Service 💬', l) }
    ];
    if (!conv.data._intentAsked) {
      // If the customer's first post-consent message is a product question
      // ("هل عندكم سكري؟"), answer it before showing the intent menu so
      // they don't have to re-ask after tapping through. Mark menu as asked
      // so subsequent free-text falls into the AI-1 branch below.
      if (isQuestionMessage(message)) {
        await loadProductsIfNeeded(conv, config);
        const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
        if (aiHandled) {
          conv.data._intentAsked = true;
          return;
        }
      }
      await sendWhatsAppButtons(conv.phone, intentPrompt, intentButtons, accessToken, client.phone_number_id);
      conv.data._intentAsked = true;
      return;
    }
    const isOrderIntent = lower === 'intent_order'
      || lower === 'pick_direct' || lower === 'show_images'
      || lower.includes('قائمة') || lower.includes('menu')
      || lower.includes('منتجات') || lower.includes('products')
      || lower.includes('سلة') || lower.includes('cart');
    const isStatusIntent = lower === 'intent_status'
      || lower.includes('حالة') || lower.includes('تتبع')
      || (lower.includes('order') && lower.includes('status')) || lower.includes('track');
    const isCsIntent = lower === 'intent_cs'
      || lower.includes('خدمة') || lower.includes('عملاء')
      || lower.includes('customer') || lower.includes('support');

    if (isOrderIntent) {
      conv.data._intent = 'new_order';
    } else if (isStatusIntent) {
      conv.data._intent = 'order_status';
      conv.data._shopifyState = 'order_status';
      await handleOrderStatus(client, conv, config, message, accessToken);
      return;
    } else if (isCsIntent) {
      conv.data._intent = 'customer_service';
      conv.data._shopifyState = 'customer_service';
      await handleCustomerService(client, conv, config, message, accessToken);
      return;
    } else {
      // Load products so we can match "ابغى السكري" against the catalog and
      // feed AI with context for questions. Both paths need them.
      await loadProductsIfNeeded(conv, config);
      // Declarative buying intent ("ابغى السكري" / "I want the sukkari") —
      // match against product names and route straight to the new-order flow.
      const directMatch = matchProduct(message, conv.data._products || []);
      if (directMatch) {
        conv.data._intent = 'new_order';
        conv.data._selectedProduct = directMatch;
        conv.data._browseMode = 'list';
        conv.data._shopifyState = 'variant_select';
        await showVariantOrProductView(client, conv, config, accessToken, directMatch);
        return;
      }
      // Question form — let Claude answer before falling back to the menu reprompt.
      if (isQuestionMessage(message)) {
        const aiHandled = await tryAIAnswer(client, conv, config, message, accessToken, notifyOwner);
        if (aiHandled) return;
      }
      await sendWhatsAppButtons(conv.phone, intentPrompt, intentButtons, accessToken, client.phone_number_id);
      return;
    }
  }

  // Route non-new-order intents
  if (conv.data._intent === 'order_status') {
    conv.data._shopifyState = 'order_status';
    await handleOrderStatus(client, conv, config, message, accessToken);
    return;
  }
  if (conv.data._intent === 'customer_service') {
    conv.data._shopifyState = 'customer_service';
    await handleCustomerService(client, conv, config, message, accessToken);
    return;
  }

  // NEW ORDER FLOW
  const existingCart: CartItem[] = conv.data._cart || [];

  // STEP 4: Session resume — if cart has items, ask to continue
  if (existingCart.length > 0) {
    if (lower === 'continue_cart' || lower === 'اكمل' || lower === 'أكمل') {
      conv.data._shopifyState = 'cart';
      await showCart(client, conv, config, accessToken);
      return;
    }
    if (
      lower === 'clear_cart' || lower === 'لا' || lower.includes('من جديد') ||
      lower === 'show_images' || lower === 'pick_direct' || lower === 'asst_help'
    ) {
      conv.data._cart = [];
      resetCurrentOrder(conv);
      await sendWhatsAppMessage(
        conv.phone,
        msg('تم مسح السلة ✓', 'Cart cleared ✓', l),
        accessToken,
        client.phone_number_id
      );
    } else {
      const cartLines = existingCart
        .map(item => formatCartLine(item, config.currency))
        .join('\n');

      await sendWhatsAppButtons(
        conv.phone,
        msg(
          `أهلاً! 👋\n\nعندك في سلتك:\n${cartLines}\n\nتبي تكمل طلبك؟`,
          `Welcome back! 👋\n\nYour cart:\n${cartLines}\n\nWould you like to continue?`,
          l
        ),
        [
          { id: 'continue_cart', title: msg('أكمل الطلب', 'Continue Order', l) },
          { id: 'clear_cart', title: msg('لا، من جديد', 'Start Over', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
  }

  // STEP 5: Fetch products (cached per store+language, 15 min TTL).
  // Use the status-returning variant so we can show a retry button if
  // Shopify is down, instead of silently telling the customer the store
  // is empty (fgf.md #46).
  const { products, apiError } = await fetchProductsWithStatus(config.domain, config.storefrontToken, conv.data._lang || 'ar');

  if (apiError) {
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `عذراً، فيه مشكلة مؤقتة في الاتصال بـ *${wa(config.storeName)}*. جرب مرة ثانية بعد دقيقة 🌴`,
        `Sorry, we're having a temporary connection issue with *${wa(config.storeName)}*. Please try again in a minute 🌴`,
        l
      ),
      [
        { id: 'pick_direct', title: msg('حاول مرة ثانية', 'Try Again', l) },
        { id: 'intent_cs', title: msg('خدمة العملاء', 'Customer Service', l) }
      ],
      accessToken,
      client.phone_number_id
    );
    await trackClientError(client, 'Shopify Products', new Error('Shopify API unreachable'));
    return;
  }

  if (products.length === 0) {
    const greetName = conv.data.name ? (l === 'en' ? ` ${conv.data.name}` : ` ${conv.data.name}`) : '';
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        `أهلاً${greetName}! عذراً، ما فيه منتجات متوفرة في *${wa(config.storeName)}* حالياً.`,
        `Hello${greetName}! Sorry, no products are available in *${wa(config.storeName)}* right now.`,
        l
      ),
      accessToken,
      client.phone_number_id
    );
    await trackClientError(client, 'Shopify Products', new Error('Product catalog returned empty'));
    return;
  }

  config.currency = config.currency || 'KWD';

  conv.data._products = products.map((p: ShopifyProduct) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    imageUrl: p.imageUrl,
    variants: p.variants,
    tags: p.tags,
    compareAtPriceMin: p.compareAtPriceMin
  }));

  const isReturning = conv.data._orderHistory?.length > 0;
  const nameGreet = isReturning
    ? msg('أهلاً مجدداً! 👋\n\n', 'Welcome back! 👋\n\n', l)
    : '';

  await sendWhatsAppButtons(
    conv.phone,
    `${nameGreet}${msg(`كيف تبي تتصفح *${wa(config.storeName)}*؟`, `How would you like to browse *${wa(config.storeName)}*?`, l)}`,
    [
      { id: 'show_images', title: msg('شوف الصور', 'View Images', l) },
      { id: 'pick_direct', title: msg('قائمة المنتجات', 'Product List', l) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
    ],
    accessToken,
    client.phone_number_id
  );

  conv.data._shopifyState = 'browse_choice';
}
