// ============================================================
// SHOPIFY STATES — order_status + customer_service
// Order lookup via Admin API (with phone-lookup, multi-order
// picker, manual entry fallback) and the customer-service
// acknowledge → ack-once → silent flow.
// ============================================================

import { sendWhatsAppMessage, sendWhatsAppButtons } from '../../whatsapp.js';
import { normalizeArabicNumbers } from '../../../utils/buttons.js';
import type { ClientConfig } from '../../../types/client.js';
import { msg, type ShopifyAgentConfig, type ConversationState } from '../types.js';
import {
  markReprompted,
  getOrderByNumber,
  getOrdersByPhone,
  formatOrderStatus,
} from '../helpers.js';
import { notifyOwner } from '../notify.js';

export async function handleOrderStatus(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string
): Promise<void> {
  const l: string = conv.data._lang || 'ar';
  const lowerMsg = message.toLowerCase().trim();

  // "Track another" shortcut — clear saved order number so the flow
  // re-asks without the customer having to go home + re-enter the
  // order-status intent (fgf.md #28). We also clear the phone-lookup flag
  // so "track another" re-offers the saved-orders picker.
  if (lowerMsg === 'track_another' || lowerMsg.includes('طلب ثاني') || lowerMsg.includes('another order') || lowerMsg.includes('طلب اخر') || lowerMsg.includes('طلب آخر')) {
    delete conv.data._osOrderNum;
    conv.data._osOrderNumAsked = false;
    delete conv.data._osContextForwarded;
    delete conv.data._osLastForwardedAt;
    delete conv.data._osPhoneLookupTried;
    delete conv.data._osPhoneOrderNums;
  }

  // "Not mine" (customer rejected the picker) — fall through to manual entry.
  if (lowerMsg === 'os_not_mine' || lowerMsg.includes('مو طلبي') || lowerMsg.includes('not mine')) {
    delete conv.data._osPhoneOrderNums;
  }

  // Customer picked one of the matched orders from the phone-lookup picker.
  // Button id is `os_pick_<order_number>`; set _osOrderNum and flow through
  // to the normal Admin lookup below so we get the full formatted status.
  if (lowerMsg.startsWith('os_pick_')) {
    const picked = lowerMsg.slice('os_pick_'.length);
    if (/^\d+$/.test(picked)) {
      conv.data._osOrderNum = picked;
    }
  }

  // STEP 0: Try phone lookup once per session (Con-flow L17). If we find
  // exactly one order, show it directly. If we find several, offer a
  // picker. If none (or no admin token), fall through to asking for the
  // order number. We only try this once to avoid hammering the API when
  // the customer retries within the same session.
  const adminTokenEarly = client.settings?.shopify_admin_token || client.settings?.shopify?.adminToken;
  if (!conv.data._osOrderNum && !conv.data._osPhoneLookupTried && adminTokenEarly) {
    conv.data._osPhoneLookupTried = true;
    const recentOrders = await getOrdersByPhone(config.domain, adminTokenEarly, conv.phone);
    if (recentOrders.length === 1) {
      const only = recentOrders[0]!;
      await sendWhatsAppButtons(
        conv.phone,
        formatOrderStatus(only, l),
        [
          { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      markReprompted(conv);
      return;
    }
    if (recentOrders.length > 1) {
      // Show up to 3 most recent as buttons (WhatsApp caps interactive
      // buttons at 3). Remaining orders are available by typing the number.
      const picks = recentOrders.slice(0, 2).map(o => ({
        id: `os_pick_${o.order_number}`,
        title: `#${o.order_number}`
      }));
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          `لقينا ${recentOrders.length} طلبات مربوطة برقم جوالك. أي طلب تبي تتابع؟`,
          `We found ${recentOrders.length} orders linked to your phone. Which one would you like to track?`,
          l
        ),
        [
          ...picks,
          { id: 'os_not_mine', title: msg('غير ذلك', 'Other', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._osPhoneOrderNums = recentOrders.map(o => String(o.order_number));
      return;
    }
    // 0 results → fall through to normal "ask for number" flow.
  }

  // STEP 1: Ask for order number
  if (!conv.data._osOrderNum) {
    if (!conv.data._osOrderNumAsked) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'أرسل لنا رقم طلبك 📦\n_(مثال: #1042)_\n\nإذا ما عندك الرقم، اضغط تحت وراح نساعدك.',
          'Please send your order number 📦\n_(e.g. #1042)_\n\nIf you don\'t have the number, tap below and we\'ll help you.',
          l
        ),
        [
          { id: 'no_order_num', title: msg('ما عندي الرقم', 'I don\'t have it', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      conv.data._osOrderNumAsked = true;
      return;
    }
    // "I don't have it" — escalate to owner so a human can look them up
    // by phone or past order history (fgf.md #25). Without Admin API
    // there's no automatic phone→orders lookup we can offer safely.
    if (lowerMsg === 'no_order_num' || lowerMsg.includes('ما عندي') || lowerMsg.includes('don\'t have') || lowerMsg.includes('dont have') || lowerMsg.includes('forgot') || lowerMsg.includes('نسيت')) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'لا عليك 🙏 فريقنا راح يراجع طلباتك عبر رقم جوالك ويتواصل معك قريباً.\n\nلو تبغى تسرع العملية، أرسل اسمك والمنتج وتاريخ الطلب تقريباً.',
          'No problem 🙏 Our team will review your orders by your phone number and contact you shortly.\n\nTo speed things up, send your name, the product, and approximate order date.',
          l
        ),
        [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
        accessToken,
        client.phone_number_id
      );
      if (!conv.data._osNotifiedOwner) {
        conv.data._osNotifiedOwner = true;
        await notifyOwner(client, conv, config, 'urgent', accessToken);
      }
      conv.data._osContextForwarded = true;
      conv.data._osLastForwardedAt = Date.now();
      markReprompted(conv);
      return;
    }
    // Already escalated (customer tapped "I don't have it") — any further
    // free-text is extra context. The owner was pinged on the first
    // escalation and will see any follow-up messages in the WhatsApp thread
    // anyway, so we never re-page them here (anti-spam rule). Only a
    // late-arriving explicit #1042 falls through to lookup. We also ack only
    // on the first follow-up; subsequent messages are silent so we don't
    // spam the customer with "forwarded ✅" on every message.
    if (conv.data._osContextForwarded && !/#\s*\d+/.test(normalizeArabicNumbers(message))) {
      if (!conv.data._osFollowupAcked) {
        conv.data._osFollowupAcked = true;
        await sendWhatsAppButtons(
          conv.phone,
          msg(
            'تم إرسال رسالتك للفريق ✅',
            'Your message has been forwarded to our team ✅',
            l
          ),
          [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
          accessToken,
          client.phone_number_id
        );
      }
      return;
    }
    // Prefer #N pattern; otherwise longest 3+ digit run so phone numbers/years
    // don't leak in as order numbers.
    const normalized = normalizeArabicNumbers(message);
    let parsedOrderNum: string | undefined;
    const hashMatch = normalized.match(/#\s*(\d+)/);
    if (hashMatch) {
      parsedOrderNum = hashMatch[1]!;
    } else {
      const runs = [...normalized.matchAll(/(\d{3,})/g)].map(m => m[1]!);
      if (runs.length > 0) {
        parsedOrderNum = runs.sort((a, b) => b.length - a.length)[0]!;
      }
    }
    if (!parsedOrderNum) {
      await sendWhatsAppButtons(
        conv.phone,
        msg(
          'ما قدرت أقرأ رقم الطلب. أرسله بهالشكل: #1042',
          'Could not read the order number. Send it like: #1042',
          l
        ),
        [
          { id: 'no_order_num', title: msg('ما عندي الرقم', 'I don\'t have it', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      return;
    }
    conv.data._osOrderNum = parsedOrderNum;
  }

  // STEP 2: Try Shopify Admin API if token available
  const adminToken = client.settings?.shopify_admin_token || client.settings?.shopify?.adminToken;
  if (adminToken) {
    await sendWhatsAppMessage(
      conv.phone,
      msg('جاري التحقق من طلبك...', 'Looking up your order...', l),
      accessToken,
      client.phone_number_id
    );
    const order = await getOrderByNumber(config.domain, adminToken, conv.data._osOrderNum);
    if (order) {
      await sendWhatsAppButtons(
        conv.phone,
        formatOrderStatus(order, l),
        [
          { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
          { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
        ],
        accessToken,
        client.phone_number_id
      );
      markReprompted(conv);
      return;
    }
    // Order not found — ping owner once so a human can look the customer
    // up by phone or past history (Con-flow L21). Repeat lookups in the
    // same session don't re-page (anti-spam rule).
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        `ما قدرنا نجد طلب برقم #${conv.data._osOrderNum}. تأكد من الرقم أو تواصل مع فريقنا.`,
        `We couldn't find order #${conv.data._osOrderNum}. Please verify the number or contact our team.`,
        l
      ),
      [
        { id: 'track_another', title: msg('جرب رقم ثاني', 'Try Another', l) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
      ],
      accessToken,
      client.phone_number_id
    );
    if (!conv.data._osNotifiedOwner) {
      conv.data._osNotifiedOwner = true;
      await notifyOwner(client, conv, config, 'urgent', accessToken);
    }
    markReprompted(conv);
    return;
  }

  // No Admin token — fallback: notify owner manually. Ask for context so
  // the owner can find the order faster, instead of just "team will review"
  // (fgf.md #26). Ping owner only once per session (anti-spam rule).
  await sendWhatsAppButtons(
    conv.phone,
    msg(
      `شكراً! فريقنا راح يراجع طلبك #${conv.data._osOrderNum} ويتواصل معك قريباً.\n\nلو تبغى تسرع، أرسل اسمك والمنتج وتاريخ الطلب تقريباً.`,
      `Thank you! Our team will review order #${conv.data._osOrderNum} and contact you shortly.\n\nTo speed things up, send your name, the product, and approximate order date.`,
      l
    ),
    [
      { id: 'track_another', title: msg('طلب ثاني', 'Track Another', l) },
      { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }
    ],
    accessToken,
    client.phone_number_id
  );
  if (!conv.data._osNotifiedOwner) {
    conv.data._osNotifiedOwner = true;
    await notifyOwner(client, conv, config, 'urgent', accessToken);
  }
  markReprompted(conv);
}

export async function handleCustomerService(
  client: ClientConfig,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  _message: string,
  accessToken: string
): Promise<void> {
  const l: string = conv.data._lang || 'ar';

  // First contact — send acknowledgment once. No time window promised;
  // we can't guarantee a specific SLA, and giving a number sets a false
  // expectation when the owner is slow to reply.
  if (!conv.data._csAcknowledged) {
    conv.data._csAcknowledged = true;
    conv.data._csStartedAt = new Date().toISOString();
    await sendWhatsAppMessage(
      conv.phone,
      msg(
        'وصل طلبك ✅ فريقنا راح يتواصل معك قريباً.\n\nإذا عندك تفاصيل إضافية، اكتبها هنا وراح توصل للفريق.',
        'Your request has been received ✅ Our team will be in touch soon.\n\nIf you have additional details, write them here and they will be forwarded to our team.',
        l
      ),
      accessToken,
      client.phone_number_id
    );
    conv.data._csLastNotifiedAt = Date.now();
    await notifyOwner(client, conv, config, 'help', accessToken);
    return;
  }

  // Second message after ack — remind them once that the team will be in
  // touch, give a Home escape button, then go silent. The owner was
  // already notified on the first message and can read the full thread in
  // WhatsApp — no re-ping (anti-spam rule, Con-flow L25).
  if (!conv.data._csRepeatAcked) {
    conv.data._csRepeatAcked = true;
    await sendWhatsAppButtons(
      conv.phone,
      msg(
        'فريقنا بيتواصل معك قريباً 🙏\n\nتقدر ترجع للرئيسية أو تنتظر رد الفريق.',
        'Our team will be in touch soon 🙏\n\nYou can return home or wait for our team to reply.',
        l
      ),
      [{ id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', l) }],
      accessToken,
      client.phone_number_id
    );
    return;
  }

  // Already acked twice — silent. Owner is handling it. Customer can still
  // type "رئيسية" / "home" or tap the Home button (global handler catches it).
}
