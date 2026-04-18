// ============================================================
// SHOPIFY AGENT — AI question answering via Claude
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { formatPrice, type ShopifyProduct } from '../shopify.js';
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons
} from '../whatsapp.js';
import { emitEvent } from '../events.js';
import { msg, AI_QUESTION_BUDGET, type ShopifyAgentConfig, type ConversationState } from './types.js';
import { isQuestionMessage } from './helpers.js';

// ============================================================
// MODULE-LEVEL ANTHROPIC CLIENT
// ============================================================

const _anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================
// AI ANSWER — call Claude with product context
// ============================================================

async function answerWithAI(
  question: string,
  products: ShopifyProduct[],
  storeName: string,
  currency: string | undefined,
  history: { role: string; content: string }[]
): Promise<string | null> {
  if (!_anthropic) return null;

  const productList = products.map(p => {
    const price = formatPrice(p.priceMin, currency);
    const desc = p.description ? p.description.replace(/<[^>]*>/g, '').trim().substring(0, 80) : '';
    return `- ${p.title} (${price})${desc ? ': ' + desc : ''}`;
  }).join('\n');

  const system = `أنت مساعد متجر ${storeName} على واتساب.
أجب على سؤال العميل فقط من معلومات المنتجات المتاحة.
لهجة خليجية قصيرة — جملة أو جملتين كحد أقصى.
لا تقترح الشراء مباشرة ولا تذكر أسعار إلا إذا سأل عنها.
إذا السؤال خارج نطاق المنتجات، قل "ما عندي تفاصيل عن هذا، بس تقدر تتصفح منتجاتنا."

المنتجات:
${productList}`;

  try {
    const recent = history.slice(-6).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    recent.push({ role: 'user', content: question });

    const response = await Promise.race([
      _anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system,
        messages: recent
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000))
    ]);

    const block = (response as any).content?.find((b: any) => b.type === 'text');
    return block?.text?.trim() || null;
  } catch {
    return null;
  }
}

// ============================================================
// TRY AI ANSWER — budget-gated, sends response + CTA
// ============================================================

export async function tryAIAnswer(
  client: any,
  conv: ConversationState,
  config: ShopifyAgentConfig,
  message: string,
  accessToken: string,
  notifyOwner: (client: any, conv: ConversationState, config: ShopifyAgentConfig, type: 'paid' | 'help' | 'urgent' | 'unverified', accessToken: string) => Promise<void>
): Promise<boolean> {
  if (!isQuestionMessage(message)) return false;

  const count = conv.data._aiAnswerCount || 0;

  if (count >= AI_QUESTION_BUDGET) {
    // Budget exhausted — show CTA every time (not just once) so customer isn't left in silence
    const ail: string = conv.data._lang || 'ar';
    await sendWhatsAppButtons(
      conv.phone,
      msg('للمزيد من الاستفسارات، فريقنا بخدمتك 👇', 'For more inquiries, our team is here 👇', ail),
      [
        { id: 'pick_direct', title: msg('تصفح المنتجات', 'Browse Products', ail) },
        { id: 'contact_us_global', title: msg('تواصل مع فريقنا', 'Contact Us', ail) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ail) }
      ],
      accessToken,
      client.phone_number_id
    );
    // Notify owner only once
    if (!conv.data._aiExhaustedNotified) {
      conv.data._aiExhaustedNotified = true;
      await notifyOwner(client, conv, config, 'help', accessToken);
    }
    return true;
  }

  const products: ShopifyProduct[] = conv.data._products || [];
  const answer = await answerWithAI(message, products, config.storeName, config.currency, conv.messages);
  if (!answer) return false;

  emitEvent(client.id, 'ai_call', conv.phone, { source: 'shopify_agent', questionNum: count + 1 });
  conv.data._aiAnswerCount = count + 1;
  await sendWhatsAppMessage(conv.phone, answer, accessToken, client.phone_number_id);

  // First answer only — soft CTA to browse
  if (count === 0) {
    const ail: string = conv.data._lang || 'ar';
    await sendWhatsAppButtons(
      conv.phone,
      msg('تبي تتصفح المنتجات؟', 'Would you like to browse our products?', ail),
      [
        { id: 'pick_direct', title: msg('قائمة المنتجات', 'Product List', ail) },
        { id: 'show_images', title: msg('شوف الصور', 'View Images', ail) },
        { id: 'go_home', title: msg('الرئيسية 🏠', 'Home 🏠', ail) }
      ],
      accessToken,
      client.phone_number_id
    );
  }

  return true;
}
