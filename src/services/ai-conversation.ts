import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// AI-DRIVEN CONVERSATION SERVICE
// Replaces rigid state machine with natural AI-guided flow.
// AI collects data, triggers WhatsApp buttons via tags.
// ============================================================

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export function isAIConversationAvailable(): boolean {
  return anthropic !== null;
}

// ============================================================
// RESPONSE TAGS — AI embeds these to trigger WhatsApp actions
// ============================================================
//  [DATA:key=value]               → save to booking state
//  [BUTTONS:text|opt1,opt2,opt3]  → send WhatsApp button message (max 3)
//  [LIST:text|buttonLabel|opt1,opt2,...] → send WhatsApp list (max 10)
//  [COMPLETE]                     → booking/lead is done
//  [HANDOVER]                     → forward to human agent

export interface ParsedAIResponse {
  text: string;                   // clean message to send
  data: Record<string, string>;   // extracted [DATA:] pairs
  buttons: { body: string; options: string[] } | null;
  list: { body: string; buttonText: string; options: string[] } | null;
  complete: boolean;
  handover: boolean;
}

export function parseAIResponse(raw: string): ParsedAIResponse {
  let text = raw;
  const data: Record<string, string> = {};

  // Extract [DATA:key=value]
  const dataMatches = [...text.matchAll(/\[DATA:(\w+)=([^\]]+)\]/g)];
  for (const m of dataMatches) {
    if (m[1] && m[2]) {
      data[m[1]] = m[2].trim();
    }
    text = text.replace(m[0], '');
  }

  // Extract [BUTTONS:body|opt1,opt2,opt3]
  let buttons: ParsedAIResponse['buttons'] = null;
  const btnMatch = text.match(/\[BUTTONS:([^|]+)\|([^\]]+)\]/);
  if (btnMatch && btnMatch[1] && btnMatch[2]) {
    buttons = {
      body: btnMatch[1].trim(),
      options: btnMatch[2].split(',').map(o => o.trim()).filter(Boolean).slice(0, 3)
    };
    text = text.replace(btnMatch[0], '');
  }

  // Extract [LIST:body|buttonLabel|opt1,opt2,...]
  let list: ParsedAIResponse['list'] = null;
  const listMatch = text.match(/\[LIST:([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (listMatch && listMatch[1] && listMatch[2] && listMatch[3]) {
    list = {
      body: listMatch[1].trim(),
      buttonText: listMatch[2].trim(),
      options: listMatch[3].split(',').map(o => o.trim()).filter(Boolean).slice(0, 10)
    };
    text = text.replace(listMatch[0], '');
  }

  // Detect [COMPLETE] and [HANDOVER]
  const complete = text.includes('[COMPLETE]');
  const handover = text.includes('[HANDOVER]');
  text = text.replace(/\[COMPLETE\]/g, '').replace(/\[HANDOVER\]/g, '');

  return {
    text: text.trim(),
    data,
    buttons,
    list,
    complete,
    handover
  };
}

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

interface PromptContext {
  businessName: string;
  industry: string;
  questions: { text: string; options: string[]; field: string }[];
  knowledgeBase: { category: string; question: string; answer: string }[];
  settings: Record<string, any>;
  bookingState: Record<string, any>;
  customerPhone: string;
  customSystemPrompt?: string;
}

function buildSystemPrompt(ctx: PromptContext): string {
  // Questions the business wants answered
  const questionsText = ctx.questions.length > 0
    ? ctx.questions.map((q, i) => `${i + 1}. ${q.text} — خيارات: [${q.options.join('، ')}] → حقل: ${q.field}`).join('\n')
    : 'لا توجد أسئلة — اجمع الاسم والجوال فقط.';

  // Knowledge base
  const kbText = ctx.knowledgeBase.length > 0
    ? ctx.knowledgeBase.map(k => `• ${k.category}: ${k.question} → ${k.answer}`).join('\n')
    : '';

  // Current booking state
  const stateEntries = Object.entries(ctx.bookingState).filter(([k, v]) => v && k !== 'welcomeSent' && k !== 'whatsappPhone');
  const stateText = stateEntries.length > 0
    ? stateEntries.map(([k, v]) => `✓ ${k}: ${v}`).join('\n')
    : 'لم يبدأ بعد';

  const today = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Per-client personality override, or default Gulf Arabic receptionist
  const personality = ctx.customSystemPrompt || `أنت موظف استقبال ذكي في ${ctx.businessName}.
دورك: تساعد العملاء بشكل طبيعي ودود — كأنك إنسان حقيقي مو بوت.

━━━ أسلوبك ━━━
• لهجة سعودية عامية طبيعية — مو فصحى
• ردودك قصيرة: 1-3 جمل كحد أقصى
• ودود ومحترف — كلمات مثل: زين، تمام، حاضر، إن شاء الله، ماشي`;

  return `${personality}

━━━ المعلومات المطلوبة ━━━
اجمع هذه المعلومات بالترتيب (تخطى ما هو معروف):
1. الاسم (نص حر)
${questionsText}

مهم: رقم الجوال معروف تلقائياً من واتساب = ${ctx.customerPhone}
لا تسأل عن رقم الجوال أبداً.

━━━ كيف تحفظ البيانات ━━━
احفظ كل معلومة فور معرفتها: [DATA:key=value]
• الاسم → [DATA:name=...]
• أسئلة العمل → [DATA:field=الخيار]

━━━ كيف تعرض الخيارات ━━━
WhatsApp يدعم نوعين — اختر واحد فقط:
• أزرار (2-3 خيارات): [BUTTONS:نص السؤال|خيار1,خيار2,خيار3]
• قائمة (4-10 خيارات): [LIST:نص السؤال|اختر|خيار1,خيار2,خيار3,خيار4]
• الاسم: نص حر — لا تستخدم أزرار

مهم جداً: لا ترسل نص عادي + أزرار معاً. إما أزرار أو نص فقط.
لو تبي ترسل أزرار، ضع كل الكلام داخل [BUTTONS:الكلام هنا|خيار1,خيار2]

━━━ كيف تتعامل مع الأسئلة ━━━
• لو العميل سأل سؤال، أجب بشكل طبيعي أولاً ثم ارجع للمعلومات المطلوبة
• لو ما تعرف الإجابة، اعتذر وأكمل
${kbText ? `\n━━━ معلومات العمل ━━━\n${kbText}` : ''}

━━━ الإكمال ━━━
متى تجمع كل المعلومات المطلوبة:
1. اعرض ملخص كامل بالبيانات
2. اسأل "هل المعلومات صحيحة؟" مع [BUTTONS:هل المعلومات صحيحة؟|نعم ✅,تعديل]
3. لو قال نعم → أرسل [COMPLETE] مع رسالة شكر قصيرة
4. لو قال لا → اسأل ماذا يريد تعديل

بعد [COMPLETE] لا ترد أبداً. المحادثة انتهت.

━━━ التحويل لموظف ━━━
لو العميل طلب موظف أو شخص حقيقي → أرسل [HANDOVER]

━━━ قواعد مهمة ━━━
• رد المريض بعد أي سؤال = الإجابة على هذا السؤال — احفظه فوراً وانتقل
• لا تكرر سؤال تم الإجابة عليه
• لا تغير اسم العميل — احفظه كما كتبه بالضبط

━━━ الجلسة الحالية ━━━
اليوم: ${today}
حالة الحجز:
${stateText}`;
}

// ============================================================
// CALL AI
// ============================================================

export interface AIConversationResult {
  parsed: ParsedAIResponse;
  rawResponse: string;
}

export async function getAIResponse(
  ctx: PromptContext,
  conversationHistory: { role: string; content: string }[],
  userMessage: string
): Promise<AIConversationResult> {
  if (!anthropic) {
    return {
      parsed: { text: 'عذراً، الخدمة غير متوفرة حالياً.', data: {}, buttons: null, list: null, complete: false, handover: false },
      rawResponse: ''
    };
  }

  const systemPrompt = buildSystemPrompt(ctx);

  // Keep last 10 messages for context
  const recent = conversationHistory.slice(-10).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }));
  recent.push({ role: 'user', content: userMessage });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AI timeout')), 15_000)
  );

  try {
    const response = await Promise.race([
      anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: recent
      }),
      timeout
    ]);

    const textBlock = response.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const parsed = parseAIResponse(raw);

    return { parsed, rawResponse: raw };
  } catch (error: any) {
    if (error?.message === 'AI timeout') {
      console.error('❌ AI conversation timeout after 15s');
    } else {
      console.error('❌ AI conversation error:', error);
    }
    return {
      parsed: { text: 'عذراً، صار خطأ. خليني أكمل معك.', data: {}, buttons: null, list: null, complete: false, handover: false },
      rawResponse: ''
    };
  }
}
